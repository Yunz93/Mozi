use super::{calendar, model::*, parser, reminders, storage};
use chrono::{Local, TimeZone};
use mozi_vault_watch::{Change, Kind, Observer};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, RwLock},
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub enum Operation {
    Register(Vault),
    Unregister(String),
    Refresh(Option<String>),
    Preferences(PreferencesPatch),
    Language(String),
    Flush,
}

struct Request {
    operation: Operation,
    reply: mpsc::SyncSender<Result<(), String>>,
}

pub struct TaskManager {
    sender: mpsc::Sender<Request>,
    snapshot: Arc<RwLock<Snapshot>>,
    pub(super) closing_windows: std::sync::Mutex<BTreeSet<String>>,
}

#[derive(Clone, PartialEq)]
struct Signature {
    modified: Option<SystemTime>,
    length: u64,
}

struct FileIndex {
    signature: Signature,
    tasks: Vec<Task>,
}

struct Runtime {
    app: AppHandle,
    data_path: PathBuf,
    saved: SavedState,
    files: BTreeMap<PathBuf, FileIndex>,
    shared: Arc<RwLock<Snapshot>>,
    error: Option<String>,
    load_error: Option<String>,
    version: u64,
    last_tick: i64,
    local_timezone: (i32, String),
    calendar_signature: String,
    calendar_checked_at: Option<Instant>,
    calendar_synced_at: Option<i64>,
    calendar_error: Option<String>,
    observation: Option<Observer>,
    observer_retry: Instant,
    tray_refresh: super::tray::RefreshState,
}

