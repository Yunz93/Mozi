#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#include <unistd.h>

// 仅替换 EventKit 外部边界，执行真正的桥接代码；不读取系统日历或触发权限弹窗。
static EKAuthorizationStatus authorization = EKAuthorizationStatusFullAccess;
static NSUInteger requests, prompts, readsBeforeConnection, calendarReads, rangeQueries;
static BOOL failNextRequest;
static BOOL refuseNextRequest, denyPermission;
static NSMutableArray *storedEvents, *pendingEvents, *removedEvents;

@interface MoziTestEvent : NSObject
@property(nonatomic, copy) NSString *eventIdentifier;
@property(nonatomic, readonly) NSString *calendarItemIdentifier;
@property(nonatomic, strong) EKCalendar *calendar;
@property(nonatomic, copy) NSString *title;
@property(nonatomic, copy) NSString *notes;
@property(nonatomic, strong) NSDate *startDate, *endDate;
@property(nonatomic, strong) NSTimeZone *timeZone;
@property(nonatomic, strong) NSURL *URL;
@property(nonatomic, copy) NSArray *alarms;
@property(nonatomic) BOOL allDay;
+ (instancetype)eventWithEventStore:(id)store;
@end
@implementation MoziTestEvent
+ (instancetype)eventWithEventStore:(id)store { return [self new]; }
- (NSString *)calendarItemIdentifier { return self.eventIdentifier; }
@end

@interface MoziTestCalendar : NSObject
@property(nonatomic, readonly) NSString *calendarIdentifier;
@property(nonatomic, readonly) NSString *title;
@property(nonatomic, readonly) BOOL allowsContentModifications;
@property(nonatomic, readonly) EKSource *source;
@end
@implementation MoziTestCalendar
- (NSString *)calendarIdentifier { return @"saved-calendar"; }
- (NSString *)title { return @"Saved calendar"; }
- (BOOL)allowsContentModifications { return YES; }
- (EKSource *)source { return nil; }
@end

@interface MoziTestEventStore : NSObject
@property(nonatomic) BOOL connected;
@property(nonatomic, readonly) EKCalendar *defaultCalendarForNewEvents;
+ (EKAuthorizationStatus)authorizationStatusForEntityType:(EKEntityType)type;
- (void)requestFullAccessToEventsWithCompletion:(EKEventStoreRequestAccessCompletionHandler)completion;
- (void)requestAccessToEntityType:(EKEntityType)type completion:(EKEventStoreRequestAccessCompletionHandler)completion;
- (NSArray<EKCalendar *> *)calendarsForEntityType:(EKEntityType)type;
- (EKCalendar *)calendarWithIdentifier:(NSString *)identifier;
- (void)reset;
- (BOOL)commit:(NSError **)error;
- (id)eventWithIdentifier:(NSString *)identifier;
- (NSPredicate *)predicateForEventsWithStartDate:(NSDate *)start endDate:(NSDate *)end calendars:(NSArray *)calendars;
- (NSArray *)eventsMatchingPredicate:(NSPredicate *)predicate;
- (BOOL)saveEvent:(id)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error;
- (BOOL)removeEvent:(id)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error;
@end

