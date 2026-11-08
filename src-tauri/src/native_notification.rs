//! 补齐通知插件的前台展示回调，系统通知样式和专注模式仍由 macOS 控制。

extern "C" {
    fn mozi_notification_enable_foreground() -> bool;
}

pub fn install() -> Result<(), String> {
    if unsafe { mozi_notification_enable_foreground() } {
        Ok(())
    } else {
        Err("通知插件的 macOS delegate 不可用，无法启用前台展示。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{class, msg_send, sel};

    extern "C" {
        fn setupDelegate();
        fn mozi_notification_enable_foreground_for_class(delegate: *const std::ffi::c_void)
            -> bool;
    }

    #[test]
    fn notification_plugin_presents_notifications_while_the_app_is_foreground() {
        // 只保留依赖的原生实现以供检查；不初始化系统通知中心，也不发送测试通知。
        std::hint::black_box(setupDelegate as unsafe extern "C" fn());
        install().expect("install foreground presentation");
        let delegate_class = AnyClass::get(c"NotificationCenterDelegate")
            .expect("locked mac-notification-sys delegate must remain available");
        let delegate: Retained<AnyObject> = unsafe { msg_send![delegate_class, new] };
        let notification: Retained<AnyObject> = unsafe { msg_send![class!(NSObject), new] };
        let selector = sel!(userNotificationCenter:shouldPresentNotification:);
        let presents = if delegate_class.instance_method(selector).is_some() {
            let reply: Bool = unsafe {
                msg_send![&*delegate, userNotificationCenter: &*notification, shouldPresentNotification: &*notification]
            };
            reply.as_bool()
        } else {
            false
        };
        assert!(
            presents,
            "前台待办提醒必须请求系统展示横幅，不能只进入通知中心"
        );
        assert!(delegate_class
            .instance_method(sel!(userNotificationCenter:didDeliverNotification:))
            .is_some());
        assert!(delegate_class
            .instance_method(sel!(userNotificationCenter:didActivateNotification:))
            .is_some());
    }

    extern "C" fn existing_policy(
        _: *mut AnyObject,
        _: Sel,
        _: *mut AnyObject,
        _: *mut AnyObject,
    ) -> Bool {
        Bool::NO
    }

    #[test]
    fn keeps_an_existing_foreground_policy_and_repeated_install_is_safe() {
        let mut builder =
            ClassBuilder::new(c"MoziExistingNotificationPolicyFixture", class!(NSObject)).unwrap();
        unsafe {
            builder.add_method(
                sel!(userNotificationCenter:shouldPresentNotification:),
                existing_policy
                    as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject) -> Bool,
            );
        }
        let class = builder.register();
        let size = class.instance_size();
        let object: Retained<AnyObject> = unsafe { msg_send![class, new] };
        for _ in 0..2 {
            assert!(unsafe {
                mozi_notification_enable_foreground_for_class((class as *const AnyClass).cast())
            });
            let reply: Bool = unsafe {
                msg_send![&*object, userNotificationCenter: &*object, shouldPresentNotification: &*object]
            };
            assert!(!reply.as_bool());
            assert_eq!(class.instance_size(), size);
        }
        assert!(!unsafe { mozi_notification_enable_foreground_for_class(std::ptr::null()) });
    }
}