impl TaskManager {
    pub fn start(app: AppHandle, data_path: PathBuf) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel::<Request>();
        let snapshot = Arc::new(RwLock::new(Snapshot::default()));
        let shared = snapshot.clone();
        std::thread::Builder::new()
            .name("task-calendar".into())
            .spawn(move || {
                let (saved, error) = load_state(&data_path);
                let mut runtime = Runtime {
                    app,
                    data_path,
                    saved,
                    files: BTreeMap::new(),
                    shared,
                    load_error: error.clone(),
                    error,
                    version: 0,
                    last_tick: Local::now().timestamp_millis(),
                    local_timezone: current_timezone(),
                    calendar_signature: String::new(),
                    calendar_checked_at: None,
                    calendar_synced_at: None,
                    calendar_error: None,
                    observation: None,
                    observer_retry: Instant::now(),
                    tray_refresh: Default::default(),
                };
                runtime.publish(true);
                runtime.configure_observation();
                runtime.scan();
                runtime.remind(true);
                runtime.sync_calendar();
                runtime.publish(false);
                let mut last_scan = Instant::now();
                let mut scan_interval = Duration::from_secs(5);
                loop {
                    match receiver.recv_timeout(Duration::from_secs(1)) {
                        Ok(request) => {
                            let result = runtime.apply(request.operation);
                            if let Err(error) = &result {
                                runtime.error = Some(error.clone());
                            }
                            runtime.publish(false);
                            let _ = request.reply.send(result);
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    let now = Local::now().timestamp_millis();
                    let resumed = now - runtime.last_tick > 60_000;
                    if runtime.observation.is_none()
                        && crate::vault_watch::available(&runtime.app)
                        && runtime.observer_retry.elapsed() >= Duration::from_secs(30)
                    {
                        runtime.configure_observation();
                        // Attach first, then reconcile changes during fallback.
                        if runtime.observation.is_some() {
                            runtime.scan();
                        }
                    }
                    if let Some(observer) = runtime.observation.as_mut() {
                        match observer.poll() {
                            Ok(updates) if updates.rescan_required => runtime.scan(),
                            Ok(updates) => runtime.apply_watch_changes(updates.changes),
                            Err(_) => {
                                runtime.observation = None;
                                runtime.observer_retry = Instant::now();
                                runtime.scan();
                                last_scan = Instant::now();
                            }
                        }
                    }
                    if resumed
                        || current_timezone() != runtime.local_timezone
                        || (runtime.observation.is_none() && last_scan.elapsed() >= scan_interval)
                    {
                        let start = Instant::now();
                        runtime.scan();
                        // 慢磁盘按上次耗时退避，避免连续扫描占满磁盘。
                        scan_interval =
                            Duration::from_secs(5).max(start.elapsed().saturating_mul(4));
                        last_scan = Instant::now();
                    }
                    runtime.remind(resumed);
                    runtime.last_tick = now;
                    runtime.sync_calendar();
                    runtime.publish(false);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            sender,
            snapshot,
            closing_windows: Default::default(),
        })
    }

    pub fn snapshot(&self) -> Result<Snapshot, String> {
        self.snapshot
            .read()
            .map(|s| s.clone())
            .map_err(|_| "Task calendar lock failed".into())
    }

    pub fn request(&self, operation: Operation) -> Result<(), String> {
        let (reply, result) = mpsc::sync_channel(1);
        self.sender
            .send(Request { operation, reply })
            .map_err(|e| e.to_string())?;
        result.recv().map_err(|e| e.to_string())?
    }
}

impl Runtime {
    fn configure_observation(&mut self) {
        if !crate::vault_watch::available(&self.app) {
            self.observation = None;
            return;
        }
        let broker = self
            .app
            .state::<crate::vault_watch::WatchState>()
            .broker
            .clone();
        let mut observer = self
            .observation
            .take()
            .unwrap_or_else(|| Observer::new(broker));
        if observer
            .set_roots(self.saved.vaults.iter().map(|v| PathBuf::from(&v.path)))
            .is_ok()
        {
            self.observation = Some(observer);
        }
        self.observer_retry = Instant::now();
    }

    fn apply_watch_changes(&mut self, changes: Vec<Change>) {
        if changes.is_empty() {
            return;
        }
        let mut paths = BTreeSet::new();
        for change in changes {
            // Parent metadata changes accompany file writes on some backends.
            if change.kind == Kind::Modified && change.is_directory {
                continue;
            }
            paths.insert(change.path);
            if let Some(old) = change.old_path {
                paths.insert(old);
            }
        }
        let mut changed = false;
        let mut failed = false;
        for path in paths {
            let Some(vault) = self
                .saved
                .vaults
                .iter()
                .filter(|v| path.starts_with(&v.path))
                .max_by_key(|v| Path::new(&v.path).components().count())
                .cloned()
            else {
                continue;
            };
            let root = Path::new(&vault.path);
            // Events are hints, not a history to apply blindly. Inspect the
            // current target so an atomic replacement cannot delete its index.
            match fs::symlink_metadata(&path) {
                Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {
                    if !included_note_path(root, &path, &vault.trash_folder, true) {
                        continue;
                    }
                    let mut notes = Vec::new();
                    if let Err(error) = collect_notes(root, &path, &vault.trash_folder, &mut notes)
                    {
                        failed = true;
                        self.error = Some(error);
                        if let Some(v) = self.saved.vaults.iter_mut().find(|v| v.path == vault.path)
                        {
                            v.unavailable = true;
                        }
                        let mut seen = BTreeSet::new();
                        self.mark_unavailable(&path, &mut seen);
                        continue;
                    }
                    let seen: BTreeSet<_> = notes.iter().cloned().collect();
                    self.files
                        .retain(|p, _| !p.starts_with(&path) || seen.contains(p));
                    for note in notes {
                        failed |= !self.scan_file(root, &note, false);
                    }
                    changed = true;
                }
                Ok(metadata)
                    if metadata.is_file()
                        && !metadata.file_type().is_symlink()
                        && included_note_path(root, &path, &vault.trash_folder, false) =>
                {
                    failed |= !self.scan_file(root, &path, true);
                    changed = true;
                }
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    failed = true;
                    self.error = Some(error.to_string());
                    let mut seen = BTreeSet::new();
                    self.mark_unavailable(&path, &mut seen);
                }
                _ => {
                    let before = self.files.len();
                    self.files.retain(|p, _| !p.starts_with(&path));
                    changed |= self.files.len() != before;
                }
            }
        }
        if failed {
            // Retry read failures through the existing backoff scanner rather
            // than waiting indefinitely for another OS event on the same file.
            self.observation = None;
            self.observer_retry = Instant::now();
            self.scan();
        }
        if changed && self.reconcile_reminders() {
            if let Err(error) = self.persist() {
                self.error = Some(error);
            }
        }
    }

    fn apply(&mut self, operation: Operation) -> Result<(), String> {
        if let Some(error) = &self.load_error {
            return Err(error.clone());
        }
        self.error = None;
        if matches!(
            &operation,
            Operation::Refresh(_) | Operation::Preferences(_)
        ) {
            self.calendar_checked_at = None;
        }
        match operation {
            Operation::Register(vault) => {
                self.saved
                    .excluded_vaults
                    .retain(|path| path != &vault.path);
                if let Some(existing) = self.saved.vaults.iter_mut().find(|v| v.path == vault.path)
                {
                    if existing.trash_folder == vault.trash_folder {
                        return Ok(());
                    }
                    *existing = vault;
                    self.files.clear();
                } else {
                    self.saved.vaults.push(vault);
                }
                self.persist()?;
                self.publish(true);
                self.configure_observation();
                self.scan();
            }
            Operation::Unregister(path) => {
                if !self.saved.excluded_vaults.contains(&path) {
                    self.saved.excluded_vaults.push(path.clone());
                }
                self.saved.vaults.retain(|v| v.path != path);
                self.files
                    .retain(|_, index| index.tasks.first().map_or(true, |t| t.vault_path != path));
                self.configure_observation();
                self.scan();
                self.persist()?;
            }
            Operation::Refresh(path) => {
                self.publish(true);
                if let Some(path) = path {
                    if let Some(vault) = self
                        .saved
                        .vaults
                        .iter()
                        .find(|v| Path::new(&path).starts_with(&v.path))
                        .cloned()
                    {
                        self.scan_file(Path::new(&vault.path), Path::new(&path), true);
                        self.reconcile_reminders();
                        self.persist()?;
                    }
                } else {
                    // 手动刷新时重新解析已有文件，读取失败仍保留不可用的来源信息。
                    for entry in self.files.values_mut() {
                        entry.signature.modified = None;
                    }
                    self.scan();
                }
            }
            Operation::Preferences(patch) => {
                let previous = self.saved.preferences.clone();
                let mut preferences = patch.apply(&previous);
                preferences.reminder_times =
                    reminders::normalize_times(preferences.reminder_times)?;
                // 在串行调度器中校验合并后的开关与目标，避免另一窗口的旧快照覆盖。
                if preferences.mac_calendar
                    && (!previous.mac_calendar || previous.calendar_id != preferences.calendar_id)
                {
                    calendar::validate(&preferences.calendar_id)?;
                }
                let previous_reminders = self.saved.reminders.clone();
                self.saved.preferences = preferences;
                self.reconcile_reminders();
                if let Err(error) = self.persist() {
                    self.saved.preferences = previous;
                    self.saved.reminders = previous_reminders;
                    return Err(error);
                }
                if previous.mac_calendar != self.saved.preferences.mac_calendar
                    || previous.calendar_id != self.saved.preferences.calendar_id
                {
                    self.calendar_synced_at = None;
                }
            }
            Operation::Flush => {
                self.scan();
                self.persist()?;
            }
            Operation::Language(language) => {
                if self.saved.preferences.language != language {
                    let previous =
                        std::mem::replace(&mut self.saved.preferences.language, language);
                    if let Err(error) = self.persist() {
                        self.saved.preferences.language = previous;
                        return Err(error);
                    }
                }
            }
        }
        Ok(())
    }

    fn persist(&mut self) -> Result<(), String> {
        persist_state(&self.data_path, &self.saved, self.load_error.as_deref())
    }

    fn sync_calendar(&mut self) {
        if self.load_error.is_some() {
            return;
        }
        if !self.saved.preferences.mac_calendar {
            self.calendar_signature.clear();
            self.calendar_error = None;
            return;
        }
        let tasks: Vec<Task> = self
            .files
            .values()
            .flat_map(|entry| entry.tasks.clone())
            .collect();
        let signature = storage::hash(
            &serde_json::to_string(&(&tasks, &self.saved.preferences, &self.saved.vaults))
                .unwrap_or_default(),
        );
        // 保存变化立即同步；无变化时每分钟核实事件与权限，失败时也按此间隔重试。
        if signature == self.calendar_signature
            && self
                .calendar_checked_at
                .is_some_and(|last| last.elapsed() < Duration::from_secs(60))
        {
            return;
        }
        self.calendar_signature = signature;
        self.calendar_checked_at = Some(Instant::now());
        match calendar::sync(&mut self.saved, &tasks, &self.data_path) {
            Ok(()) => {
                self.calendar_error = None;
                self.calendar_synced_at = Some(Local::now().timestamp_millis());
            }
            Err(error) => self.calendar_error = Some(error),
        }
    }

    fn publish(&mut self, scanning: bool) {
        let mut tasks: Vec<Task> = self
            .files
            .values()
            .flat_map(|entry| entry.tasks.clone())
            .collect();
        tasks.sort_by(|a, b| {
            a.vault_path
                .cmp(&b.vault_path)
                .then(a.relative_path.cmp(&b.relative_path))
                .then(a.start.cmp(&b.start))
        });
        let Ok(mut shared) = self.shared.write() else {
            return;
        };
        let changed = !(shared.tasks == tasks
            && shared.vaults == self.saved.vaults
            && shared.excluded_vaults == self.saved.excluded_vaults
            && shared.preferences == self.saved.preferences
            && shared.scanning == scanning
            && shared.error == self.error
            && shared.calendar_error == self.calendar_error
            && shared.calendar_synced_at == self.calendar_synced_at);
        if changed {
            self.version += 1;
            *shared = Snapshot {
                version: self.version,
                tasks,
                vaults: self.saved.vaults.clone(),
                excluded_vaults: self.saved.excluded_vaults.clone(),
                preferences: self.saved.preferences.clone(),
                scanning,
                last_synced_at: Some(Local::now().timestamp_millis()),
                error: self.error.clone(),
                calendar_error: self.calendar_error.clone(),
                calendar_synced_at: self.calendar_synced_at,
            };
        }
        // 快照不变时仍检查日期和逾期状态，时间变化不必广播整个索引。
        let refresh_tray = self.tray_refresh.update(&shared, Local::now());
        // 原生菜单读取共享快照前先释放写锁，避免跨线程菜单调用互相等待。
        drop(shared);
        if refresh_tray {
            if let Err(error) = super::tray::refresh(&self.app) {
                self.tray_refresh.invalidate();
                log::warn!("更新托盘待办菜单失败：{error}");
            }
        }
        if changed {
            // 事件只携带版本，窗口按需读取快照。
            let _ = self.app.emit("task-calendar-changed", self.version);
        }
    }

    fn scan(&mut self) {
        refresh_timezone(
            &mut self.files,
            &mut self.local_timezone,
            current_timezone(),
        );
        let mut seen = BTreeSet::new();
        for mut vault in self.saved.vaults.clone() {
            let root = PathBuf::from(&vault.path);
            let result = collect_vault_notes(&mut vault);
            if let Some(entry) = self.saved.vaults.iter_mut().find(|v| v.path == vault.path) {
                entry.unavailable = vault.unavailable;
            }
            let paths = match result {
                Ok(paths) => paths,
                Err(error) => {
                    self.error = Some(format!("{}: {error}", vault.name));
                    self.mark_unavailable(&root, &mut seen);
                    continue;
                }
            };
            let mut unavailable = false;
            for path in paths {
                seen.insert(path.clone());
                unavailable |= !self.scan_file(&root, &path, false);
            }
            if unavailable {
                if let Some(entry) = self.saved.vaults.iter_mut().find(|v| v.path == vault.path) {
                    entry.unavailable = true;
                }
            }
        }
        self.files.retain(|path, _| seen.contains(path));
        if self.reconcile_reminders() {
            if let Err(error) = self.persist() {
                self.error = Some(error);
            }
        }
    }

    fn mark_unavailable(&mut self, root: &Path, seen: &mut BTreeSet<PathBuf>) {
        for (path, entry) in &mut self.files {
            if path.starts_with(root) {
                seen.insert(path.clone());
                entry
                    .tasks
                    .iter_mut()
                    .for_each(|task| task.available = false);
            }
        }
    }

    fn scan_file(&mut self, vault: &Path, path: &Path, force: bool) -> bool {
        let owner = preferred_vault(&self.saved.vaults, path, vault);
        let vault = owner.as_path();
        let result = (|| {
            let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("Note is no longer a regular file".into());
            }
            let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
            if !canonical.starts_with(vault) {
                return Err("Note left its knowledge base".into());
            }
            let signature = Signature {
                modified: metadata.modified().ok(),
                length: metadata.len(),
            };
            if !force
                && self.files.get(path).is_some_and(|entry| {
                    entry.signature == signature
                        && entry
                            .tasks
                            .iter()
                            .all(|t| t.available && Path::new(&t.vault_path) == vault)
                })
            {
                return Ok(());
            }
            let text = storage::read_note(&canonical)?;
            self.files.insert(
                path.into(),
                FileIndex {
                    signature,
                    tasks: parser::parse(&text, vault, path),
                },
            );
            Ok::<(), String>(())
        })();
        if let Err(error) = result {
            if let Some(entry) = self.files.get_mut(path) {
                entry
                    .tasks
                    .iter_mut()
                    .for_each(|task| task.available = false);
            }
            self.error = Some(format!("{}: {error}", path.display()));
            return false;
        }
        true
    }

