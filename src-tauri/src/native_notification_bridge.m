#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <stdbool.h>

// 当前通知插件使用 NSUserNotificationCenter；由编译器生成回调的 BOOL 签名。
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
@interface MoziForegroundNotificationPresentation : NSObject <NSUserNotificationCenterDelegate>
@end

@implementation MoziForegroundNotificationPresentation
- (BOOL)userNotificationCenter:(NSUserNotificationCenter *)center
    shouldPresentNotification:(NSUserNotification *)notification {
    return YES;
}
@end
#pragma clang diagnostic pop

bool mozi_notification_enable_foreground_for_class(const void *rawClass) {
    Class delegateClass = (__bridge Class)rawClass;
    if (!delegateClass) return false;
    SEL selector = @selector(userNotificationCenter:shouldPresentNotification:);
    // 只补缺失的前台展示回调，不覆盖依赖已有策略或交付、点击等处理。
    if (class_getInstanceMethod(delegateClass, selector)) return true;
    Method implementation = class_getInstanceMethod(
        [MoziForegroundNotificationPresentation class], selector);
    if (!implementation) return false;
    if (class_addMethod(delegateClass, selector,
                        method_getImplementation(implementation),
                        method_getTypeEncoding(implementation))) return true;
    return class_getInstanceMethod(delegateClass, selector) != NULL;
}

bool mozi_notification_enable_foreground(void) {
    // 该类由当前锁定的 mac-notification-sys 提供，回归测试会检查依赖契约。
    // 在插件惰性创建 delegate 之前安装，首条前台通知也能使用该回调。
    Class delegateClass = NSClassFromString(@"NotificationCenterDelegate");
    return mozi_notification_enable_foreground_for_class((__bridge const void *)delegateClass);
}
