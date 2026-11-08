use mozi_vault_watch::{Broker, Kind, Page, Subscription};
use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("mozi-watch-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(fs::canonicalize(path).unwrap())
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn wait(
    broker: &Broker,
    sub: &Subscription,
    after: u64,
    predicate: impl Fn(&Page) -> bool,
) -> Page {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let page = broker
            .changes(&sub.subscription_id, &sub.epoch, after)
            .unwrap();
        if predicate(&page) {
            return page;
        }
        assert!(
            Instant::now() < deadline,
            "native event did not arrive: {page:?}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}
fn has(page: &Page, path: &Path) -> bool {
    page.changes
        .iter()
        .any(|c| c.path == path || c.old_path.as_deref() == Some(path))
}
#[test]
fn shares_root_covers_snapshot_race_and_releases_last_reference() {
    let temp = Temp::new();
    let broker = Broker::default();
    let one = broker.subscribe(&temp.0, true).unwrap();
    let two = broker.subscribe(&temp.0, true).unwrap();
    assert_eq!(broker.stats().watchers, 1);
    assert_eq!(broker.stats().subscriptions, 2);
    let file = temp.0.join("note.md");
    fs::write(&file, "during snapshot").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "during snapshot");
    let page = wait(&broker, &one, one.seq, |p| has(p, &file));
    assert!(has(
        &broker
            .changes(&two.subscription_id, &two.epoch, two.seq)
            .unwrap(),
        &file
    ));
    broker.unsubscribe(&one.subscription_id);
    assert_eq!(broker.stats().watchers, 1);
    fs::write(&file, "after first window closes").unwrap();
    wait(&broker, &two, page.seq, |p| has(p, &file));
    broker.unsubscribe(&two.subscription_id);
    assert_eq!(broker.stats().watchers, 0);
    assert_eq!(broker.stats().subscriptions, 0);
}
#[test]
fn exact_file_scope_does_not_disclose_siblings() {
    let temp = Temp::new();
    let a = temp.0.join("a.md");
    let b = temp.0.join("b.md");
    fs::write(&a, "a").unwrap();
    fs::write(&b, "b").unwrap();
    let broker = Broker::default();
    let one = broker.subscribe(&a, false).unwrap();
    let two = broker.subscribe(&b, false).unwrap();
    assert_eq!(broker.stats().watchers, 1);
    fs::write(&b, "changed b").unwrap();
    wait(&broker, &two, two.seq, |p| has(p, &b));
    assert!(
        broker
            .changes(&one.subscription_id, &one.epoch, one.seq)
            .unwrap()
            .changes
            .iter()
            .all(|change| change.path == a
                && change.old_path.as_ref().map_or(true, |path| path == &a))
    );
    broker.unsubscribe(&one.subscription_id);
    broker.unsubscribe(&two.subscription_id);
}
#[test]
fn observes_rename_delete_and_reports_root_loss() {
    let temp = Temp::new();
    let broker = Broker::default();
    let sub = broker.subscribe(&temp.0, true).unwrap();
    let old = temp.0.join("original.md");
    let new = temp.0.join("新笔记.md");
    fs::write(&old, "a").unwrap();
    let first = wait(&broker, &sub, sub.seq, |p| has(p, &old));
    fs::rename(&old, &new).unwrap();
    let moved = wait(&broker, &sub, first.seq, |p| has(p, &new));
    assert!(moved.changes.iter().any(|c| c.path == new));
    fs::remove_file(&new).unwrap();
    wait(&broker, &sub, moved.seq, |p| {
        p.changes
            .iter()
            .any(|c| c.path == new && c.kind == Kind::Removed)
    });
    fs::remove_dir(&temp.0).unwrap();
    wait(&broker, &sub, 0, |p| p.rescan_required && p.error.is_some());
    broker.unsubscribe(&sub.subscription_id);
    fs::create_dir(&temp.0).unwrap();
    let next = broker.subscribe(&temp.0, true).unwrap();
    assert_ne!(sub.epoch, next.epoch);
}
#[cfg(unix)]
#[test]
fn does_not_follow_symlink_outside_root() {
    let temp = Temp::new();
    let outside = Temp::new();
    let broker = Broker::default();
    let sub = broker.subscribe(&temp.0, true).unwrap();
    std::os::unix::fs::symlink(&outside.0, temp.0.join("outside")).unwrap();
    fs::write(outside.0.join("private.md"), "private").unwrap();
    thread::sleep(Duration::from_millis(600));
    let page = broker.changes(&sub.subscription_id, &sub.epoch, 0).unwrap();
    assert!(page.changes.iter().all(|c| c.path.starts_with(&temp.0)));
    assert!(!page.changes.iter().any(|c| c.path.ends_with("private.md")));
}

#[test]
fn atomic_save_and_case_only_rename_preserve_structural_hints() {
    let temp = Temp::new();
    let target = temp.0.join("Case.md");
    fs::write(&target, "before").unwrap();
    let broker = Broker::default();
    let sub = broker.subscribe(&temp.0, true).unwrap();
    let replacement = temp.0.join("save.tmp");
    fs::write(&replacement, "after").unwrap();
    fs::rename(&replacement, &target).unwrap();
    let page = wait(&broker, &sub, sub.seq, |p| {
        p.rescan_required || has(p, &target)
    });
    assert_eq!(fs::read_to_string(&target).unwrap(), "after");
    let renamed = temp.0.join("case.md");
    fs::rename(&target, &renamed).unwrap();
    wait(&broker, &sub, page.seq, |p| {
        p.rescan_required
            || p.changes.iter().any(|c| {
                c.kind != Kind::Modified
                    && (c.path == renamed || c.old_path.as_deref() == Some(&target))
            })
    });
    broker.unsubscribe(&sub.subscription_id);
    assert_eq!(broker.stats().watchers, 0);
}

#[test]
fn real_burst_is_replayed_or_requests_a_snapshot() {
    let temp = Temp::new();
    let broker = Broker::default();
    let sub = broker.subscribe(&temp.0, true).unwrap();
    for i in 0..1500 {
        fs::write(temp.0.join(format!("note-{i}.md")), "burst").unwrap();
    }
    let last = temp.0.join("note-1499.md");
    let page = wait(&broker, &sub, sub.seq, |p| {
        p.rescan_required || has(p, &last)
    });
    assert!(page.changes.len() <= 1024 * 32);
    assert!(page.changes.iter().all(|c| c.path.starts_with(&temp.0)));
    broker.unsubscribe(&sub.subscription_id);
}
