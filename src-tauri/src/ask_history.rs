use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

static HISTORY_WRITE_LOCK: Mutex<()> = Mutex::new(());
const HISTORY_FILE: &str = "ask-history.v2.json";
const HISTORY_LIMIT: usize = 50;

fn normalize_vault_root(root: &str) -> String {
    let path = root.replace('\\', "/");
    let windows = path.starts_with("//")
        || (path.as_bytes().get(1) == Some(&b':') && path.as_bytes().get(2) == Some(&b'/'));
    if windows {
        path.to_lowercase()
    } else {
        path
    }
}

fn valid_item(item: &Value) -> bool {
    item["id"].is_string()
        && item["question"].is_string()
        && item["at"].is_number()
        && item["answer"]["answerMarkdown"].is_string()
}

fn merge_history_at(
    path: &Path,
    vault_root: &str,
    mut items: Vec<Value>,
) -> Result<Vec<Value>, String> {
    if items.iter().any(|item| !valid_item(item)) {
        return Err("Invalid question history item".to_string());
    }
    // 所有窗口的读取、合并、替换共用同一把锁，避免完整快照互相覆盖。
    let _guard = HISTORY_WRITE_LOCK
        .lock()
        .map_err(|_| "History write lock is unavailable".to_string())?;
    match fs::read_to_string(path) {
        Ok(raw) => {
            let stored: Value = serde_json::from_str(&raw)
                .map_err(|error| format!("Invalid question history: {error}"))?;
            if stored["version"] != 2
                || stored["vaultRoot"]
                    .as_str()
                    .map(normalize_vault_root)
                    .as_deref()
                    != Some(normalize_vault_root(vault_root).as_str())
                || !stored["items"].is_array()
            {
                return Err(
                    "Question history belongs to another vault or has an invalid format"
                        .to_string(),
                );
            }
            items.extend(
                stored["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|item| valid_item(item))
                    .cloned(),
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to read question history: {error}")),
    }
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item["id"].as_str().unwrap().to_string()));
    items.sort_by(|left, right| {
        right["at"]
            .as_f64()
            .unwrap()
            .total_cmp(&left["at"].as_f64().unwrap())
    });
    items.truncate(HISTORY_LIMIT);
    let envelope = json!({ "version": 2, "vaultRoot": vault_root, "items": items });
    crate::write_text_file_atomic_at(path, &envelope.to_string())?;
    Ok(items)
}

#[tauri::command]
pub async fn merge_ask_vault_history(
    app: tauri::AppHandle,
    path: String,
    vault_root: String,
    items: Vec<Value>,
) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = crate::canonicalize_scope_path(&path)?;
        crate::ensure_path_allowed(app.state::<crate::SecurityState>().inner(), &canonical)?;
        if canonical.file_name().and_then(|name| name.to_str()) != Some(HISTORY_FILE) {
            return Err("Invalid question history filename".to_string());
        }
        merge_history_at(&canonical, &vault_root, items)
    })
    .await
    .map_err(|error| format!("Failed to join question history task: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn item(id: usize) -> Value {
        json!({ "id": id.to_string(), "question": "问题", "at": id, "answer": { "answerMarkdown": "回答" } })
    }

    fn directory() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("mozi-history-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn concurrent_windows_preserve_every_answer() {
        let dir = directory();
        let path = dir.join(HISTORY_FILE);
        let barrier = Arc::new(Barrier::new(16));
        let threads: Vec<_> = (0..16)
            .map(|id| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    merge_history_at(&path, "/vault", vec![item(id)]).unwrap();
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let saved: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(
            saved["items"],
            Value::Array((0..16).rev().map(item).collect())
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stale_migration_snapshots_merge_deduplicate_and_keep_the_latest_fifty() {
        let dir = directory();
        let path = dir.join(HISTORY_FILE);
        merge_history_at(&path, "/vault", (0..60).map(item).collect()).unwrap();
        let mut updated = item(59);
        updated["question"] = json!("更新的问题");
        let saved = merge_history_at(&path, "/vault", vec![updated.clone(), item(0)]).unwrap();
        assert_eq!(saved.len(), 50);
        assert_eq!(saved[0], updated);
        assert_eq!(saved[49], item(10));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_foreign_or_corrupt_history_without_overwriting_it() {
        let dir = directory();
        let path = dir.join(HISTORY_FILE);
        for raw in [
            json!({"version": 2, "vaultRoot": "/Other", "items": [item(1)]}).to_string(),
            "broken json".to_string(),
        ] {
            fs::write(&path, &raw).unwrap();
            assert!(merge_history_at(&path, "/other", vec![item(2)]).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), raw);
        }
        assert!(merge_history_at(&path, "/other", vec![json!({"id": "invalid"})]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn windows_vault_aliases_share_history() {
        let dir = directory();
        let path = dir.join(HISTORY_FILE);
        merge_history_at(&path, "C:\\Notes\\Work", vec![item(1)]).unwrap();
        assert_eq!(
            merge_history_at(&path, "c:/notes/work", vec![item(2)]).unwrap(),
            vec![item(2), item(1)]
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