    fn reconcile_reminders(&mut self) -> bool {
        let now = Local::now().timestamp_millis();
        let preserve_unseen = self.saved.vaults.iter().any(|vault| vault.unavailable)
            || self
                .files
                .values()
                .any(|entry| entry.tasks.iter().any(|task| !task.available));
        let active = build_reminders(
            self.files.values().flat_map(|entry| &entry.tasks),
            &self.saved.reminders,
            preserve_unseen,
            now,
            &self.saved.preferences,
        );
        let changed = serde_json::to_string(&active).ok()
            != serde_json::to_string(&self.saved.reminders).ok();
        self.saved.reminders = active;
        changed
    }

    fn remind(&mut self, catch_up: bool) {
        let now = Local::now().timestamp_millis();
        let due: BTreeSet<String> = self
            .saved
            .reminders
            .iter()
            .filter(|(_, r)| !r.submitted && r.at <= now)
            .map(|(key, _)| key.clone())
            .collect();
        if due.is_empty() {
            return;
        }
        let paths: BTreeSet<(String, String)> = self
            .files
            .values()
            .flat_map(|entry| &entry.tasks)
            .filter(|task| {
                reminders::points(task, &self.saved.preferences)
                    .iter()
                    .any(|(key, _)| due.contains(key))
            })
            .map(|task| (task.vault_path.clone(), task.file_path.clone()))
            .collect();
        // 即使监测有退避，到期前也从磁盘重读，完成或改期后不发送旧提醒。
        for (vault, path) in paths {
            self.scan_file(Path::new(&vault), Path::new(&path), true);
        }
        self.reconcile_reminders();
        let candidates: Vec<Task> = self
            .files
            .values()
            .flat_map(|entry| &entry.tasks)
            .filter(|task| {
                task.available
                    && !task.completed
                    && !task.date_error
                    && reminders::points(task, &self.saved.preferences)
                        .iter()
                        .any(|(key, at)| {
                            due.contains(key)
                                && *at <= now
                                && self
                                    .saved
                                    .reminders
                                    .get(key)
                                    .is_some_and(|record| !record.submitted)
                        })
            })
            .cloned()
            .collect();
        if candidates.is_empty() {
            return;
        }
        let (title, body) =
            reminder_message(&candidates, catch_up, &self.saved.preferences, &due, now);
        if self.saved.preferences.notifications {
            if let Err(error) = self
                .app
                .notification()
                .builder()
                .title(title)
                .body(body)
                .show()
            {
                self.error = Some(error.to_string());
                return;
            }
        }
        for task in candidates {
            for (key, at) in reminders::points(&task, &self.saved.preferences) {
                if at <= now && due.contains(&key) {
                    if let Some(record) = self.saved.reminders.get_mut(&key) {
                        record.submitted = true;
                    }
                }
            }
        }
        if let Err(error) = self.persist() {
            self.error = Some(error);
        }
    }
}

