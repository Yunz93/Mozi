#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>

static EKEventStore *MoziEventStore(void) {
    static EKEventStore *store;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ store = [[EKEventStore alloc] init]; });
    return store;
}

static NSString *MoziCalendarPermission(void) {
    EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
    if (@available(macOS 14.0, *)) {
        if (status == EKAuthorizationStatusFullAccess) return @"granted";
        if (status == EKAuthorizationStatusWriteOnly) return @"writeOnly";
    } else if (status == EKAuthorizationStatusAuthorized) {
        return @"granted";
    }
    if (status == EKAuthorizationStatusNotDetermined) return @"notDetermined";
    if (status == EKAuthorizationStatusRestricted) return @"restricted";
    return @"denied";
}

static NSDictionary *MoziCalendarError(NSString *message) {
    return @{ @"error": message ?: @"Calendar operation failed" };
}

static NSDictionary *MoziPrepareCalendarAccess(BOOL request) {
    // 系统授权跨启动保留，但新建的 EventStore 仍须完成本次进程的访问初始化。
    // 这个标记只缓存连接就绪状态，每次调用仍以系统权限为准。
    static BOOL ready = NO;
    NSString *permission = MoziCalendarPermission();
    BOOL granted = [permission isEqualToString:@"granted"];
    if (!granted) ready = NO;
    BOOL canRequest = request && ([permission isEqualToString:@"notDetermined"]
                                  || [permission isEqualToString:@"writeOnly"]);
    if (!granted && !canRequest) return nil;
    if (!ready) {
        EKEventStore *store = MoziEventStore();
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block NSError *failure;
        __block BOOL allowed = NO;
        void (^completion)(BOOL, NSError *) = ^(BOOL granted, NSError *error) {
            allowed = granted;
            failure = error;
            dispatch_semaphore_signal(done);
        };
        // 权限弹窗由主线程触发，调用方在 Rust 阻塞线程等待，不阻塞界面。
        dispatch_async(dispatch_get_main_queue(), ^{
            if (@available(macOS 14.0, *)) {
                [store requestFullAccessToEventsWithCompletion:completion];
            } else {
                [store requestAccessToEntityType:EKEntityTypeEvent completion:completion];
            }
        });
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC))) {
            return MoziCalendarError(@"Calendar permission request timed out. Try again in settings.");
        }
        if (failure) return MoziCalendarError(failure.localizedDescription);
        ready = allowed && [MoziCalendarPermission() isEqualToString:@"granted"];
        if (!ready && (allowed || [MoziCalendarPermission() isEqualToString:@"granted"])) {
            return MoziCalendarError(@"Calendar access is not ready. Refresh the calendar list to retry.");
        }
    }
    return nil;
}

static NSDictionary *MoziCalendarAccess(BOOL request) {
    NSDictionary *failure = MoziPrepareCalendarAccess(request);
    if (failure) return failure;
    NSString *permission = MoziCalendarPermission();
    NSMutableArray *calendars = [NSMutableArray array];
    NSString *defaultCalendarId = @"";
    if ([permission isEqualToString:@"granted"]) {
        EKEventStore *store = MoziEventStore();
        for (EKCalendar *calendar in [store calendarsForEntityType:EKEntityTypeEvent]) {
            if (!calendar.allowsContentModifications) continue;
            [calendars addObject:@{
                @"id": calendar.calendarIdentifier,
                @"title": calendar.title ?: @"",
                @"source": calendar.source.title ?: @""
            }];
        }
        defaultCalendarId = store.defaultCalendarForNewEvents.calendarIdentifier ?: @"";
    }
    return @{ @"supported": @YES, @"permission": permission,
              @"calendars": calendars,
              @"defaultCalendarId": defaultCalendarId };
}

static NSString *MoziCalendarMarker(NSString *owner, NSString *key) {
    return [NSString stringWithFormat:@"[Mozi:%@:%@]", owner, key];
}

static BOOL MoziOwnsEvent(EKEvent *event, NSString *marker) {
    return event && [event.notes containsString:marker];
}

static EKEvent *MoziFindEvent(EKEventStore *store, NSString *marker, NSDictionary *record,
                              NSDictionary *item) {
    EKEvent *event = record[@"eventId"] ? [store eventWithIdentifier:record[@"eventId"]] : nil;
    if (MoziOwnsEvent(event, marker)) return event;
    // 标识符可能随账户同步改变，也可能在事件提交后、记录落盘前退出。按专属标记恢复。
    for (NSDictionary *candidate in @[record ?: @{}, item ?: @{}]) {
        if (!candidate[@"startAt"]) continue;
        EKCalendar *calendar = [store calendarWithIdentifier:candidate[@"calendarId"] ?: @""];
        if (!calendar) continue;
        NSDate *start = [NSDate dateWithTimeIntervalSince1970:[candidate[@"startAt"] doubleValue] / 1000 - 86400];
        NSDate *end = [NSDate dateWithTimeIntervalSince1970:[candidate[@"endAt"] doubleValue] / 1000 + 86400];
        NSPredicate *predicate = [store predicateForEventsWithStartDate:start endDate:end calendars:@[calendar]];
        for (EKEvent *match in [store eventsMatchingPredicate:predicate]) {
            if (MoziOwnsEvent(match, marker)) return match;
        }
    }
    return nil;
}