@implementation MoziTestEventStore
+ (EKAuthorizationStatus)authorizationStatusForEntityType:(EKEntityType)type { return authorization; }
- (void)requestFullAccessToEventsWithCompletion:(EKEventStoreRequestAccessCompletionHandler)completion {
    requests++;
    if (authorization != EKAuthorizationStatusFullAccess) prompts++;
    if (failNextRequest) {
        failNextRequest = NO;
        completion(NO, [NSError errorWithDomain:@"MoziCalendarTest" code:1 userInfo:nil]);
        return;
    }
    if (refuseNextRequest || denyPermission) {
        refuseNextRequest = NO;
        if (denyPermission) authorization = EKAuthorizationStatusDenied;
        completion(NO, nil);
        return;
    }
    self.connected = YES;
    authorization = EKAuthorizationStatusFullAccess;
    completion(YES, nil);
}
- (void)requestAccessToEntityType:(EKEntityType)type completion:(EKEventStoreRequestAccessCompletionHandler)completion {
    [self requestFullAccessToEventsWithCompletion:completion];
}
- (EKCalendar *)defaultCalendarForNewEvents {
    calendarReads++;
    if (!self.connected) { readsBeforeConnection++; return nil; }
    return (EKCalendar *)[MoziTestCalendar new];
}
- (NSArray<EKCalendar *> *)calendarsForEntityType:(EKEntityType)type {
    EKCalendar *calendar = self.defaultCalendarForNewEvents;
    return calendar ? @[calendar] : @[];
}
- (EKCalendar *)calendarWithIdentifier:(NSString *)identifier {
    return [identifier isEqualToString:@"saved-calendar"] ? self.defaultCalendarForNewEvents : nil;
}
- (void)reset { [pendingEvents removeAllObjects]; [removedEvents removeAllObjects]; }
- (BOOL)commit:(NSError **)error {
    [storedEvents removeObjectsInArray:removedEvents];
    for (MoziTestEvent *event in pendingEvents) {
        if (!event.eventIdentifier) event.eventIdentifier = NSUUID.UUID.UUIDString;
        if (![storedEvents containsObject:event]) [storedEvents addObject:event];
    }
    [self reset];
    return YES;
}
- (id)eventWithIdentifier:(NSString *)identifier {
    for (MoziTestEvent *event in storedEvents) {
        if ([event.eventIdentifier isEqual:identifier]) return (EKEvent *)event;
    }
    return nil;
}
- (NSPredicate *)predicateForEventsWithStartDate:(NSDate *)start endDate:(NSDate *)end calendars:(NSArray *)calendars {
    rangeQueries++;
    return [NSPredicate predicateWithBlock:^BOOL(MoziTestEvent *event, NSDictionary *bindings) {
        return [event.startDate compare:end] == NSOrderedAscending && [event.endDate compare:start] == NSOrderedDescending;
    }];
}
- (NSArray *)eventsMatchingPredicate:(NSPredicate *)predicate { return [storedEvents filteredArrayUsingPredicate:predicate]; }
- (BOOL)saveEvent:(id)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error {
    [pendingEvents addObject:event]; return YES;
}
- (BOOL)removeEvent:(id)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error {
    [removedEvents addObject:event]; return YES;
}
@end

#define EKEventStore MoziTestEventStore
#define EKEvent MoziTestEvent
#include "../src/tasks/calendar_bridge.m"
#undef EKEvent
#undef EKEventStore

static void Require(BOOL condition, const char *message) {
    if (!condition) { fprintf(stderr, "%s\n", message); exit(1); }
}

static NSDictionary *Call(NSDictionary *input) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:input options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    char *output = mozi_calendar_call(text.UTF8String);
    NSData *response = [[NSString stringWithUTF8String:output] dataUsingEncoding:NSUTF8StringEncoding];
    mozi_calendar_free(output);
    return [NSJSONSerialization JSONObjectWithData:response options:0 error:nil];
}