fn reminder_message(
    candidates: &[Task],
    catch_up: bool,
    preferences: &Preferences,
    due: &BTreeSet<String>,
    now: i64,
) -> (String, String) {
    let english = preferences.language == "en";
    let title = if candidates.len() == 1 && !catch_up {
        format!(
            "{}{}",
            if english {
                "Task due: "
            } else {
                "待办到期："
            },
            candidates[0].title
        )
    } else if english {
        format!(
            "{} task reminders{}",
            candidates.len(),
            if catch_up { " missed" } else { "" }
        )
    } else {
        format!(
            "{}{} 项待办",
            if catch_up { "错过了 " } else { "有 " },
            candidates.len()
        )
    };
    let first = &candidates[0];
    let body = if candidates.len() == 1 {
        format!(
            "{} {} · {}",
            first.date.as_deref().unwrap_or_default(),
            reminders::points(first, &preferences)
                .iter()
                .find(|(key, at)| due.contains(key) && *at <= now)
                .and_then(|(_, at)| Local.timestamp_millis_opt(*at).single())
                .map(|time| time.format("%H:%M").to_string())
                .unwrap_or_default(),
            first.relative_path
        )
    } else {
        candidates
            .iter()
            .take(3)
            .map(|task| task.title.as_str())
            .collect::<Vec<_>>()
            .join(" · ")
    };
    let body = if catch_up && candidates.len() == 1 {
        format!("{} · {}", first.title, body)
    } else {
        body
    };
    (title, body)
}