static NSDictionary *MoziCalendarSync(NSDictionary *input) {
    NSDictionary *failure = MoziPrepareCalendarAccess(NO);
    if (failure) return failure;
    if (![MoziCalendarPermission() isEqualToString:@"granted"]) {
        return MoziCalendarError(@"Calendar access is unavailable. Allow full access in System Settings > Privacy & Security > Calendars.");
    }
    EKEventStore *store = MoziEventStore();
    [store reset];
    EKCalendar *calendar = [store calendarWithIdentifier:input[@"calendarId"]];
    if (!calendar || !calendar.allowsContentModifications) {
        return MoziCalendarError(@"The selected calendar is unavailable or read-only. Choose another calendar.");
    }
    NSDictionary *previous = input[@"previous"];
    NSDictionary *items = input[@"items"];
    NSString *owner = input[@"owner"];
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    NSMutableDictionary *savedEvents = [NSMutableDictionary dictionary];
    NSError *error;
    for (NSString *key in items) {
        NSDictionary *item = items[key];
        NSDictionary *record = previous[key];
        NSString *marker = MoziCalendarMarker(owner, key);
        EKEvent *event = MoziFindEvent(store, marker, record, item);
        BOOL unchanged = event && [record[@"fingerprint"] isEqualToString:item[@"fingerprint"]]
            && [event.calendar.calendarIdentifier isEqualToString:calendar.calendarIdentifier];
        if (!unchanged) {
            if (event && !event.calendar.allowsContentModifications) {
                [store reset];
                return MoziCalendarError(@"A previously synced event is now read-only. Restore calendar access before syncing.");
            }
            if (!event) event = [EKEvent eventWithEventStore:store];
            event.calendar = calendar;
            event.title = item[@"title"];
            event.allDay = [item[@"allDay"] boolValue];
            event.startDate = [NSDate dateWithTimeIntervalSince1970:[item[@"startAt"] doubleValue] / 1000];
            event.endDate = [NSDate dateWithTimeIntervalSince1970:[item[@"endAt"] doubleValue] / 1000];
            event.timeZone = [NSTimeZone localTimeZone];
            event.notes = [NSString stringWithFormat:@"%@\n\n%@", item[@"notes"], marker];
            event.URL = [NSURL fileURLWithPath:item[@"filePath"]];
            // 提醒仍由墨知的系统通知开关管理，避免日历再创建一份重复闹钟。
            event.alarms = @[];
            if (![store saveEvent:event span:EKSpanThisEvent commit:NO error:&error]) {
                [store reset];
                return MoziCalendarError(error.localizedDescription);
            }
        }
        savedEvents[key] = event;
        result[key] = [@{ @"eventId": @"", @"calendarId": calendar.calendarIdentifier,
                         @"vaultPath": item[@"vaultPath"], @"startAt": item[@"startAt"],
                         @"filePath": item[@"filePath"],
                         @"endAt": item[@"endAt"], @"fingerprint": item[@"fingerprint"] } mutableCopy];
    }
    for (NSString *key in previous) {
        if (items[key]) continue;
        EKEvent *event = MoziFindEvent(store, MoziCalendarMarker(owner, key), previous[key], nil);
        if (event && ![store removeEvent:event span:EKSpanThisEvent commit:NO error:&error]) {
            [store reset];
            return MoziCalendarError(error.localizedDescription);
        }
    }
    if (![store commit:&error]) {
        [store reset];
        return MoziCalendarError(error.localizedDescription);
    }
    for (NSString *key in savedEvents) {
        result[key][@"eventId"] = [savedEvents[key] eventIdentifier] ?: @"";
    }
    return @{ @"records": result };
}

char *mozi_calendar_call(const char *json) {
    @autoreleasepool {
        NSDictionary *response;
        @try {
            NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *input = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            // 查询未授权状态时也要串行，但不能为加锁提前初始化 EventKit 数据连接。
            static NSObject *lock;
            static dispatch_once_t once;
            dispatch_once(&once, ^{ lock = [NSObject new]; });
            @synchronized (lock) {
                response = [input[@"operation"] isEqualToString:@"sync"]
                    ? MoziCalendarSync(input) : MoziCalendarAccess([input[@"request"] boolValue]);
            }
        } @catch (NSException *exception) {
            response = MoziCalendarError(exception.reason);
        }
        NSData *result = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
        return strdup([[NSString alloc] initWithData:result encoding:NSUTF8StringEncoding].UTF8String);
    }
}

void mozi_calendar_free(char *value) { free(value); }
