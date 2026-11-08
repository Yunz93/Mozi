use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Created,
    Modified,
    Removed,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub kind: Kind,
    pub path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<PathBuf>,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub subscription_id: String,
    pub epoch: String,
    pub seq: u64,
    /// Canonical scope target, not the potentially broader physical watch root.
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub epoch: String,
    pub seq: u64,
    pub changes: Vec<Change>,
    pub rescan_required: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Notice {
    pub subscription_id: String,
    pub epoch: String,
    pub seq: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub watchers: usize,
    pub subscriptions: usize,
    pub batches: u64,
    pub overflows: u64,
}

#[derive(Debug, Clone)]
pub(crate) enum Scope {
    Directory(PathBuf),
    File(PathBuf),
}
impl Scope {
    pub fn contains(&self, path: &Path) -> bool {
        match self {
            Self::Directory(root) => path.starts_with(root),
            Self::File(file) => path == file,
        }
    }
    pub fn filter(&self, change: &Change) -> Option<Change> {
        let inside = self.contains(&change.path);
        let old_inside = change.old_path.as_deref().is_some_and(|p| self.contains(p));
        match (inside, old_inside) {
            (true, true) => Some(change.clone()),
            (true, false) => {
                let mut c = change.clone();
                c.old_path = None;
                if c.kind == Kind::Renamed {
                    c.kind = Kind::Created
                }
                Some(c)
            }
            (false, true) => Some(Change {
                kind: Kind::Removed,
                path: change.old_path.clone()?,
                old_path: None,
                is_directory: change.is_directory,
            }),
            _ => None,
        }
    }
}
