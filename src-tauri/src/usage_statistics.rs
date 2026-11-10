use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, io::Read, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};

const PREFERENCES_FILE: &str = "usage-statistics.json";
const CHANGED_EVENT: &str = "usage-statistics-changed";

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default)]
    last_attempt_day: String,
}

fn default_enabled() -> bool {
    configuration().is_some()
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            last_attempt_day: String::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsStatus {
    available: bool,
    enabled: bool,
}

#[derive(Default)]
struct Inner {
    preferences: Option<Preferences>,
    pending: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Default)]
pub struct UsageStatistics {
    inner: Mutex<Inner>,
}

fn endpoint(key: &str) -> Option<&'static str> {
    let mut parts = key.split('-');
    if parts.next()? != "A" {
        return None;
    }
    let region = parts.next()?;
    let id = parts.next()?;
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit()) || parts.next().is_some() {
        return None;
    }
    match region {
        "EU" => Some("https://eu.aptabase.com/api/v0/events"),
        "US" => Some("https://us.aptabase.com/api/v0/events"),
        _ => None,
    }
}

fn configuration() -> Option<(&'static str, &'static str)> {
    // 只接受构建时配置的官方接收端，不允许网页指定任意 URL 或认证头。
    if cfg!(feature = "desktop-e2e") {
        return None;
    }
    let key = option_env!("MOZI_APTABASE_APP_KEY")?.trim();
    Some((key, endpoint(key)?))
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(PREFERENCES_FILE))
        .map_err(|_| "Usage statistics preferences are unavailable".into())
}

fn load(inner: &mut Inner, path: &std::path::Path) -> Result<(), String> {
    if inner.preferences.is_some() {
        return Ok(());
    }
    let preferences = match fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(4097)
                .read_to_end(&mut bytes)
                .map_err(|_| "Usage statistics preferences are unavailable")?;
            if bytes.len() > 4096 {
                return Err("Usage statistics preferences are invalid".into());
            }
            serde_json::from_slice(&bytes)
                .map_err(|_| "Usage statistics preferences are invalid".to_string())?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
        Err(_) => return Err("Usage statistics preferences are unavailable".into()),
    };
    inner.preferences = Some(preferences);
    Ok(())
}

fn save(path: &std::path::Path, preferences: &Preferences) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or("Usage statistics preferences are unavailable")?;
    fs::create_dir_all(directory).map_err(|_| "Could not save usage statistics preferences")?;
    let content = serde_json::to_string(preferences)
        .map_err(|_| "Could not save usage statistics preferences")?;
    crate::write_text_file_atomic_at(path, &content)
        .map_err(|_| "Could not save usage statistics preferences".into())
}

impl UsageStatistics {
    fn status(&self, path: &std::path::Path) -> Result<StatisticsStatus, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Usage statistics are unavailable")?;
        load(&mut inner, path)?;
        Ok(StatisticsStatus {
            available: configuration().is_some(),
            enabled: inner.preferences.as_ref().is_some_and(|p| p.enabled),
        })
    }

    fn set_enabled(
        &self,
        path: &std::path::Path,
        enabled: bool,
    ) -> Result<StatisticsStatus, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Usage statistics are unavailable")?;
        load(&mut inner, path)?;
        if enabled && configuration().is_none() {
            return Err("Usage statistics are not configured".into());
        }
        // 关闭统计立即生效，取消尚未结束的请求；已到达服务器的事件无法撤回。
        if !enabled {
            inner.preferences.as_mut().unwrap().enabled = false;
            if let Some(pending) = inner.pending.take() {
                pending.abort();
            }
        }
        let mut next = inner.preferences.as_ref().unwrap().clone();
        next.enabled = enabled;
        save(path, &next)?;
        inner.preferences = Some(next);
        Ok(StatisticsStatus {
            available: configuration().is_some(),
            enabled,
        })
    }

    fn record(&self, path: &std::path::Path, language: &str, version: &str) -> Result<(), String> {
        let Some((key, url)) = configuration() else {
            return Ok(());
        };
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Usage statistics are unavailable")?;
        load(&mut inner, path)?;
        let preferences = inner.preferences.as_ref().unwrap();
        let now = Utc::now();
        let day = now.format("%Y-%m-%d").to_string();
        if !preferences.enabled || preferences.last_attempt_day == day {
            return Ok(());
        }
        let locale = if language == "en" { "en-US" } else { "zh-CN" };
        let (os, engine) = if cfg!(target_os = "macos") {
            ("macOS", "WebKit")
        } else if cfg!(target_os = "windows") {
            ("Windows", "WebView2")
        } else {
            ("Linux", "WebKitGTK")
        };
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(format!("{os}/ {engine}/ {locale}"))
            .build()
            .map_err(|_| "Could not initialize usage statistics")?;
        // 在同一主进程中统一去重并落盘，避免多窗口或当日重启重复上报。
        let mut next = preferences.clone();
        next.last_attempt_day = day;
        save(path, &next)?;
        inner.preferences = Some(next);
        let session_id = format!(
            "{}{:08}",
            now.timestamp(),
            rand::random::<u32>() % 100_000_000
        );
        let body = json!([{
            "timestamp": now.to_rfc3339(),
            "sessionId": session_id,
            "eventName": "daily_active",
            "systemProps": {
                "isDebug": cfg!(debug_assertions), "osName": os, "osVersion": "",
                "locale": locale, "appVersion": version, "engineName": engine,
                "engineVersion": "", "sdkVersion": concat!("mozi-native@", env!("CARGO_PKG_VERSION"))
            },
            "props": {}
        }]);
        // 不缓存历史事件、不后台补发，避免离线积压和错误的日期/IP 归属。
        inner.pending = Some(tauri::async_runtime::spawn(async move {
            let _ = client
                .post(url)
                .header("App-Key", key)
                .json(&body)
                .send()
                .await;
        }));
        Ok(())
    }
}

#[tauri::command]
pub async fn usage_statistics_status(app: tauri::AppHandle) -> Result<StatisticsStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<UsageStatistics>()
            .status(&preferences_path(&app)?)
    })
    .await
    .map_err(|_| "Could not read usage statistics preferences".to_string())?
}

#[tauri::command]
pub async fn set_usage_statistics_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<StatisticsStatus, String> {
    let event_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        app.state::<UsageStatistics>()
            .set_enabled(&preferences_path(&app)?, enabled)
    })
    .await
    .map_err(|_| "Could not save usage statistics preferences".to_string())?;
    let _ = event_app.emit(CHANGED_EVENT, ());
    result
}

#[tauri::command]
pub async fn record_usage_statistics_activity(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    language: String,
) -> Result<(), String> {
    if window.label() == crate::tasks::TRAY_WINDOW_LABEL
        || !window.is_visible().unwrap_or(false)
        || !window.is_focused().unwrap_or(false)
    {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<UsageStatistics>().record(
            &preferences_path(&app)?,
            &language,
            &app.package_info().version.to_string(),
        )
    })
    .await
    .map_err(|_| "Could not record usage statistics".to_string())?
}
