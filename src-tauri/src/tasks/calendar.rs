use super::model::{CalendarRecord, SavedState, Task};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarAccess {
    pub supported: bool,
    pub permission: String,
    pub calendars: Vec<CalendarChoice>,
    pub default_calendar_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarChoice {
    pub id: String,
    pub title: String,
    pub source: String,
}

#[cfg(target_os = "macos")]
fn call(input: Value) -> Result<Value, String> {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;
    extern "C" {
        fn mozi_calendar_call(json: *const c_char) -> *mut c_char;
        fn mozi_calendar_free(value: *mut c_char);
    }
    let input = CString::new(input.to_string()).map_err(|e| e.to_string())?;
    // 桥接层返回独立分配的 UTF-8 JSON，读取后必须交回同一层释放。
    let output = unsafe { mozi_calendar_call(input.as_ptr()) };
    if output.is_null() {
        return Err("Calendar returned no response".into());
    }
    let result = unsafe { CStr::from_ptr(output) }
        .to_string_lossy()
        .into_owned();
    unsafe { mozi_calendar_free(output) };
    let result: Value = serde_json::from_str(&result).map_err(|e| e.to_string())?;
    if let Some(error) = result.get("error").and_then(Value::as_str) {
        return Err(error.into());
    }
    Ok(result)
}

#[cfg(not(target_os = "macos"))]
fn call(_input: Value) -> Result<Value, String> {
    Err("System calendar sync is only available on macOS".into())
}

pub fn access(request: bool) -> Result<CalendarAccess, String> {
    if !cfg!(target_os = "macos") {
        return Ok(CalendarAccess {
            supported: false,
            permission: "unsupported".into(),
            calendars: Vec::new(),
            default_calendar_id: String::new(),
        });
    }
    serde_json::from_value(call(json!({ "operation": "access", "request": request }))?)
        .map_err(|e| e.to_string())
}

pub fn validate(calendar_id: &str) -> Result<(), String> {
    let access = access(false)?;
    if access.permission != "granted" {
        return Err("Allow full calendar access before enabling sync".into());
    }
    if !access
        .calendars
        .iter()
        .any(|calendar| calendar.id == calendar_id)
    {
        return Err("Choose an available writable calendar".into());
    }
    Ok(())
}

pub fn sync(saved: &mut SavedState, tasks: &[Task], path: &Path) -> Result<(), String> {
    use chrono::{Local, NaiveDate};
    let mut items = BTreeMap::new();
    for task in tasks {
        if task.completed || task.date_error || !task.available || task.date.is_none() {
            continue;
        }
        let (start, end) = if task.time.is_some() {
            let Some(start) = task.reminder_at else {
                continue;
            };
            (start, start + 30 * 60_000)
        } else {
            let start =
                NaiveDate::parse_from_str(task.date.as_deref().unwrap_or_default(), "%Y-%m-%d")
                    .ok()
                    .and_then(|date| date.and_hms_opt(0, 0, 0))
                    .and_then(|date| date.and_local_timezone(Local).single())
                    .map(|date| date.timestamp_millis());
            let (Some(start), Some(end)) = (start, task.deadline_at) else {
                continue;
            };
            (start, end)
        };
        let notes = if saved.preferences.language == "en" {
            format!(
                "From Mozi: {}\nEdit the task in its source note. Saved changes sync to Calendar.",
                task.relative_path
            )
        } else {
            format!(
                "来自墨知：{}\n请在来源笔记中完成或改期，保存后同步到系统日历。",
                task.relative_path
            )
        };
        let mut item = json!({
            "calendarId": saved.preferences.calendar_id,
            "vaultPath": task.vault_path, "filePath": task.file_path,
            "title": task.title, "notes": notes, "allDay": task.time.is_none(),
            "startAt": start, "endAt": end,
        });
        item["fingerprint"] = json!(super::storage::hash(&item.to_string()));
        items.insert(task.id.clone(), item);
    }
    // 暂不可读的来源不能当成删除。正常删除或移出纳入范围才移除对应事件。
    let protected = protected_records(saved, tasks, &items);
    let previous: BTreeMap<_, _> = saved
        .calendar_events
        .iter()
        .filter(|(key, _)| !protected.contains_key(*key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    // 新事件先落盘待提交记录；中途退出后可按专属标记找回，避免重复创建。
    for (key, item) in &items {
        saved
            .calendar_events
            .entry(key.clone())
            .or_insert_with(|| CalendarRecord {
                event_id: String::new(),
                calendar_id: saved.preferences.calendar_id.clone(),
                vault_path: item["vaultPath"].as_str().unwrap_or_default().into(),
                file_path: item["filePath"].as_str().unwrap_or_default().into(),
                start_at: item["startAt"].as_i64().unwrap_or_default(),
                end_at: item["endAt"].as_i64().unwrap_or_default(),
                fingerprint: String::new(),
            });
    }
    super::storage::save(path, saved)?;
    let response = call(json!({
        "operation": "sync", "owner": saved.calendar_owner,
        "calendarId": saved.preferences.calendar_id, "items": items, "previous": previous,
    }))?;
    let mut records: BTreeMap<String, CalendarRecord> =
        serde_json::from_value(response["records"].clone()).map_err(|e| e.to_string())?;
    records.extend(protected);
    saved.calendar_events = records;
    super::storage::save(path, saved)
}

fn protected_records(
    saved: &SavedState,
    tasks: &[Task],
    items: &BTreeMap<String, Value>,
) -> BTreeMap<String, CalendarRecord> {
    saved
        .calendar_events
        .iter()
        .filter(|(key, record)| {
            // 已验证的活动项必须携带旧映射参与更新，保护记录不能覆盖成功后的新映射。
            if items.contains_key(*key) {
                return false;
            }
            let enrolled = saved
                .vaults
                .iter()
                .find(|vault| vault.path == record.vault_path);
            enrolled.is_some_and(|vault| vault.unavailable)
                || tasks.iter().any(|task| &task.id == *key && !task.available)
                || (enrolled.is_some()
                    && match std::fs::symlink_metadata(&record.file_path) {
                        Ok(metadata) => {
                            let path = Path::new(&record.file_path);
                            // 特殊文件与符号链接不能读取；来源不可用时保留已有事件。
                            !metadata.is_file()
                                || match path.canonicalize() {
                                    Ok(canonical) if canonical.starts_with(&record.vault_path) => {
                                        super::storage::read_note(&canonical).is_err()
                                    }
                                    _ => true,
                                }
                        }
                        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
                    })
        })
        .map(|(key, record)| (key.clone(), record.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::{model::Vault, parser};

    #[test]
    fn readable_task_updates_keep_old_event_mapping_when_sibling_source_is_unavailable() {
        let task = parser::parse(
            "- [ ] 改期后的任务 @2026-12-20",
            Path::new("/vault"),
            Path::new("/vault/note.md"),
        )
        .remove(0);
        let record = CalendarRecord {
            event_id: "existing-event".into(),
            calendar_id: "calendar".into(),
            vault_path: "/vault".into(),
            file_path: "/vault/note.md".into(),
            start_at: 0,
            end_at: 1,
            fingerprint: "old".into(),
        };
        let mut saved = SavedState::default();
        saved.vaults.push(Vault {
            path: "/vault".into(),
            name: "QA".into(),
            trash_folder: ".trash".into(),
            unavailable: true,
        });
        saved
            .calendar_events
            .insert(task.id.clone(), record.clone());
        saved
            .calendar_events
            .insert("temporarily-missing-task".into(), record);
        let items = BTreeMap::from([(task.id.clone(), Value::Null)]);
        let protected = protected_records(&saved, std::slice::from_ref(&task), &items);
        assert!(
            !protected.contains_key(&task.id),
            "可读任务必须携带旧映射参与更新，不能被旧保护记录覆盖"
        );
        assert!(protected.contains_key("temporarily-missing-task"));
        let previous: BTreeMap<_, _> = saved
            .calendar_events
            .iter()
            .filter(|(key, _)| !protected.contains_key(*key))
            .collect();
        assert_eq!(previous[&task.id].event_id, "existing-event");
    }
}

#[cfg(all(test, unix))]
mod source_path_tests {
    use super::super::model::Vault;
    use super::*;
    use std::{fs, os::unix::fs::symlink};
    #[test]
    fn replaced_symlink_source_is_protected_without_reading_outside_the_vault() {
        let root =
            std::env::temp_dir().join(format!("mozi-calendar-path-{}", uuid::Uuid::new_v4()));
        let vault = root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let outside = root.join("outside.md");
        fs::write(&outside, "ordinary text").unwrap();
        let path = vault.join("note.md");
        symlink(&outside, &path).unwrap();
        let mut saved = SavedState::default();
        saved.vaults.push(Vault {
            path: vault.to_string_lossy().into(),
            name: "QA".into(),
            trash_folder: ".trash".into(),
            unavailable: false,
        });
        saved.calendar_events.insert(
            "task".into(),
            CalendarRecord {
                event_id: "event".into(),
                calendar_id: "calendar".into(),
                vault_path: vault.to_string_lossy().into(),
                file_path: path.to_string_lossy().into(),
                start_at: 0,
                end_at: 1,
                fingerprint: "old".into(),
            },
        );
        let protected = protected_records(&saved, &[], &BTreeMap::new());
        fs::remove_dir_all(&root).unwrap();
        assert!(
            protected.contains_key("task"),
            "replacement is unavailable, not a verified deletion"
        );
    }
}

#[cfg(all(test, unix))]
mod special_file_tests {
    use super::*;
    use std::{
        ffi::CString,
        fs,
        os::unix::{ffi::OsStrExt, fs::OpenOptionsExt},
        sync::mpsc,
        time::Duration,
    };
    #[test]
    fn fifo_source_never_blocks_calendar_or_task_reads() {
        let root =
            std::env::temp_dir().join(format!("mozi-calendar-fifo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("note.md");
        let name = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        let (tx, rx) = mpsc::channel();
        let read_path = path.clone();
        let thread = std::thread::spawn(move || {
            let _ = tx.send(super::super::storage::read_note(&read_path));
        });
        let result = rx.recv_timeout(Duration::from_millis(500));
        if result.is_err() {
            // 旧实现卡住时释放临时 FIFO，保证失败用例也能退出。
            if let Ok(mut writer) = fs::OpenOptions::new()
                .write(true)
                .custom_flags(libc::O_NONBLOCK)
                .open(&path)
            {
                use std::io::Write;
                let _ = writer.write_all(b"body");
            }
            let _ = rx.recv_timeout(Duration::from_secs(1));
        }
        thread.join().unwrap();
        fs::remove_dir_all(root).unwrap();
        assert!(
            result.is_ok(),
            "reading a special file must return immediately"
        );
        assert!(result.unwrap().is_err());
    }
}
