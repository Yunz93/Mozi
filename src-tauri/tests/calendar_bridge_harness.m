#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#include <unistd.h>

// 仅替换 EventKit 外部边界，执行真正的桥接代码；不读取系统日历或触发权限弹窗。
static EKAuthorizationStatus authorization = EKAuthorizationStatusFullAccess;
static NSUInteger requests, prompts, readsBeforeConnection, calendarReads;
static BOOL failNextRequest;
static BOOL refuseNextRequest, denyPermission;

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
- (EKEvent *)eventWithIdentifier:(NSString *)identifier;
- (NSPredicate *)predicateForEventsWithStartDate:(NSDate *)start endDate:(NSDate *)end calendars:(NSArray *)calendars;
- (NSArray *)eventsMatchingPredicate:(NSPredicate *)predicate;
- (BOOL)saveEvent:(EKEvent *)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error;
- (BOOL)removeEvent:(EKEvent *)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error;
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
- (void)reset {}
- (BOOL)commit:(NSError **)error { return YES; }
- (EKEvent *)eventWithIdentifier:(NSString *)identifier { return nil; }
- (NSPredicate *)predicateForEventsWithStartDate:(NSDate *)start endDate:(NSDate *)end calendars:(NSArray *)calendars { return nil; }
- (NSArray *)eventsMatchingPredicate:(NSPredicate *)predicate { return @[]; }
- (BOOL)saveEvent:(EKEvent *)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error { abort(); }
- (BOOL)removeEvent:(EKEvent *)event span:(EKSpan)span commit:(BOOL)commit error:(NSError **)error { abort(); }
@end

#define EKEventStore MoziTestEventStore
#include "../src/tasks/calendar_bridge.m"
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
            } else Require(NO, "Unknown scenario");
            printf("PASS %s\n", argv[1]);
            exit(0);
        }
    });
    dispatch_main();
}