fn current_timezone() -> (i32, String) {
    (
        Local::now().offset().local_minus_utc(),
        iana_time_zone::get_timezone().unwrap_or_default(),
    )
}

fn refresh_timezone(
    files: &mut BTreeMap<PathBuf, FileIndex>,
    previous: &mut (i32, String),
    current: (i32, String),
) {
    if current != *previous {
        *previous = current;
        for entry in files.values_mut() {
            entry.signature.modified = None;
        }
    }
}

fn collect_vault_notes(vault: &mut Vault) -> Result<Vec<PathBuf>, String> {
    let root = Path::new(&vault.path);
    vault.unavailable =
        !root.is_dir() || fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink());
    if vault.unavailable {
        return Err("Knowledge base is unavailable".into());
    }
    let mut paths = Vec::new();
    if let Err(error) = collect_notes(root, root, &vault.trash_folder, &mut paths) {
        vault.unavailable = true;
        return Err(error);
    }
    Ok(paths)
}

fn build_reminders<'a>(
    tasks: impl Iterator<Item = &'a Task>,
    previous: &BTreeMap<String, ReminderRecord>,
    preserve_unseen: bool,
    now: i64,
    preferences: &Preferences,
) -> BTreeMap<String, ReminderRecord> {
    // 不完整扫描不能证明旧任务已被删除；提醒发送前仍会逐文件核实。
    let mut active = if preserve_unseen {
        previous.clone()
    } else {
        BTreeMap::new()
    };
    for task in tasks {
        if task.completed || task.date_error {
            continue;
        }
        for (key, at) in reminders::points(task, preferences) {
            if let Some(record) = previous.get(&key) {
                active.insert(
                    key,
                    ReminderRecord {
                        at,
                        submitted: record.submitted,
                    },
                );
            } else if at > now {
                active.insert(
                    key,
                    ReminderRecord {
                        at,
                        submitted: false,
                    },
                );
            }
        }
    }
    active
}

