use crate::{Change, Kind, Page};
use std::{
    collections::{BTreeMap, VecDeque},
    time::{Duration, Instant},
};

pub(crate) const QUIET: Duration = Duration::from_millis(150);
const MAX_DELAY: Duration = Duration::from_millis(500);
const MAX_PATHS: usize = 1024;
const MAX_HISTORY: usize = 32;
const MAX_BYTES: usize = 4 * 1024 * 1024;

pub(crate) struct Journal {
    pub epoch: String,
    pub seq: u64,
    pending: BTreeMap<std::path::PathBuf, Change>,
    first: Option<Instant>,
    last: Option<Instant>,
    rescan: bool,
    pub error: Option<String>,
    history: VecDeque<Page>,
    pub batches: u64,
    pub overflows: u64,
}
impl Journal {
    pub fn new() -> Self {
        Self {
            epoch: uuid::Uuid::new_v4().to_string(),
            seq: 0,
            pending: BTreeMap::new(),
            first: None,
            last: None,
            rescan: false,
            error: None,
            history: VecDeque::new(),
            batches: 0,
            overflows: 0,
        }
    }
    fn touch(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }
    pub fn push(&mut self, mut change: Change, now: Instant) {
        self.touch(now);
        if self.rescan {
            return;
        }
        if change.kind == Kind::Renamed {
            if let Some(old) = &change.old_path {
                self.pending.remove(old);
            }
        }
        if let Some(previous) = self.pending.get(&change.path) {
            if matches!(change.kind, Kind::Modified | Kind::Created) {
                if matches!(previous.kind, Kind::Created | Kind::Renamed) {
                    change.kind = previous.kind;
                    change.old_path = previous.old_path.clone();
                }
            }
        }
        self.pending.insert(change.path.clone(), change);
        if self.pending.len() > MAX_PATHS
            || self.pending.values().map(change_bytes).sum::<usize>() > MAX_BYTES
        {
            self.overflows += 1;
            self.mark_rescan(now, None);
        }
    }
    pub fn mark_rescan(&mut self, now: Instant, error: Option<String>) {
        self.touch(now);
        self.rescan = true;
        self.pending.clear();
        if error.is_some() {
            self.error = error;
        }
    }
    pub fn deadline(&self) -> Option<Instant> {
        Some((self.last? + QUIET).min(self.first? + MAX_DELAY))
    }
    pub fn flush(&mut self, now: Instant) -> bool {
        if self.deadline().map_or(true, |deadline| deadline > now) {
            return false;
        }
        self.first = None;
        self.last = None;
        self.seq += 1;
        self.batches += 1;
        let changes = std::mem::take(&mut self.pending).into_values().collect();
        self.history.push_back(Page {
            epoch: self.epoch.clone(),
            seq: self.seq,
            changes,
            rescan_required: std::mem::take(&mut self.rescan),
            error: self.error.clone(),
        });
        while self.history.len() > MAX_HISTORY
            || self
                .history
                .iter()
                .flat_map(|p| p.changes.iter())
                .map(change_bytes)
                .sum::<usize>()
                > MAX_BYTES
        {
            self.history.pop_front();
        }
        true
    }
    pub fn read(&self, epoch: &str, after: u64) -> Page {
        let gap = epoch != self.epoch
            || after > self.seq
            || self
                .history
                .front()
                .is_some_and(|first| after.saturating_add(1) < first.seq)
            || (after < self.seq && self.history.is_empty());
        let changes = if gap {
            Vec::new()
        } else {
            self.history
                .iter()
                .filter(|p| p.seq > after)
                .flat_map(|p| p.changes.clone())
                .collect()
        };
        Page {
            epoch: self.epoch.clone(),
            seq: self.seq,
            changes,
            rescan_required: gap
                || self
                    .history
                    .iter()
                    .any(|p| p.seq > after && p.rescan_required),
            error: self.error.clone(),
        }
    }
}
fn change_bytes(c: &Change) -> usize {
    c.path.as_os_str().len() + c.old_path.as_ref().map_or(0, |p| p.as_os_str().len()) + 64
}

#[cfg(test)]
mod tests {
    use super::*;
    fn change(path: &str) -> Change {
        Change {
            kind: Kind::Modified,
            path: path.into(),
            old_path: None,
            is_directory: false,
        }
    }
    #[test]
    fn coalesces_and_caps_latency() {
        let mut j = Journal::new();
        let now = Instant::now();
        for i in 0..20 {
            j.push(change("/vault/a.md"), now + Duration::from_millis(i * 20));
        }
        assert!(j.flush(now + MAX_DELAY));
        assert_eq!(j.read(&j.epoch, 0).changes.len(), 1);
    }
    #[test]
    fn overflow_and_cursor_gaps_require_snapshot() {
        let mut j = Journal::new();
        let now = Instant::now();
        for i in 0..1100 {
            j.push(change(&format!("/vault/{i}")), now);
        }
        j.flush(now + QUIET);
        assert!(j.read(&j.epoch, 0).rescan_required);
        for i in 1..40 {
            let at = now + Duration::from_secs(i);
            j.push(change("/vault/a"), at);
            j.flush(at + QUIET);
        }
        assert!(j.read(&j.epoch, 0).rescan_required);
        assert!(j.read("old epoch", j.seq).rescan_required);
        assert!(j.read(&j.epoch, j.seq + 1).rescan_required);
        assert!(!j.read(&j.epoch, j.seq).rescan_required);
    }
    #[test]
    fn rename_survives_following_modify() {
        let mut j = Journal::new();
        let now = Instant::now();
        j.push(
            Change {
                kind: Kind::Renamed,
                path: "/v/b".into(),
                old_path: Some("/v/a".into()),
                is_directory: false,
            },
            now,
        );
        j.push(change("/v/b"), now);
        j.flush(now + QUIET);
        assert_eq!(j.read(&j.epoch, 0).changes[0].old_path, Some("/v/a".into()));
    }
}
