/// Shared id for the native "New Window" menu item.
pub const MENU_NEW_WINDOW_ID: &str = "new-window";

pub fn is_new_window_menu_id(id: &str) -> bool {
    id == MENU_NEW_WINDOW_ID
}

/// Dock / native menu title. Default Chinese to match 墨知; English when LANG is `en*`.
pub fn native_new_window_title(lang: &str) -> &'static str {
    let lang = lang.to_ascii_lowercase();
    if lang.starts_with("en") {
        "New Window"
    } else {
        "新建窗口"
    }
}

pub fn native_new_window_title_from_env() -> &'static str {
    let lang = std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_default();
    native_new_window_title(&lang)
}

#[cfg(target_os = "macos")]
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
static DOCK_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
mod macos {
    use super::DOCK_APP;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, define_class, msg_send, sel, ClassType, MainThreadMarker, MainThreadOnly};
    use objc2_foundation::{NSObject, NSObjectProtocol, NSString};

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "MoziDockMenuTarget"]
        struct DockMenuTarget;

        impl DockMenuTarget {
            #[unsafe(method(openNewWindow:))]
            fn open_new_window(&self, _sender: Option<&AnyObject>) {
                if let Some(app) = DOCK_APP.get() {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = crate::open_new_window(app).await {
                            log::error!("Failed to open new window from Dock menu: {error}");
                        }
                    });
                }
            }
        }

        unsafe impl NSObjectProtocol for DockMenuTarget {}
    );

    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        let _ = DOCK_APP.set(app.clone());

        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "Dock menu must be installed on the main thread".to_string())?;
        let _ = DockMenuTarget::class();
        let target: Retained<DockMenuTarget> =
            unsafe { msg_send![mtm.alloc::<DockMenuTarget>(), init] };

        let title = NSString::from_str(super::native_new_window_title_from_env());
        let key = NSString::from_str("");
        let item: Retained<AnyObject> = unsafe {
            let alloc: *mut AnyObject = msg_send![class!(NSMenuItem), alloc];
            msg_send![
                alloc,
                initWithTitle: &*title,
                action: sel!(openNewWindow:),
                keyEquivalent: &*key
            ]
        };
        unsafe {
            let _: () = msg_send![&*item, setTarget: &*target];
            let _: () = msg_send![&*item, setEnabled: true];
        }

        let menu: Retained<AnyObject> = unsafe { msg_send![class!(NSMenu), new] };
        unsafe {
            let _: () = msg_send![&*menu, setAutoenablesItems: false];
            let _: () = msg_send![&*menu, addItem: &*item];
        }

        let ns_app: Retained<AnyObject> =
            unsafe { msg_send![class!(NSApplication), sharedApplication] };
        unsafe {
            let _: () = msg_send![&*ns_app, setDockMenu: &*menu];
        }

        // NSMenuItem.target is weak; retain the target and menu for the process lifetime.
        std::mem::forget(target);
        std::mem::forget(menu);
        Ok(())
    }
}

/// Install a macOS Dock menu with 新建窗口 / New Window.
#[cfg(target_os = "macos")]
pub fn install_dock_new_window_menu(app: &tauri::AppHandle) -> Result<(), String> {
    macos::install(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_defaults_to_chinese_and_follows_english_lang() {
        assert_eq!(native_new_window_title(""), "新建窗口");
        assert_eq!(native_new_window_title("zh_CN.UTF-8"), "新建窗口");
        assert_eq!(native_new_window_title("en_US.UTF-8"), "New Window");
        assert_eq!(native_new_window_title("en"), "New Window");
    }

    #[test]
    fn menu_id_only_matches_new_window() {
        assert!(is_new_window_menu_id(MENU_NEW_WINDOW_ID));
        assert!(is_new_window_menu_id("new-window"));
        assert!(!is_new_window_menu_id("quit"));
        assert!(!is_new_window_menu_id(""));
    }
}
