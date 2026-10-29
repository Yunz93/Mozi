//! Cocoa 的原生 terminate: 不经过 Tauri ExitRequested，须先取消终止并协调所有窗口保存。
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
use objc2::{class, msg_send, sel, MainThreadMarker};
use objc2_foundation::NSUInteger;
use std::ffi::CStr;
use std::sync::OnceLock;

const GUARDED_DELEGATE_CLASS: &CStr = c"MoziGuardedAppDelegate";
const TERMINATE_CANCEL: NSUInteger = 0;
const TERMINATE_NOW: NSUInteger = 1;
static REQUEST_EXIT: OnceLock<Box<dyn Fn() -> bool + Send + Sync>> = OnceLock::new();

extern "C" fn application_should_terminate(
    _delegate: *mut AnyObject,
    _selector: Sel,
    _application: *mut AnyObject,
) -> NSUInteger {
    if REQUEST_EXIT.get().map(|request| request()).unwrap_or(true) {
        TERMINATE_CANCEL
    } else {
        TERMINATE_NOW
    }
}

fn install_on_delegate(delegate: &AnyObject, name: &CStr) -> Result<(), String> {
    let parent = delegate.class();
    if parent.name() == name {
        return Ok(());
    }
    let selector = sel!(applicationShouldTerminate:);
    if parent.instance_method(selector).is_some() {
        return Err("现有 delegate 已提供原生退出处理，不能安全覆盖。".into());
    }
    let guarded = if let Some(existing) = AnyClass::get(name) {
        if !existing
            .superclass()
            .map(|class| std::ptr::eq(class, parent))
            .unwrap_or(false)
        {
            return Err("退出保护类的父类与当前 delegate 不一致。".into());
        }
        existing
    } else {
        let mut builder = ClassBuilder::new(name, parent).ok_or("无法注册退出保护类。")?;
        // typed add_method 推导 @ 参数及 NSUInteger 返回编码，不手写 ABI 字符串或转换函数指针。
        unsafe {
            builder.add_method(
                selector,
                application_should_terminate
                    as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) -> NSUInteger,
            );
        }
        builder.register()
    };
    if guarded.instance_size() != parent.instance_size() {
        return Err("退出保护类改变了 delegate 的实例布局。".into());
    }
    // 仅在主线程把现有对象改为无 ivar 子类；Tao 的状态、delegate 生命周期及方法均由父类保留。
    let previous = unsafe { AnyObject::set_class(delegate, guarded) };
    if !std::ptr::eq(previous, parent) {
        return Err("安装退出保护时 delegate 类发生变化。".into());
    }
    Ok(())
}

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    let _main = MainThreadMarker::new().ok_or("退出保护必须在主线程安装。")?;
    let application: &AnyObject = unsafe { msg_send![class!(NSApplication), sharedApplication] };
    let delegate: Option<&AnyObject> = unsafe { msg_send![application, delegate] };
    let delegate = delegate.ok_or("未找到应用 delegate，无法安装退出保护。")?;
    let handle = app.clone();
    let _ = REQUEST_EXIT.set(Box::new(move || crate::request_app_exit(&handle)));
    install_on_delegate(delegate, GUARDED_DELEGATE_CLASS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::rc::Retained;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    static REQUESTS: AtomicUsize = AtomicUsize::new(0);
    static HAS_WINDOWS: AtomicBool = AtomicBool::new(true);
    extern "C" fn preserved_value(_delegate: *mut AnyObject, _selector: Sel) -> NSUInteger {
        73
    }

    // 对照 Cocoa 的默认契约：delegate 没有此可选方法时，terminate: 会直接终止。
    fn cocoa_reply(delegate: &AnyObject, application: &AnyObject) -> NSUInteger {
        if delegate
            .class()
            .instance_method(sel!(applicationShouldTerminate:))
            .is_none()
        {
            return 1;
        }
        unsafe { msg_send![delegate, applicationShouldTerminate: application] }
    }

    #[test]
    fn native_quit_is_cancelled_and_requests_one_coordinated_save_without_changing_delegate_behavior(
    ) {
        let _ = REQUEST_EXIT.set(Box::new(|| {
            if !HAS_WINDOWS.load(Ordering::SeqCst) {
                return false;
            }
            REQUESTS.fetch_add(1, Ordering::SeqCst);
            true
        }));
        let mut parent = ClassBuilder::new(c"MoziQuitGuardFixtureParent", class!(NSObject))
            .expect("fixture class");
        unsafe {
            parent.add_method(
                sel!(preservedValue),
                preserved_value as extern "C" fn(*mut AnyObject, Sel) -> NSUInteger,
            );
        }
        let parent = parent.register();
        let delegate: Retained<AnyObject> = unsafe { msg_send![parent, new] };
        let application: Retained<AnyObject> = unsafe { msg_send![class!(NSObject), new] };
        assert_eq!(cocoa_reply(&delegate, &application), 1, "缺少拦截时的对照");
        assert_eq!(REQUESTS.load(Ordering::SeqCst), 0);
        install_on_delegate(&delegate, c"MoziQuitGuardFixture").expect("install guard");
        assert_eq!(
            cocoa_reply(&delegate, &application),
            0,
            "Cmd+Q/Dock 终止应先取消"
        );
        assert_eq!(REQUESTS.load(Ordering::SeqCst), 1);
        let guarded_class = delegate.class();
        assert_eq!(guarded_class.instance_size(), parent.instance_size());
        let value: NSUInteger = unsafe { msg_send![&*delegate, preservedValue] };
        assert_eq!(value, 73, "原 delegate 方法继续继承");
        install_on_delegate(&delegate, c"MoziQuitGuardFixture").expect("repeat install");
        assert!(std::ptr::eq(delegate.class(), guarded_class));
        assert_eq!(cocoa_reply(&delegate, &application), 0);
        assert_eq!(REQUESTS.load(Ordering::SeqCst), 2, "重复安装不应重复分发");
        HAS_WINDOWS.store(false, Ordering::SeqCst);
        assert_eq!(
            cocoa_reply(&delegate, &application),
            1,
            "零窗口时应允许原生终止"
        );
        assert_eq!(REQUESTS.load(Ordering::SeqCst), 2);
    }
}