fn load_state(path: &Path) -> (SavedState, Option<String>) {
    match storage::load(path) {
        Ok(saved) => (saved, None),
        Err(error) => (SavedState::default(), Some(error)),
    }
}

fn persist_state(path: &Path, saved: &SavedState, load_error: Option<&str>) -> Result<(), String> {
    // 读取失败不代表空数据；保留原文件及事件归属记录，等待恢复后重新启动。
    if let Some(error) = load_error {
        return Err(error.into());
    }
    storage::save(path, saved)
}

fn preferred_vault(vaults: &[Vault], path: &Path, fallback: &Path) -> PathBuf {
    // 重叠知识库只保留一份任务，并稳定归属到最内层的已纳入知识库。
    vaults
        .iter()
        .map(|vault| Path::new(&vault.path))
        .filter(|root| path.starts_with(root))
        .max_by_key(|root| root.components().count())
        .unwrap_or(fallback)
        .to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_catch_up_notification_keeps_the_task_content() {
        let task = parser::parse(
            "- [ ] 核对本周方案 @2026-11-10 15:00",
            Path::new("/vault"),
            Path::new("/vault/note.md"),
        )
        .remove(0);
        let at = task.reminder_at.unwrap();
        let due = BTreeSet::from([task.notification_key()]);
        let (title, body) = reminder_message(&[task], true, &Preferences::default(), &due, at + 1);
        assert!(title.contains("错过"));
        assert!(
            body.contains("核对本周方案"),
            "single missed reminder must include the task content: {body}"
        );
        assert!(body.contains("note.md"));
    }

    #[test]
    fn offline_start_keeps_due_reminders_until_sources_are_verified() {
        let task = parser::parse(
            "- [ ] 待办 @2026-11-10 15:00",
            Path::new("/vault"),
            Path::new("/vault/note.md"),
        )
        .remove(0);
        let at = task.reminder_at.unwrap();
        let known = BTreeMap::from([(
            task.notification_key(),
            ReminderRecord {
                at,
                submitted: false,
            },
        )]);
        let offline = build_reminders(
            std::iter::empty(),
            &known,
            true,
            at + 1000,
            &Preferences::default(),
        );
        assert_eq!(offline.len(), 1, "离线不代表删除，已安排的提醒不能丢失");
        let restored = build_reminders(
            std::iter::once(&task),
            &offline,
            false,
            at + 1000,
            &Preferences::default(),
        );
        assert!(!restored[&task.notification_key()].submitted);
        assert!(build_reminders(
            std::iter::empty(),
            &restored,
            false,
            at + 1000,
            &Preferences::default()
        )
        .is_empty());
        assert!(build_reminders(
            std::iter::once(&task),
            &BTreeMap::new(),
            false,
            at + 1000,
            &Preferences::default()
        )
        .is_empty());
    }

    #[test]
    fn same_offset_zone_change_invalidates_cached_future_times() {
        let mut files = BTreeMap::from([(
            PathBuf::from("/vault/note.md"),
            FileIndex {
                signature: Signature {
                    modified: Some(SystemTime::UNIX_EPOCH),
                    length: 42,
                },
                tasks: vec![],
            },
        )]);
        let mut previous = (0, "Europe/London".into());
        refresh_timezone(&mut files, &mut previous, (0, "Africa/Abidjan".into()));
        assert!(
            files
                .values()
                .all(|entry| entry.signature.modified.is_none()),
            "当前偏移相同不能推断未来夏令时相同"
        );
        assert_eq!(previous.1, "Africa/Abidjan");
    }

    #[cfg(unix)]
    #[test]
    fn failed_directory_scan_marks_whole_vault_unavailable() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("mozi-task-scan-{}", uuid::Uuid::new_v4()));
        let blocked = root.join("blocked");
        fs::create_dir_all(&blocked).unwrap();
        fs::write(root.join("note.md"), "- [ ] 待办 @2026-11-10").unwrap();
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0)).unwrap();
        let mut vault = Vault {
            path: root.to_string_lossy().into(),
            name: "QA".into(),
            trash_folder: ".trash".into(),
            unavailable: false,
        };
        let result = collect_vault_notes(&mut vault);
        fs::set_permissions(&blocked, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(&root).unwrap();
        assert!(result.is_err());
        assert!(vault.unavailable, "枚举失败时必须保护整库已有的日历事件");
    }
}

