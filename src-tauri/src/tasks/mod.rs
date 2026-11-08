mod calendar;
mod index;
mod model;
mod parser;
mod storage;
mod tray;

use index::Operation;
pub use index::TaskManager;
use model::{PreferencesPatch, Snapshot, Vault};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_notification::NotificationExt;
pub use tray::show_window;

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("MarkdownPress/task-calendar/state.json");
    app.manage(TaskManager::start(app.clone(), path)?);
    Ok(())
}

async fn request(app: AppHandle, operation: Operation) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<TaskManager>().request(operation))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_calendar_snapshot(app: AppHandle) -> Result<Snapshot, String> {
    app.state::<TaskManager>().snapshot()
}

#[tauri::command]
pub async fn task_calendar_register_vault(
    app: AppHandle,
    path: String,
    trash_folder: String,
) -> Result<(), String> {
    let handle = app.clone();
    let vault = tauri::async_runtime::spawn_blocking(move || {
        let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
        crate::ensure_path_allowed(handle.state::<crate::SecurityState>().inner(), &canonical)?;
        if !canonical.is_dir() {
            return Err("A knowledge base must be a directory".into());
        }
        let trash = PathBuf::from(&trash_folder);
        if trash.is_absolute()
            || trash
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err("Invalid trash folder".into());
        }
        Ok::<Vault, String>(Vault {
            name: canonical
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone()),
            path: canonical.to_string_lossy().into_owned(),
            trash_folder,
            unavailable: false,
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    request(app, Operation::Register(vault)).await
}

#[tauri::command]
pub async fn task_calendar_unregister_vault(app: AppHandle, path: String) -> Result<(), String> {
    request(app, Operation::Unregister(path)).await
}

#[tauri::command]
pub async fn task_calendar_refresh(app: AppHandle, path: Option<String>) -> Result<(), String> {
    if let Some(path) = &path {
        // 此命令只能刷新已纳入库中的路径，不能借此枚举任意磁盘文件。
        let snapshot = app.state::<TaskManager>().snapshot()?;
        let candidate = PathBuf::from(path);
        if !snapshot
            .vaults
            .iter()
            .any(|v| candidate.starts_with(&v.path))
        {
            return Ok(());
        }
    }
    request(app, Operation::Refresh(path)).await
}

#[tauri::command]
pub async fn task_calendar_set_preferences(
    app: AppHandle,
    preferences: PreferencesPatch,
) -> Result<(), String> {
    if preferences.background == Some(true) {
        let language = app.state::<TaskManager>().snapshot()?.preferences.language;
        tray::ensure(&app, &language)?;
    }
    request(app, Operation::Preferences(preferences)).await
}

#[tauri::command]
pub async fn task_calendar_macos_access(
    request_access: bool,
) -> Result<calendar::CalendarAccess, String> {
    tauri::async_runtime::spawn_blocking(move || calendar::access(request_access))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_calendar_set_language(app: AppHandle, language: String) -> Result<(), String> {
    request(
        app,
        Operation::Language(if language == "en" {
            language
        } else {
            "zh-CN".into()
        }),
    )
    .await
}

#[tauri::command]
pub async fn task_calendar_test_notification(
    app: AppHandle,
    language: String,
) -> Result<(), String> {
    let english = language == "en";
    app.notification()
        .builder()
        .title(if english {
            "Mozi task reminders"
        } else {
            "墨知待办提醒"
        })
        .body(if english {
            "Test notification. Mozi will remind you when a scheduled task is due."
        } else {
            "这是一条测试通知，已安排的待办到期时将在这里提醒。"
        })
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn task_calendar_flush(app: AppHandle) -> Result<(), String> {
    request(app, Operation::Flush).await
}

#[tauri::command]
pub async fn task_calendar_keep_background(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<bool, String> {
    if let Err(error) = request(app.clone(), Operation::Flush).await {
        log::warn!("退出前日程缓存写入失败，笔记仍由文档保存保护处理：{error}");
    }
    let preferences = app.state::<TaskManager>().snapshot()?.preferences;
    if !preferences.background {
        return Ok(false);
    }
    crate::native_window_close::leave_fullscreen(&window).await?;
    let manager = app.state::<TaskManager>();
    let mut closing = manager.closing_windows.lock().map_err(|e| e.to_string())?;
    let windows = app.webview_windows().keys().cloned().collect();
    tray::ensure(&app, &preferences.language)?;
    let keep = reserve_background_window(&mut closing, &windows, window.label());
    let result = if keep {
        window.hide()
    } else {
        window.destroy()
    };
    if let Err(error) = result {
        closing.remove(window.label());
        return Err(error.to_string());
    }
    Ok(true)
}

fn reserve_background_window(
    closing: &mut std::collections::BTreeSet<String>,
    windows: &std::collections::BTreeSet<String>,
    current: &str,
) -> bool {
    // 决策与原生操作共用进程锁；尚未销毁的其他关窗请求也按即将关闭计数。
    closing.retain(|label| windows.contains(label));
    closing.insert(current.into());
    let keep = windows.iter().all(|label| closing.contains(label));
    if keep {
        closing.remove(current);
    }
    keep
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    #[test]
    fn simultaneous_window_closes_retain_one_background_window() {
        let windows = BTreeSet::from(["main".into(), "win-1".into()]);
        let mut closing = BTreeSet::new();
        assert!(!reserve_background_window(&mut closing, &windows, "main"));
        assert!(reserve_background_window(&mut closing, &windows, "win-1"));
        assert!(!closing.contains("win-1"));
    }
}