int main(int argc, const char **argv) {
    Require(argc == 2, "Expected lifecycle scenario");
    alarm(15);
    NSString *scenario = @(argv[1]);
    storedEvents = [NSMutableArray array];
    pendingEvents = [NSMutableArray array];
    removedEvents = [NSMutableArray array];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
        @autoreleasepool {
            NSDictionary *query = @{ @"operation": @"access", @"request": @NO };
            if ([scenario isEqualToString:@"restore-access"]) {
                NSDictionary *result = Call(query);
                Require([result[@"permission"] isEqual:@"granted"], "Existing OS permission must remain granted");
                Require([result[@"calendars"] count] == 1, "A fresh already-authorized store must load its calendars");
                Require(requests == 1 && prompts == 0 && readsBeforeConnection == 0, "Restore the connection before reads without prompting");
                Call(query);
                Require(requests == 1, "Reuse the initialized connection");
            } else if ([scenario isEqualToString:@"restore-sync"]) {
                NSDictionary *result = Call(@{ @"operation": @"sync", @"calendarId": @"saved-calendar", @"owner": @"test", @"items": @{}, @"previous": @{} });
                Require(result[@"records"] != nil && result[@"error"] == nil, "Startup sync must restore the saved target without opening settings");
                Require(requests == 1 && prompts == 0 && readsBeforeConnection == 0, "Startup sync must establish already-authorized access");
            } else if ([scenario isEqualToString:@"no-prompt"]) {
                for (NSNumber *status in @[@(EKAuthorizationStatusNotDetermined), @(EKAuthorizationStatusDenied), @(EKAuthorizationStatusRestricted), @(EKAuthorizationStatusWriteOnly)]) {
                    authorization = status.integerValue;
                    Call(query);
                }
                Require(requests == 0 && calendarReads == 0, "Passive queries must never request permission or read unauthorized calendars");
            } else if ([scenario isEqualToString:@"explicit-enable"]) {
                authorization = EKAuthorizationStatusNotDetermined;
                NSDictionary *result = Call(@{ @"operation": @"access", @"request": @YES });
                Require([result[@"calendars"] count] == 1 && prompts == 1, "Explicit enable must still request first-time access");
            } else if ([scenario isEqualToString:@"revocation"]) {
                Call(query);
                authorization = EKAuthorizationStatusDenied;
                NSUInteger reads = calendarReads;
                NSDictionary *denied = Call(query);
                Require([denied[@"permission"] isEqual:@"denied"] && calendarReads == reads, "Revoked permission must stop calendar reads");
                authorization = EKAuthorizationStatusFullAccess;
                NSDictionary *restored = Call(query);
                Require([restored[@"calendars"] count] == 1 && requests == 2 && prompts == 0, "Restore the connection again after permission changes");
            } else if ([scenario isEqualToString:@"retry-failure"]) {
                failNextRequest = YES;
                NSDictionary *failed = Call(query);
                Require(failed[@"error"] != nil && calendarReads == 0, "Failed initialization must not masquerade as a missing calendar");
                Require([Call(query)[@"calendars"] count] == 1 && requests == 2, "A failed connection must remain retryable");
            } else if ([scenario isEqualToString:@"refused-connection"]) {
                refuseNextRequest = YES;
                Require(Call(query)[@"error"] != nil && calendarReads == 0, "A refused store connection must not read calendar data even if global status is granted");
                Require([Call(query)[@"calendars"] count] == 1 && requests == 2, "A refusal without NSError must remain retryable");
            } else if ([scenario isEqualToString:@"explicit-denial"]) {
                authorization = EKAuthorizationStatusNotDetermined;
                denyPermission = YES;
                NSDictionary *result = Call(@{ @"operation": @"access", @"request": @YES });
                Require([result[@"permission"] isEqual:@"denied"] && calendarReads == 0, "A user denial must not expose calendar data");
                Call(query);
                Require(requests == 1 && prompts == 1, "Passive refresh after denial must not request permission again");
            } else if ([scenario isEqual:@"shared-date-range"]) {
                NSMutableDictionary *items = [NSMutableDictionary dictionary], *previous = [NSMutableDictionary dictionary];
                for (NSUInteger index = 0; index < 32; index++) {
                    NSString *key = [NSString stringWithFormat:@"task-%lu", (unsigned long)index];
                    MoziTestEvent *event = [MoziTestEvent new];
                    event.eventIdentifier = key;
                    event.calendar = (EKCalendar *)[MoziTestCalendar new];
                    event.title = key;
                    event.notes = [NSString stringWithFormat:@"来源笔记😀\n[Mozi:owner:%@]", key];
                    NSNumber *startAt = @(1000000000LL + index * 60000LL);
                    NSNumber *endAt = @(startAt.longLongValue + 1800000LL);
                    event.startDate = [NSDate dateWithTimeIntervalSince1970:startAt.doubleValue / 1000];
                    event.endDate = [NSDate dateWithTimeIntervalSince1970:endAt.doubleValue / 1000];
                    [storedEvents addObject:event];
                    items[key] = @{ @"calendarId": @"saved-calendar", @"vaultPath": @"/qa", @"filePath": @"/qa/note.md", @"title": key, @"notes": @"来源", @"allDay": @NO, @"startAt": startAt, @"endAt": endAt, @"fingerprint": @"same" };
                    previous[key] = @{ @"eventId": key, @"calendarId": @"saved-calendar", @"startAt": startAt, @"endAt": endAt, @"fingerprint": @"same" };
                }
                NSDictionary *input = @{ @"operation": @"sync", @"owner": @"owner", @"calendarId": @"saved-calendar", @"items": items, @"previous": previous };
                Require([Call(input)[@"records"] count] == 32 && storedEvents.count == 32, "A batch must preserve every distinct task");
                Require(rangeQueries == 1, "Tasks sharing one date window must reuse one EventKit range query");
                Require(Call(input)[@"error"] == nil && rangeQueries == 2, "Each sync must refresh the cached range exactly once");
            } else if ([scenario isEqual:@"duplicate-events"] || [scenario isEqual:@"restore-event"] || [scenario isEqual:@"lost-mapping"] || [scenario isEqual:@"bucket-boundary"]) {
                NSString *marker = @"[Mozi:owner:task]";
                NSUInteger count = [scenario isEqual:@"duplicate-events"] ? 3 : 1;
                for (NSUInteger index = 0; index < count + 3; index++) {
                    MoziTestEvent *event = [MoziTestEvent new];
                    event.eventIdentifier = [NSString stringWithFormat:@"event-%lu", (unsigned long)index];
                    event.calendar = (EKCalendar *)[MoziTestCalendar new];
                    event.title = [scenario isEqual:@"duplicate-events"] && index == 0 ? @"旧标题" : @"一次日程";
                    event.notes = index < count ? marker : @[@"[Mozi:other-owner:task]", @"[Mozi:owner:another-task]", @"手动创建的日程"][index - count];
                    event.startDate = [NSDate dateWithTimeIntervalSince1970:1000000];
                    event.endDate = [NSDate dateWithTimeIntervalSince1970:1001800];
                    [storedEvents addObject:event];
                }
                if ([scenario isEqual:@"bucket-boundary"]) {
                    MoziTestEvent *outside = [MoziTestEvent new];
                    outside.eventIdentifier = @"outside-window";
                    outside.calendar = (EKCalendar *)[MoziTestCalendar new];
                    outside.notes = marker;
                    outside.startDate = [NSDate dateWithTimeIntervalSince1970:1110000];
                    outside.endDate = [NSDate dateWithTimeIntervalSince1970:1111800];
                    [storedEvents addObject:outside];
                }
                NSDictionary *item = @{ @"calendarId": @"saved-calendar", @"vaultPath": @"/qa", @"filePath": @"/qa/note.md", @"title": @"一次日程", @"notes": @"来源", @"allDay": @NO, @"startAt": @1000000000, @"endAt": @1001800000, @"fingerprint": @"same" };
                NSString *savedIdentifier = [scenario isEqual:@"restore-event"] ? @"old-id" : ([scenario isEqual:@"duplicate-events"] ? @"event-2" : @"event-0");
                NSDictionary *record = @{ @"eventId": savedIdentifier, @"calendarId": @"saved-calendar", @"startAt": @1000000000, @"endAt": @1001800000, @"fingerprint": @"same" };
                NSDictionary *input = @{ @"operation": @"sync", @"owner": @"owner", @"calendarId": @"saved-calendar", @"items": @{ @"task": item }, @"previous": [scenario isEqual:@"lost-mapping"] ? @{} : @{ @"task": record } };
                NSDictionary *result = Call(input);
                Require(result[@"error"] == nil, "Sync must succeed");
                NSUInteger expected = [scenario isEqual:@"bucket-boundary"] ? 5 : 4;
                Require(storedEvents.count == expected, "A source task must keep one owned event and preserve unrelated or out-of-window events");
                NSString *identifier = result[@"records"][@"task"][@"eventId"];
                Require([identifier hasPrefix:@"event-"], "Recover an existing event instead of creating another one");
                Require([[[MoziEventStore() eventWithIdentifier:identifier] title] isEqual:@"一次日程"], "The retained event must contain the latest source values");
                NSMutableDictionary *repeat = [input mutableCopy];
                repeat[@"previous"] = result[@"records"];
                Require(Call(repeat)[@"error"] == nil && storedEvents.count == expected, "Repeated sync must remain idempotent");
            } else Require(NO, "Unknown scenario");
            printf("PASS %s\n", argv[1]);
            exit(0);
        }
    });
    dispatch_main();
}
