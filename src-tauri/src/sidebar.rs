use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf, time::UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryMetadata {
    created_at: Option<u64>,
    modified_at: Option<u64>,
}

#[tauri::command]
pub async fn sidebar_file_metadata(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<BTreeMap<String, EntryMetadata>, String> {
    if paths.len() > 512 {
        return Err("Too many metadata paths.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = BTreeMap::new();
        for path in paths {
            let canonical = match std::fs::canonicalize(&path) {
                Ok(path) => path,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            };
            crate::ensure_path_allowed(app.state::<crate::SecurityState>().inner(), &canonical)?;
            let metadata = std::fs::metadata(canonical).map_err(|error| error.to_string())?;
            let millis = |value: std::io::Result<std::time::SystemTime>| {
                value
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis() as u64)
            };
            result.insert(
                path,
                EntryMetadata {
                    created_at: millis(metadata.created()),
                    modified_at: millis(metadata.modified()),
                },
            );
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn sidebar_start_file_drag(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    on_end: tauri::ipc::Channel<()>,
) -> Result<(), String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        if std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?.file_type().is_symlink() {
            return Err("Symbolic links cannot be dragged.".into());
        }
        let canonical = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        crate::ensure_path_allowed(app.state::<crate::SecurityState>().inner(), &canonical)?;
        #[cfg(windows)]
        if canonical.components().any(|part| matches!(part, std::path::Component::Prefix(prefix) if matches!(prefix.kind(), std::path::Prefix::UNC(..) | std::path::Prefix::VerbatimUNC(..)))) {
            // 上游原生库暂不支持 UNC，拒绝该路径以免触发其 Shell 项目创建崩溃。
            return Err("Native drag is unavailable for network paths.".into());
        }
        Ok::<_, String>(canonical)
    }).await.map_err(|error| error.to_string())??;
    #[cfg(target_os = "linux")]
    let path = gtk_drag_path(&path)?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let source = window.clone();
    window
        .run_on_main_thread(move || {
            let result = drag::start_drag(
                #[cfg(target_os = "linux")]
                &match source.gtk_window() {
                    Ok(window) => window,
                    Err(error) => {
                        let _ = sender.send(Err(error.to_string()));
                        return;
                    }
                },
                #[cfg(not(target_os = "linux"))]
                &source,
                drag::DragItem::Files(vec![path]),
                drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
                move |_, _| {
                    let _ = on_end.send(());
                },
                drag::Options {
                    mode: drag::DragMode::Copy,
                    ..Default::default()
                },
            )
            .map_err(|error| error.to_string());
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv().map_err(|error| error.to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(any(target_os = "linux", test))]
fn gtk_drag_path(path: &std::path::Path) -> Result<PathBuf, String> {
    // drag 2.1.1 的 GTK 分支自行拼接 file://，必须传入已编码的 URI 路径部分。
    // 编码换行、中文及 #/%，防止 URI 列表被拆分或解析成其他文件。
    tauri::Url::from_file_path(path)
        .map(|url| PathBuf::from(url.path()))
        .map_err(|_| "Invalid file path for native drag.".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn gtk_file_references_round_trip_special_names_without_injecting_more_uris() {
        for name in [
            "note.md",
            "中文 空格#1%?.md",
            "bait\nfile:/tmp/outside.md",
            "a\r\nb.md",
        ] {
            let path = std::env::temp_dir().join(name);
            let encoded = super::gtk_drag_path(&path).unwrap();
            let uri = format!("file://{}", encoded.display());
            assert!(uri.is_ascii());
            assert!(!uri.contains(['\r', '\n']));
            assert_eq!(
                tauri::Url::parse(&uri).unwrap().to_file_path().unwrap(),
                path
            );
        }
    }
}
