use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    fs,
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const PREFERENCES_FILE: &str = "usage-statistics.json";
const CHANGED_EVENT: &str = "usage-statistics-changed";

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default)]
    last_reported_day: String,
}

fn default_enabled() -> bool {
    configuration().is_some()
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            last_reported_day: String::new(),
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
    last_attempt: Option<Instant>,
}

#[derive(Default)]
pub struct UsageStatistics {
    inner: Arc<Mutex<Inner>>,
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
            inner.last_attempt = None;
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
        self.record_to(path, language, version, configuration())
    }

    fn record_to(
        &self,
        path: &std::path::Path,
        language: &str,
        version: &str,
        configured: Option<(&str, &str)>,
    ) -> Result<(), String> {
        let Some((key, url)) = configured else {
            return Ok(());
        };
        let (key, url) = (key.to_owned(), url.to_owned());
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Usage statistics are unavailable")?;
        load(&mut inner, path)?;
        let preferences = inner.preferences.as_ref().unwrap();
        let now = Utc::now();
        let day = now.format("%Y-%m-%d").to_string();
        if !preferences.enabled
            || preferences.last_reported_day == day
            || inner
                .pending
                .as_ref()
                .is_some_and(|task| !task.inner().is_finished())
            || inner
                .last_attempt
                .is_some_and(|last| last.elapsed() < Duration::from_secs(60))
        {
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
        // 请求完成前只做进程内限频，失败不能被误记为当天已经成功上报。
        inner.last_attempt = Some(Instant::now());
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
        let shared = self.inner.clone();
        let path = path.to_path_buf();
        // 只在当前活跃时重试同日请求，不缓存或补发历史日期的事件。
        inner.pending = Some(tauri::async_runtime::spawn(async move {
            let delivered = match client
                .post(url)
                .header("App-Key", key)
                .json(&body)
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => true,
                Ok(response) => {
                    log::warn!(
                        "Usage statistics delivery failed (HTTP {})",
                        response.status().as_u16()
                    );
                    false
                }
                Err(error) => {
                    // 日志只记录错误类别，不包含密钥、请求体或网络地址。
                    log::warn!(
                        "Usage statistics delivery failed ({})",
                        if error.is_timeout() {
                            "timeout"
                        } else {
                            "transport"
                        }
                    );
                    false
                }
            };
            if !delivered {
                return;
            }
            let saved = tauri::async_runtime::spawn_blocking(move || {
                let mut inner = shared
                    .lock()
                    .map_err(|_| "Usage statistics are unavailable".to_string())?;
                let mut next = inner
                    .preferences
                    .as_ref()
                    .ok_or("Usage statistics preferences are unavailable")?
                    .clone();
                next.last_reported_day = day;
                // 保留请求期间用户修改的开关，成功回调不能重新开启已关闭的统计。
                // 服务端已确认接收，即使写盘失败，也必须先在内存中防止重复发送。
                inner.preferences = Some(next.clone());
                save(&path, &next)
            })
            .await;
            if !matches!(saved, Ok(Ok(()))) {
                log::warn!("Could not save successful usage statistics delivery");
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::{TcpListener, TcpStream},
        sync::atomic::{AtomicBool, AtomicUsize, Ordering},
        thread,
    };

    struct TestEndpoint {
        url: String,
        received: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl TestEndpoint {
        fn start(first_status: Option<u16>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let received = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let (requests, stopped) = (received.clone(), stop.clone());
            let worker = thread::spawn(move || {
                for stream in listener.incoming() {
                    let mut stream = stream.unwrap();
                    if stopped.load(Ordering::SeqCst) {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut reader = BufReader::new(&mut stream);
                    let mut length = 0;
                    loop {
                        let mut line = String::new();
                        reader.read_line(&mut line).unwrap();
                        if line == "\r\n" {
                            break;
                        }
                        if let Some(value) =
                            line.to_ascii_lowercase().strip_prefix("content-length:")
                        {
                            length = value.trim().parse().unwrap();
                        }
                    }
                    let mut body = vec![0; length];
                    reader.read_exact(&mut body).unwrap();
                    let event: serde_json::Value = serde_json::from_slice(&body).unwrap();
                    assert_eq!(event[0]["eventName"], "daily_active");
                    assert_eq!(event[0]["props"], json!({}));
                    let attempt = requests.fetch_add(1, Ordering::SeqCst);
                    if let Some(status) = if attempt == 0 {
                        first_status
                    } else {
                        Some(200)
                    } {
                        write!(stream, "HTTP/1.1 {status} Test\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}").unwrap();
                    }
                }
            });
            Self {
                url: format!("http://{address}/events"),
                received,
                stop,
                worker: Some(worker),
            }
        }
    }

    impl Drop for TestEndpoint {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            let address = self
                .url
                .trim_start_matches("http://")
                .trim_end_matches("/events");
            let _ = TcpStream::connect(address);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    fn complete_request(statistics: &UsageStatistics) {
        let handle = statistics.inner.lock().unwrap().pending.take();
        assert!(
            handle.is_some(),
            "An unsuccessful report must remain retryable on the same day"
        );
        tauri::async_runtime::block_on(handle.unwrap()).unwrap();
    }

    #[test]
    fn failed_delivery_retries_then_deduplicates_only_after_success() {
        for first_status in [Some(503), None] {
            let server = TestEndpoint::start(first_status);
            let directory =
                std::env::temp_dir().join(format!("mozi-statistics-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&directory).unwrap();
            let path = directory.join("usage.json");
            fs::write(&path, r#"{"enabled":true,"lastAttemptDay":""}"#).unwrap();
            let statistics = UsageStatistics::default();
            let configured = Some(("A-EU-123", server.url.as_str()));
            statistics.record_to(&path, "zh", "qa", configured).unwrap();
            complete_request(&statistics);
            statistics.record_to(&path, "zh", "qa", configured).unwrap();
            assert!(
                statistics.inner.lock().unwrap().pending.is_none(),
                "Failed requests must be rate-limited before retrying"
            );
            statistics.inner.lock().unwrap().last_attempt = None;
            statistics.record_to(&path, "zh", "qa", configured).unwrap();
            complete_request(&statistics);
            assert_eq!(server.received.load(Ordering::SeqCst), 2);
            let saved: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(
                saved["lastReportedDay"],
                Utc::now().format("%Y-%m-%d").to_string()
            );
            statistics.record_to(&path, "zh", "qa", configured).unwrap();
            assert!(statistics.inner.lock().unwrap().pending.is_none());
            fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn successful_delivery_stays_deduplicated_when_preferences_cannot_be_saved() {
        let server = TestEndpoint::start(Some(200));
        let directory =
            std::env::temp_dir().join(format!("mozi-statistics-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join("usage.json");
        fs::create_dir_all(&path).unwrap();
        let statistics = UsageStatistics::default();
        let mut preferences = Preferences::default();
        preferences.enabled = true;
        statistics.inner.lock().unwrap().preferences = Some(preferences);
        let configured = Some(("A-EU-123", server.url.as_str()));
        statistics.record_to(&path, "zh", "qa", configured).unwrap();
        complete_request(&statistics);
        assert_eq!(
            statistics
                .inner
                .lock()
                .unwrap()
                .preferences
                .as_ref()
                .unwrap()
                .last_reported_day,
            Utc::now().format("%Y-%m-%d").to_string()
        );
        statistics.inner.lock().unwrap().last_attempt = None;
        statistics.record_to(&path, "zh", "qa", configured).unwrap();
        assert!(statistics.inner.lock().unwrap().pending.is_none());
        assert_eq!(server.received.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn legacy_attempt_is_retryable_while_optout_and_confirmed_success_survive_restarts() {
        for enabled in [true, false] {
            let server = TestEndpoint::start(Some(200));
            let directory =
                std::env::temp_dir().join(format!("mozi-statistics-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&directory).unwrap();
            let path = directory.join("usage.json");
            fs::write(&path, json!({"enabled":enabled,"lastAttemptDay":Utc::now().format("%Y-%m-%d").to_string()}).to_string()).unwrap();
            let statistics = UsageStatistics::default();
            let configured = Some(("A-EU-123", server.url.as_str()));
            statistics.record_to(&path, "zh", "qa", configured).unwrap();
            if enabled {
                complete_request(&statistics);
            } else {
                assert!(statistics.inner.lock().unwrap().pending.is_none());
            }
            let restarted = UsageStatistics::default();
            restarted.record_to(&path, "zh", "qa", configured).unwrap();
            assert!(restarted.inner.lock().unwrap().pending.is_none());
            assert_eq!(server.received.load(Ordering::SeqCst), usize::from(enabled));
            let preferences: Preferences =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(preferences.enabled, enabled);
            fs::remove_dir_all(directory).unwrap();
        }
    }
}