/// Same inclusion policy for event hints and the initial recursive snapshot.
fn included_note_path(root: &Path, path: &Path, trash: &str, directory: bool) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    if path.starts_with(root.join(trash)) {
        return false;
    }
    let parts: Vec<_> = relative.components().collect();
    let directories = if directory {
        parts.len()
    } else {
        parts.len().saturating_sub(1)
    };
    if parts[..directories].iter().any(|part| {
        let name = part.as_os_str().to_string_lossy();
        name.starts_with('.') || matches!(name.as_ref(), "node_modules" | "target")
    }) {
        return false;
    }
    directory
        || path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|ext| {
                ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
            })
}

fn collect_notes(
    root: &Path,
    directory: &Path,
    trash: &str,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            if !included_note_path(root, &path, trash, true) {
                continue;
            }
            collect_notes(root, &path, trash, output)?;
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|ext| {
                    ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
                })
        {
            output.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod release_regression_tests {
    use super::*;
    #[test]
    fn native_hints_and_snapshot_use_the_same_note_scope() {
        let root = Path::new("/vault");
        for path in ["note.md", "nested/UPPER.MARKDOWN", ".hidden.md"] {
            assert!(included_note_path(root, &root.join(path), ".trash", false));
        }
        for path in [
            ".hidden/note.md",
            "node_modules/a.md",
            "target/a.md",
            ".trash/deep/a.md",
            "a.png",
        ] {
            assert!(!included_note_path(root, &root.join(path), ".trash", false));
        }
        assert!(!included_note_path(
            root,
            Path::new("/vault-other/note.md"),
            ".trash",
            false
        ));
        assert!(included_note_path(
            root,
            &root.join("nested"),
            ".trash",
            true
        ));
        assert!(!included_note_path(
            root,
            &root.join(".hidden"),
            ".trash",
            true
        ));
    }

    #[test]
    fn failed_state_load_never_overwrites_the_existing_file() {
        let root = std::env::temp_dir().join(format!("mozi-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("state.json");
        for original in [
            "{broken".to_string(),
            "{\"schemaVersion\":2,\"calendarOwner\":\"existing-owner\"}".to_string(),
        ] {
            fs::write(&path, &original).unwrap();
            let (saved, error) = load_state(&path);
            assert!(error.is_some());
            let result = persist_state(&path, &saved, error.as_deref());
            let after = fs::read_to_string(&path).unwrap();
            assert!(result.is_err(), "load failure must prevent replacement");
            assert_eq!(after, original);
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_state_can_be_created_normally() {
        let root = std::env::temp_dir().join(format!("mozi-state-{}", uuid::Uuid::new_v4()));
        let path = root.join("state.json");
        let (saved, error) = load_state(&path);
        assert!(error.is_none());
        persist_state(&path, &saved, None).unwrap();
        assert_eq!(
            storage::load(&path).unwrap().calendar_owner,
            saved.calendar_owner
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn nested_vault_ownership_is_stable_in_either_registration_order() {
        let outer = Vault {
            path: "/outer".into(),
            name: "outer".into(),
            trash_folder: ".trash".into(),
            unavailable: false,
        };
        let inner = Vault {
            path: "/outer/inner".into(),
            name: "inner".into(),
            trash_folder: ".trash".into(),
            unavailable: false,
        };
        for vaults in [
            vec![outer.clone(), inner.clone()],
            vec![inner.clone(), outer.clone()],
        ] {
            assert_eq!(
                preferred_vault(
                    &vaults,
                    Path::new("/outer/inner/note.md"),
                    Path::new("/outer")
                ),
                PathBuf::from("/outer/inner")
            );
            assert_eq!(
                preferred_vault(&vaults, Path::new("/outer/note.md"), Path::new("/outer")),
                PathBuf::from("/outer")
            );
        }
    }
}
