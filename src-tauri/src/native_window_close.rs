//! macOS 原生全屏退出是异步的，收到完成通知后才能隐藏或销毁窗口。

pub async fn leave_fullscreen(window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::leave_fullscreen(window).await;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2::{class, msg_send, sel, MainThreadMarker};
    use objc2_foundation::{NSString, NSUInteger};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, OnceLock};
    use std::time::Duration;
    use tauri::Manager;

    const FULLSCREEN_STYLE: NSUInteger = 1 << 14;
    const EXIT_TIMEOUT: Duration = Duration::from_secs(5);
    static NEXT_REQUEST: AtomicUsize = AtomicUsize::new(1);
    static OBSERVER_CLASS: OnceLock<Result<&'static AnyClass, String>> = OnceLock::new();

    struct PendingExit {
        observer: Retained<AnyObject>,
        label: String,
        completed: mpsc::Sender<Result<(), String>>,
    }

    // 原生对象仅在创建它们的主线程保留、回调和释放，等待本身放到后台线程。
    thread_local! {
        static PENDING: RefCell<HashMap<usize, PendingExit>> = RefCell::new(HashMap::new());
    }

    fn notification_center() -> &'static AnyObject {
        unsafe { msg_send![class!(NSNotificationCenter), defaultCenter] }
    }

    fn complete_request(id: usize, result: Result<(), String>) -> bool {
        let pending = PENDING.with(|requests| requests.borrow_mut().remove(&id));
        let Some(pending) = pending else { return false };
        // 先取出并持有 observer 再注销，避免清理过程中对象提前释放。
        let _: () = unsafe { msg_send![notification_center(), removeObserver: &*pending.observer] };
        log::debug!(
            "全屏关窗 request={id} window={} completed={}",
            pending.label,
            result.is_ok()
        );
        let _ = pending.completed.send(result);
        true
    }

    extern "C" fn did_exit_fullscreen(observer: *mut AnyObject, _: Sel, _: *mut AnyObject) {
        let id = PENDING.with(|requests| {
            requests.borrow().iter().find_map(|(id, pending)| {
                (Retained::as_ptr(&pending.observer) == observer.cast_const()).then_some(*id)
            })
        });
        if let Some(id) = id {
            complete_request(id, Ok(()));
        }
    }

    fn observer_class() -> Result<&'static AnyClass, String> {
        OBSERVER_CLASS
            .get_or_init(|| {
                let mut builder =
                    ClassBuilder::new(c"MoziFullscreenExitObserver", class!(NSObject))
                        .ok_or("无法创建全屏退出观察器。")?;
                unsafe {
                    builder.add_method(
                        sel!(moziWindowDidExitFullScreen:),
                        did_exit_fullscreen as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject),
                    );
                }
                Ok(builder.register())
            })
            .as_ref()
            .copied()
            .map_err(Clone::clone)
    }

    fn observe_exit(
        id: usize,
        window: &AnyObject,
        label: String,
        completed: mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let observer: Retained<AnyObject> = unsafe { msg_send![observer_class()?, new] };
        let name = NSString::from_str("NSWindowDidExitFullScreenNotification");
        let _: () = unsafe {
            msg_send![notification_center(), addObserver: &*observer,
                selector: sel!(moziWindowDidExitFullScreen:), name: &*name, object: window]
        };
        PENDING.with(|requests| {
            requests.borrow_mut().insert(
                id,
                PendingExit {
                    observer,
                    label,
                    completed,
                },
            );
        });
        Ok(())
    }

    fn request_exit(
        window: &tauri::WebviewWindow,
        id: usize,
        completed: mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let _main = MainThreadMarker::new().ok_or("全屏关窗必须在主线程协调。")?;
        let native = window.ns_window().map_err(|error| error.to_string())?;
        let native =
            unsafe { (native as *const AnyObject).as_ref() }.ok_or("原生窗口已不可用。")?;
        let style: NSUInteger = unsafe { msg_send![native, styleMask] };
        if !window.is_fullscreen().map_err(|error| error.to_string())?
            && style & FULLSCREEN_STYLE == 0
        {
            let _ = completed.send(Ok(()));
            return Ok(());
        }
        // 先订阅，再请求退出；不能用 is_fullscreen() 轮询，它在动画结束前就会变为 false。
        observe_exit(id, native, window.label().into(), completed)?;
        log::debug!(
            "全屏关窗 request={id} window={} waiting for native exit",
            window.label()
        );
        window
            .set_fullscreen(false)
            .map_err(|error| error.to_string())
    }

    pub(super) async fn leave_fullscreen(window: &tauri::WebviewWindow) -> Result<(), String> {
        let id = NEXT_REQUEST.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                if let Err(error) = request_exit(&target, id, sender.clone()) {
                    if !complete_request(id, Err(error.clone())) {
                        let _ = sender.send(Err(error));
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        let result = tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(EXIT_TIMEOUT).unwrap_or_else(|error| {
                Err(format!("未确认 macOS 全屏退出，保留窗口以便重试：{error}"))
            })
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
        if result.is_err() {
            let failure = result.clone();
            // 超时只清理观察器，不强行关窗；迟到的通知也不能再触发销毁。
            let _ = window.app_handle().run_on_main_thread(move || {
                complete_request(id, failure);
            });
        }
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn post_exit(window: &AnyObject) {
            let name = NSString::from_str("NSWindowDidExitFullScreenNotification");
            let _: () = unsafe {
                msg_send![notification_center(), postNotificationName: &*name, object: window]
            };
        }

        #[test]
        fn waits_for_the_target_windows_native_completion_and_unregisters() {
            let window: Retained<AnyObject> = unsafe { msg_send![class!(NSObject), new] };
            let other: Retained<AnyObject> = unsafe { msg_send![class!(NSObject), new] };
            let id = NEXT_REQUEST.fetch_add(1, Ordering::Relaxed);
            let (sender, receiver) = mpsc::channel();
            observe_exit(id, &window, "fixture".into(), sender).unwrap();
            assert!(matches!(
                receiver.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
            post_exit(&other);
            assert!(matches!(
                receiver.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
            post_exit(&window);
            assert_eq!(
                receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
                Ok(())
            );
            assert!(!PENDING.with(|requests| requests.borrow().contains_key(&id)));
            post_exit(&window);
            assert!(matches!(
                receiver.try_recv(),
                Err(mpsc::TryRecvError::Disconnected)
            ));
        }

        #[test]
        fn cancellation_releases_the_observer_and_ignores_late_completion() {
            let window: Retained<AnyObject> = unsafe { msg_send![class!(NSObject), new] };
            let id = NEXT_REQUEST.fetch_add(1, Ordering::Relaxed);
            let (sender, receiver) = mpsc::channel();
            observe_exit(id, &window, "cancelled-fixture".into(), sender).unwrap();
            assert!(complete_request(id, Err("cancelled".into())));
            assert_eq!(receiver.recv().unwrap(), Err("cancelled".into()));
            assert!(!PENDING.with(|requests| requests.borrow().contains_key(&id)));
            post_exit(&window);
            assert!(matches!(
                receiver.try_recv(),
                Err(mpsc::TryRecvError::Disconnected)
            ));
        }
    }
}
