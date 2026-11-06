use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub notifications: bool,
    pub background: bool,
    pub language: String,
    pub mac_calendar: bool,
    pub calendar_id: String,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            notifications: false,
            background: false,
            language: "zh-CN".into(),
            mac_calendar: false,
            calendar_id: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub path: String,
    pub name: String,
    pub trash_folder: String,
    #[serde(default)]
    pub unavailable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub vault_path: String,
    pub file_path: String,
    pub relative_path: String,
    pub title: String,
    pub completed: bool,
    pub date: Option<String>,
    pub time: Option<String>,
    pub reminder_at: Option<i64>,
    pub deadline_at: Option<i64>,
    pub date_error: bool,
    pub line: usize,
    pub start: usize,
    pub end: usize,
    pub raw_line: String,
    pub available: bool,
}

impl Task {
    pub fn notification_key(&self) -> String {
        super::storage::hash(&format!(
            "{}\0{}\0{}\0{}",
            self.vault_path,
            self.title,
            self.date.as_deref().unwrap_or_default(),
            self.time.as_deref().unwrap_or_default()
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u64,
    pub tasks: Vec<Task>,
    pub vaults: Vec<Vault>,
    pub excluded_vaults: Vec<String>,
    pub preferences: Preferences,
    pub scanning: bool,
    pub last_synced_at: Option<i64>,
    pub error: Option<String>,
    pub calendar_error: Option<String>,
    pub calendar_synced_at: Option<i64>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            version: 0,
            tasks: Vec::new(),
            vaults: Vec::new(),
            excluded_vaults: Vec::new(),
            preferences: Preferences::default(),
            scanning: false,
            last_synced_at: None,
            error: None,
            calendar_error: None,
            calendar_synced_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRecord {
    pub at: i64,
    pub submitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SavedState {
    pub schema_version: u32,
    pub preferences: Preferences,
    pub vaults: Vec<Vault>,
    pub excluded_vaults: Vec<String>,
    pub reminders: BTreeMap<String, ReminderRecord>,
    pub calendar_owner: String,
    pub calendar_events: BTreeMap<String, CalendarRecord>,
}

impl Default for SavedState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            preferences: Preferences::default(),
            vaults: Vec::new(),
            excluded_vaults: Vec::new(),
            reminders: BTreeMap::new(),
            calendar_owner: uuid::Uuid::new_v4().to_string(),
            calendar_events: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRecord {
    pub event_id: String,
    pub calendar_id: String,
    pub vault_path: String,
    pub file_path: String,
    pub start_at: i64,
    pub end_at: i64,
    pub fingerprint: String,
}
