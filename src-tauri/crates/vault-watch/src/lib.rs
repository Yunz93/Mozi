mod journal;
mod model;
mod observer;
use journal::Journal;
use model::Scope;
pub use model::{Change, Kind, Notice, Page, Stats, Subscription};
use notify::{
    event::{ModifyKind, RemoveKind, RenameMode},
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
pub use observer::{Observer, Updates};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, Weak,
    },
    thread::{self, JoinHandle},
    time::Instant,
};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Key {
    path: PathBuf,
    recursive: bool,
}
struct Root {
    _watcher: RecommendedWatcher,
    journal: Journal,
    scopes: HashMap<String, Scope>,
}
#[derive(Default)]
struct State {
    roots: HashMap<Key, Root>,
    subscriptions: HashMap<String, Key>,
}
struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    stop: AtomicBool,
}
pub struct Broker {
    shared: Arc<Shared>,
    creation: Mutex<()>,
    worker: Option<JoinHandle<()>>,
}

impl Broker {
    pub fn new(sink: impl Fn(Notice) + Send + Sync + 'static) -> Self {
        Self::try_new(sink).expect("vault-watch worker")
    }
    pub fn try_new(sink: impl Fn(Notice) + Send + Sync + 'static) -> Result<Self, String> {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            wake: Condvar::new(),
            stop: AtomicBool::new(false),
        });
        let worker_state = shared.clone();
        let worker = thread::Builder::new()
            .name("vault-watch-batches".into())
            .spawn(move || run(worker_state, sink))
            .map_err(|error| error.to_string())?;
        Ok(Self {
            shared,
            creation: Mutex::new(()),
            worker: Some(worker),
        })
    }
    /// Caller must authorize the canonical directory recursively, or the exact
    /// file. No broader parent-directory grant is implied by a file subscription.
    pub fn subscribe(&self, path: &Path, directory: bool) -> Result<Subscription, String> {
        let canonical = canonical_target(path)?;
        if !directory && canonical.is_dir() {
            return Err("File watch target is a directory".into());
        }
        if directory && !canonical.is_dir() {
            return Err("Watch root is not a directory".into());
        }
        let scope = if directory {
            Scope::Directory(canonical.clone())
        } else {
            Scope::File(canonical.clone())
        };
        let mut key = Key {
            path: if directory {
                canonical.clone()
            } else {
                canonical.parent().ok_or("File has no parent")?.into()
            },
            recursive: directory,
        };
        let _creation = self
            .creation
            .lock()
            .map_err(|_| "Watch creation lock failed")?;
        {
            let state = self.shared.state.lock().map_err(|_| "Watch lock failed")?;
            if !directory {
                if let Some(existing) = state
                    .roots
                    .keys()
                    .filter(|k| k.recursive && canonical.starts_with(&k.path))
                    .max_by_key(|k| k.path.components().count())
                {
                    key = existing.clone();
                }
            }
        }
        if self
            .shared
            .state
            .lock()
            .map_err(|_| "Watch lock failed")?
            .subscriptions
            .len()
            >= 4096
        {
            return Err("Too many subscriptions".into());
        }
        let exists = self
            .shared
            .state
            .lock()
            .map_err(|_| "Watch lock failed")?
            .roots
            .contains_key(&key);
        if !exists {
            if self
                .shared
                .state
                .lock()
                .map_err(|_| "Watch lock failed")?
                .roots
                .len()
                >= 128
            {
                return Err("Too many watch roots".into());
            }
            let weak = Arc::downgrade(&self.shared);
            let watched = key.clone();
            let mut watcher = RecommendedWatcher::new(
                move |event| enqueue(&weak, &watched, event),
                Config::default().with_follow_symlinks(false),
            )
            .map_err(|e| e.to_string())?;
            watcher
                .watch(
                    &key.path,
                    if key.recursive {
                        RecursiveMode::Recursive
                    } else {
                        RecursiveMode::NonRecursive
                    },
                )
                .map_err(|e| e.to_string())?;
            self.shared
                .state
                .lock()
                .map_err(|_| "Watch lock failed")?
                .roots
                .insert(
                    key.clone(),
                    Root {
                        _watcher: watcher,
                        journal: Journal::new(),
                        scopes: HashMap::new(),
                    },
                );
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut state = self.shared.state.lock().map_err(|_| "Watch lock failed")?;
        let root = state.roots.get_mut(&key).ok_or("Watch disappeared")?;
        let subscription = Subscription {
            subscription_id: id.clone(),
            epoch: root.journal.epoch.clone(),
            seq: root.journal.seq,
            path: canonical,
        };
        root.scopes.insert(id.clone(), scope);
        state.subscriptions.insert(id, key);
        Ok(subscription)
    }
    pub fn changes(&self, id: &str, epoch: &str, after: u64) -> Result<Page, String> {
        let (key, mut page) = {
            let state = self.shared.state.lock().map_err(|_| "Watch lock failed")?;
            let key = state.subscriptions.get(id).ok_or("Unknown subscription")?;
            let root = state.roots.get(key).ok_or("Unknown root")?;
            let scope = root.scopes.get(id).ok_or("Unknown scope")?;
            let mut page = root.journal.read(epoch, after);
            page.changes = page
                .changes
                .iter()
                .filter_map(|c| scope.filter(c))
                .collect();
            (key.clone(), page)
        };
        // Some backends stop silently when the watched root itself is deleted.
        // Probe just the root metadata at replay time (never walk the tree).
        if !std::fs::symlink_metadata(&key.path)
            .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        {
            page.rescan_required = true;
            page.error = Some("Watch root is unavailable".into());
        }
        Ok(page)
    }
    pub fn unsubscribe(&self, id: &str) {
        let Ok(_creation) = self.creation.lock() else {
            return;
        };
        // Drop watchers OUTSIDE the mutex: a backend may join a callback thread.
        let retired = {
            let Ok(mut state) = self.shared.state.lock() else {
                return;
            };
            let Some(key) = state.subscriptions.remove(id) else {
                return;
            };
            if let Some(root) = state.roots.get_mut(&key) {
                root.scopes.remove(id);
            }
            if state.roots.get(&key).is_some_and(|r| r.scopes.is_empty()) {
                state.roots.remove(&key)
            } else {
                None
            }
        };
        drop(retired);
        self.shared.wake.notify_all();
    }
    pub fn stats(&self) -> Stats {
        let Ok(state) = self.shared.state.lock() else {
            return Stats::default();
        };
        Stats {
            watchers: state.roots.len(),
            subscriptions: state.subscriptions.len(),
            batches: state.roots.values().map(|r| r.journal.batches).sum(),
            overflows: state.roots.values().map(|r| r.journal.overflows).sum(),
        }
    }
}
impl Default for Broker {
    fn default() -> Self {
        Self::new(|_| {})
    }
}
impl Drop for Broker {
    fn drop(&mut self) {
        // Synchronize the shutdown notification with the condvar wait transition.
        {
            let _guard = self.shared.state.lock();
            self.shared.stop.store(true, Ordering::Release);
            self.shared.wake.notify_all();
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run(shared: Arc<Shared>, sink: impl Fn(Notice)) {
    loop {
        let mut state = match shared.state.lock() {
            Ok(s) => s,
            Err(_) => break,
        };
        if shared.stop.load(Ordering::Acquire) {
            break;
        }
        let now = Instant::now();
        let mut notices = Vec::new();
        for root in state.roots.values_mut() {
            if root.journal.flush(now) {
                for (id, scope) in &root.scopes {
                    let page = root.journal.read(&root.journal.epoch, root.journal.seq - 1);
                    if page.rescan_required
                        || page.error.is_some()
                        || page.changes.iter().any(|c| scope.filter(c).is_some())
                    {
                        notices.push(Notice {
                            subscription_id: id.clone(),
                            epoch: page.epoch.clone(),
                            seq: page.seq,
                        });
                    }
                }
            }
        }
        if !notices.is_empty() {
            drop(state);
            for notice in notices {
                sink(notice);
            }
            continue;
        }
        let deadline = state
            .roots
            .values()
            .filter_map(|r| r.journal.deadline())
            .min();
        match deadline {
            Some(at) => {
                let _guard = shared
                    .wake
                    .wait_timeout(state, at.saturating_duration_since(Instant::now()));
            }
            None => {
                let _guard = shared.wake.wait(state);
            }
        }
    }
}
fn canonical_target(path: &Path) -> Result<PathBuf, String> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Parent traversal is not a watch target".into());
    }
    std::fs::canonicalize(path)
        .or_else(|_| {
            let parent =
                std::fs::canonicalize(path.parent().ok_or(std::io::ErrorKind::InvalidInput)?)?;
            Ok(parent.join(path.file_name().ok_or(std::io::ErrorKind::InvalidInput)?))
        })
        .map_err(|e: std::io::Error| e.to_string())
}
fn safe_path(path: &Path, key: &Key) -> Option<PathBuf> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    // Walk to the nearest existing ancestor to detect symlink escapes even for
    // deleted leaves; native recursion itself also has symlink following disabled.
    let mut ancestor = path;
    let mut suffix = Vec::new();
    let canonical = loop {
        match std::fs::canonicalize(ancestor) {
            Ok(p) => break p,
            Err(_) => {
                suffix.push(ancestor.file_name()?.to_owned());
                ancestor = ancestor.parent()?;
            }
        }
    };
    let mut resolved = canonical;
    for part in suffix.into_iter().rev() {
        resolved.push(part);
    }
    if resolved.starts_with(&key.path) {
        // Keep the event's lexical old spelling for case-only renames on Windows.
        // Canonicalization above is an authorization check, not an ID rewrite.
        Some(if path.starts_with(&key.path) {
            path.to_path_buf()
        } else {
            resolved
        })
    } else {
        None
    }
}
fn enqueue(shared: &Weak<Shared>, key: &Key, event: notify::Result<Event>) {
    let Some(shared) = shared.upgrade() else {
        return;
    };
    // Filesystem normalization may block on a slow volume. Keep that IO outside
    // the shared mutex so other roots and consumers can continue replaying.
    let mut changes = Vec::new();
    let mut rescan = false;
    let mut error = None;
    let now = Instant::now();
    match event {
        Err(reason) => {
            rescan = true;
            error = Some(reason.to_string());
        }
        Ok(event) => {
            // A link replacement may make the former path unsafe to disclose.
            // Ask consumers to rebuild their own filtered snapshot instead.
            if event
                .paths
                .iter()
                .any(|path| path.starts_with(&key.path) && safe_path(path, key).is_none())
            {
                rescan = true;
            }
            if event.need_rescan() {
                rescan = true;
            }
            match event.kind {
                EventKind::Access(_) => return,
                EventKind::Any | EventKind::Other => rescan = true,
                _ => {
                    let mut emit = |change: Change| changes.push(change);
                    if matches!(
                        event.kind,
                        EventKind::Modify(ModifyKind::Name(RenameMode::Both))
                    ) && event.paths.len() == 2
                    {
                        let old = safe_path(&event.paths[0], key);
                        let new = safe_path(&event.paths[1], key);
                        match (old, new) {
                            (Some(old), Some(path)) => {
                                let is_directory = path.is_dir();
                                emit(Change {
                                    kind: Kind::Renamed,
                                    path,
                                    old_path: Some(old),
                                    is_directory,
                                });
                            }
                            (Some(path), None) => emit(Change {
                                kind: Kind::Removed,
                                path,
                                old_path: None,
                                is_directory: false,
                            }),
                            (None, Some(path)) => {
                                let is_directory = path.is_dir();
                                emit(Change {
                                    kind: Kind::Created,
                                    path,
                                    old_path: None,
                                    is_directory,
                                });
                            }
                            _ => {}
                        }
                    } else {
                        for path in &event.paths {
                            if let Some(path) = safe_path(path, key) {
                                let kind = match event.kind {
                                    EventKind::Modify(ModifyKind::Name(
                                        RenameMode::Any | RenameMode::Other,
                                    )) => {
                                        if path.exists() {
                                            Kind::Created
                                        } else {
                                            Kind::Removed
                                        }
                                    }
                                    EventKind::Create(_)
                                    | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                                        Kind::Created
                                    }
                                    EventKind::Remove(_)
                                    | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                                        Kind::Removed
                                    }
                                    _ if matches!(std::fs::symlink_metadata(&path), Err(ref e) if e.kind() == std::io::ErrorKind::NotFound) => {
                                        Kind::Removed
                                    }
                                    _ => Kind::Modified,
                                };
                                let is_directory = path.is_dir()
                                    || matches!(event.kind, EventKind::Remove(RemoveKind::Folder));
                                emit(Change {
                                    kind,
                                    path,
                                    old_path: None,
                                    is_directory,
                                });
                            }
                        }
                    }
                    let root_removed = match event.kind {
                        EventKind::Remove(_)
                        | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                            event.paths.iter().any(|path| path == &key.path)
                        }
                        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                            event.paths.first() == Some(&key.path)
                        }
                        _ => false,
                    };
                    if root_removed
                        || (event.paths.iter().any(|p| p == &key.path) && !key.path.exists())
                    {
                        rescan = true;
                        error = Some("Watch root is unavailable".into());
                    }
                }
            }
        }
    }
    let Ok(mut state) = shared.state.lock() else {
        return;
    };
    let Some(root) = state.roots.get_mut(key) else {
        return;
    };
    if rescan {
        root.journal.mark_rescan(now, error);
    }
    for change in changes {
        if root
            .scopes
            .values()
            .any(|scope| scope.filter(&change).is_some())
        {
            root.journal.push(change, now);
        }
    }
    drop(state);
    shared.wake.notify_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_removal_stays_terminal_even_if_the_path_already_exists_again() {
        let path = std::env::temp_dir().join(format!("mozi-root-event-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let canonical = std::fs::canonicalize(&path).unwrap();
        let broker = Broker::default();
        let sub = broker.subscribe(&path, true).unwrap();
        let key = Key {
            path: canonical.clone(),
            recursive: true,
        };
        // A delayed backend callback can arrive after another process recreates
        // the directory. Existence does not restore the old watch registration.
        enqueue(
            &Arc::downgrade(&broker.shared),
            &key,
            Ok(Event::new(EventKind::Remove(RemoveKind::Folder)).add_path(canonical)),
        );
        let page = broker
            .changes(&sub.subscription_id, &sub.epoch, sub.seq)
            .unwrap();
        assert!(page.error.is_some());
        broker.unsubscribe(&sub.subscription_id);
        std::fs::remove_dir(path).unwrap();
    }
}
