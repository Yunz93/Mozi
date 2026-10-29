use serde_json::{Map, Value};
use std::future::Future;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use crate::secure_settings::read_weread_api_key;
use crate::{canonicalize_scope_path, ensure_path_allowed, SecurityState};

const WEREAD_GATEWAY_URL: &str = "https://i.weread.qq.com/api/agent/gateway";
const WEREAD_CONNECT_TIMEOUT_SECS: u64 = 10;
const WEREAD_REQUEST_TIMEOUT_SECS: u64 = 30;
const MAX_WEREAD_COVER_BYTES: usize = 8 * 1024 * 1024;

fn create_weread_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(WEREAD_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(WEREAD_REQUEST_TIMEOUT_SECS))
        .user_agent("markdown-press")
        .build()
        .map_err(|e| format!("Failed to create WeRead API client: {}", e.without_url()))
}

pub(crate) fn build_gateway_body(
    api_name: &str,
    skill_version: &str,
    params: Option<&Value>,
) -> Result<Value, String> {
    let trimmed = api_name.trim();
    if trimmed.is_empty() {
        return Err("WeRead api_name is required.".to_string());
    }

    let mut map = Map::new();
    if let Some(params) = params {
        if params.is_null() {
            // ignore
        } else {
            let object = params
                .as_object()
                .ok_or_else(|| "WeRead gateway params must be a JSON object.".to_string())?;
            for (key, value) in object {
                if key == "api_name" || key == "skill_version" || key == "params" {
                    continue;
                }
                map.insert(key.clone(), value.clone());
            }
        }
    }

    map.insert("api_name".to_string(), Value::String(trimmed.to_string()));
    map.insert(
        "skill_version".to_string(),
        Value::String(skill_version.to_string()),
    );
    Ok(Value::Object(map))
}

fn format_weread_api_error(errcode: i64, errmsg: Option<&str>) -> String {
    let detail = errmsg.unwrap_or("unknown error").trim();
    format!("WeRead API error {}: {}", errcode, detail)
}

fn inspect_weread_response(payload: &Value) -> Result<(), String> {
    if let Some(upgrade) = payload.get("upgrade_info") {
        if !upgrade.is_null() {
            let message = upgrade
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("WeRead skill needs to be upgraded.")
                .trim();
            return Err(format!("WeRead skill upgrade required: {}", message));
        }
    }

    let errcode = payload
        .get("errcode")
        .and_then(Value::as_i64)
        .or_else(|| payload.get("errCode").and_then(Value::as_i64))
        .unwrap_or(0);
    if errcode != 0 {
        let errmsg = payload
            .get("errmsg")
            .and_then(Value::as_str)
            .or_else(|| payload.get("errMsg").and_then(Value::as_str));
        return Err(format_weread_api_error(errcode, errmsg));
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn weread_gateway(
    app: tauri::AppHandle,
    api_name: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let api_key = read_weread_api_key(&app)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "WeRead API key is required.".to_string())?;

    let directory = crate::weread_skill::cache_directory(&app)?;
    let version = crate::weread_skill::current_version(&directory);
    let client = create_weread_client()?;
    gateway_with_upgrade(
        &api_name,
        params.as_ref(),
        version,
        |body| request_gateway(&client, &api_key, body),
        |version, url| {
            let directory = directory.clone();
            async move {
                crate::weread_skill::update_skill(&directory, url.as_deref(), Some(&version)).await
            }
        },
    )
    .await
}

async fn request_gateway(
    client: &reqwest::Client,
    api_key: &str,
    body: Value,
) -> Result<(u16, Value), String> {
    let response = client
        .post(WEREAD_GATEWAY_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to request WeRead gateway: {}", e.without_url()))?;

    let status = response.status().as_u16();
    let payload = response.json::<Value>().await.map_err(|e| {
        format!(
            "Failed to parse WeRead gateway response: {}",
            e.without_url()
        )
    })?;

    Ok((status, payload))
}

async fn gateway_with_upgrade<Request, RequestFuture, Update, UpdateFuture>(
    api_name: &str,
    params: Option<&Value>,
    mut version: String,
    mut request: Request,
    mut update: Update,
) -> Result<Value, String>
where
    Request: FnMut(Value) -> RequestFuture,
    RequestFuture: Future<Output = Result<(u16, Value), String>>,
    Update: FnMut(String, Option<String>) -> UpdateFuture,
    UpdateFuture: Future<Output = Result<String, String>>,
{
    for attempt in 0..2 {
        let body = build_gateway_body(api_name, &version, params)?;
        let (status, payload) = request(body).await?;
        if let Some(upgrade) = payload.get("upgrade_info").filter(|value| !value.is_null()) {
            let message = inspect_weread_response(&payload).expect_err("upgrade response");
            if attempt == 1 {
                return Err(message);
            }
            let url = upgrade
                .get("upgrade_url")
                .or_else(|| payload.get("upgrade_url"))
                .and_then(Value::as_str)
                .map(str::to_string);
            // 升级完成前不消费回包内容；成功后用原接口和原参数重试一次。
            version = update(version, url)
                .await
                .map_err(|error| format!("{message} ({error})"))?;
            continue;
        }
        inspect_weread_response(&payload)?;
        if !(200..300).contains(&status) {
            return Err(format!("WeRead API error {status}: HTTP {status}"));
        }
        return Ok(payload);
    }
    Err("WeRead skill upgrade required: retry limit reached.".to_string())
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unique_local() || v6.is_unspecified(),
    }
}

fn validate_weread_cover_url(remote_url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(remote_url.trim())
        .map_err(|e| format!("Invalid WeRead cover URL {}: {}", remote_url, e))?;
    if parsed.scheme() != "https" {
        return Err(format!("WeRead cover URL must use HTTPS: {}", remote_url));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| format!("WeRead cover URL is missing a host: {}", remote_url))?;
    let host_lower = host.to_ascii_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return Err(format!(
            "WeRead cover URL host is not allowed: {}",
            remote_url
        ));
    }

    if host.parse::<IpAddr>().map(is_blocked_ip).unwrap_or(false) {
        return Err(format!(
            "WeRead cover URL host is not allowed: {}",
            remote_url
        ));
    }

    let port = parsed.port_or_known_default().unwrap_or(443);
    let socket_addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve WeRead cover URL host {}: {}", host, e))?;
    for addr in socket_addrs {
        if is_blocked_ip(addr.ip()) {
            return Err(format!(
                "WeRead cover URL resolves to a blocked address: {}",
                remote_url
            ));
        }
    }

    Ok(parsed)
}

fn cover_extension_from_content_type(content_type: Option<&str>, url: &reqwest::Url) -> String {
    if let Some(raw) = content_type {
        let mime = raw
            .split(';')
            .next()
            .unwrap_or(raw)
            .trim()
            .to_ascii_lowercase();
        return match mime.as_str() {
            "image/jpeg" | "image/jpg" => "jpg".to_string(),
            "image/png" => "png".to_string(),
            "image/webp" => "webp".to_string(),
            "image/gif" => "gif".to_string(),
            _ => cover_extension_from_url(url),
        };
    }
    cover_extension_from_url(url)
}

fn cover_extension_from_url(url: &reqwest::Url) -> String {
    url.path_segments()
        .and_then(|segments| segments.last())
        .and_then(|name| Path::new(name).extension())
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.trim().to_ascii_lowercase())
        .filter(|ext| matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif"))
        .map(|ext| {
            if ext == "jpeg" {
                "jpg".to_string()
            } else {
                ext
            }
        })
        .unwrap_or_else(|| "jpg".to_string())
}

fn prepare_weread_cover_destination(state: &SecurityState, path: &Path) -> Result<PathBuf, String> {
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("Invalid WeRead cover destination".to_string());
    }
    let mut existing = path.to_path_buf();
    let mut missing = Vec::new();
    while let Err(error) = std::fs::symlink_metadata(&existing) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(error.to_string());
        }
        missing.push(
            existing
                .file_name()
                .ok_or("Missing cover path component")?
                .to_os_string(),
        );
        if !existing.pop() {
            return Err("Missing cover path ancestor".to_string());
        }
    }
    let mut resolved = std::fs::canonicalize(&existing).map_err(|e| e.to_string())?;
    for component in missing.iter().rev() {
        resolved.push(component);
    }
    // 先解析最近存在的祖先并授权，再创建任何目录，避免通过目录链接越界。
    ensure_path_allowed(state, &resolved)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create WeRead cover directory: {}", e))?;
    }
    let resolved = canonicalize_scope_path(&resolved.to_string_lossy())?;
    ensure_path_allowed(state, &resolved)?;
    Ok(resolved)
}

#[tauri::command]
pub(crate) async fn weread_download_cover(
    security_state: tauri::State<'_, SecurityState>,
    url: String,
    dest_path: String,
) -> Result<String, String> {
    let parsed = validate_weread_cover_url(&url)?;
    let dest = prepare_weread_cover_destination(security_state.inner(), Path::new(&dest_path))?;

    let client = create_weread_client()?;
    let response = client
        .get(parsed.clone())
        .send()
        .await
        .map_err(|e| format!("Failed to download WeRead cover: {}", e.without_url()))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download WeRead cover: HTTP {}",
            response.status()
        ));
    }
    if let Some(content_length) = response.content_length() {
        if content_length as usize > MAX_WEREAD_COVER_BYTES {
            return Err(format!(
                "WeRead cover exceeds maximum download size of {} bytes.",
                MAX_WEREAD_COVER_BYTES
            ));
        }
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read WeRead cover bytes: {}", e.without_url()))?;
    if bytes.len() > MAX_WEREAD_COVER_BYTES {
        return Err(format!(
            "WeRead cover exceeds maximum download size of {} bytes.",
            MAX_WEREAD_COVER_BYTES
        ));
    }

    let extension = cover_extension_from_content_type(content_type.as_deref(), &parsed);
    let final_path = if dest
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(&extension))
        .unwrap_or(false)
    {
        dest
    } else {
        dest.with_extension(&extension)
    };
    let final_path = prepare_weread_cover_destination(security_state.inner(), &final_path)?;

    std::fs::write(&final_path, &bytes).map_err(|e| {
        format!(
            "Failed to write WeRead cover {}: {}",
            final_path.display(),
            e
        )
    })?;

    Ok(final_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cover_destination_is_authorized_before_creating_missing_directories() {
        let root = std::env::temp_dir().join(format!(
            "weread-cover-scope-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let state = SecurityState::default();
        state
            .allowed_paths
            .lock()
            .unwrap()
            .push(crate::AllowedPathEntry {
                path: std::fs::canonicalize(&vault).unwrap(),
                recursive: true,
            });
        let outside = root.join("outside/nested/cover.jpg");
        assert!(prepare_weread_cover_destination(&state, &outside).is_err());
        assert!(!root.join("outside").exists());
        let allowed = vault.join("resources/weread/covers/book.jpg");
        let resolved = prepare_weread_cover_destination(&state, &allowed).unwrap();
        assert!(resolved.parent().unwrap().is_dir());
        assert!(!resolved.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn cover_destination_cannot_escape_through_directory_or_final_file_symlinks() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!(
            "weread-cover-link-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let vault = root.join("vault");
        let outside = root.join("outside");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let state = SecurityState::default();
        state
            .allowed_paths
            .lock()
            .unwrap()
            .push(crate::AllowedPathEntry {
                path: std::fs::canonicalize(&vault).unwrap(),
                recursive: true,
            });
        symlink(&outside, vault.join("resources")).unwrap();
        assert!(prepare_weread_cover_destination(
            &state,
            &vault.join("resources/weread/new/cover.jpg")
        )
        .is_err());
        assert!(!outside.join("weread").exists());
        let victim = outside.join("user.png");
        std::fs::write(&victim, "unchanged user file").unwrap();
        symlink(&victim, vault.join("cover.png")).unwrap();
        assert!(prepare_weread_cover_destination(&state, &vault.join("cover.png")).is_err());
        assert_eq!(
            std::fs::read_to_string(&victim).unwrap(),
            "unchanged user file"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn gateway_body_is_flat_and_includes_skill_version() {
        let body = build_gateway_body(
            "/user/notebooks",
            "1.0.5",
            Some(&json!({ "count": 20, "lastSort": 123 })),
        )
        .expect("body");

        assert_eq!(body["api_name"], "/user/notebooks");
        assert_eq!(body["skill_version"], "1.0.5");
        assert_eq!(body["count"], 20);
        assert_eq!(body["lastSort"], 123);
        assert!(body.get("params").is_none());
    }

    #[test]
    fn gateway_body_strips_nested_params_wrapper() {
        let body = build_gateway_body(
            "/user/notebooks",
            "1.0.5",
            Some(&json!({
                "params": { "count": 20 },
                "count": 20
            })),
        )
        .expect("body");

        assert_eq!(body["count"], 20);
        assert!(body.get("params").is_none());
    }

    #[test]
    fn inspect_response_stops_on_upgrade_info() {
        let payload = json!({
            "errcode": 0,
            "upgrade_info": { "message": "请升级 Skill 到 1.0.5" }
        });
        let error = inspect_weread_response(&payload).expect_err("upgrade");
        assert!(error.contains("WeRead skill upgrade required"));
        assert!(error.contains("1.0.5"));
    }

    #[test]
    fn inspect_response_maps_errcode() {
        let payload = json!({ "errcode": -2012, "errmsg": "登录超时" });
        let error = inspect_weread_response(&payload).expect_err("errcode");
        assert_eq!(error, "WeRead API error -2012: 登录超时");
    }

    #[test]
    fn gateway_upgrades_and_retries_the_same_request_with_the_installed_version() {
        let mut requests = Vec::new();
        let mut updates = Vec::new();
        let result = tauri::async_runtime::block_on(gateway_with_upgrade(
            "/user/notebooks",
            Some(&json!({ "count": 100, "lastSort": 321, "skill_version": "spoofed" })),
            "1.0.4".to_string(),
            |body| {
                requests.push(body);
                let payload = if requests.len() == 1 {
                    json!({ "upgrade_info": {
                        "message": "请先升级", "upgrade_url": "https://github.com/Tencent/WeChatReading"
                    }, "books": [{ "bookId": "must-not-consume" }] })
                } else {
                    json!({ "books": [{ "bookId": "123" }] })
                };
                std::future::ready(Ok((200, payload)))
            },
            |version, url| {
                updates.push((version, url));
                std::future::ready(Ok("1.0.5".to_string()))
            },
        )).expect("upgrade and retry");
        assert_eq!(result["books"][0]["bookId"], "123");
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0]["skill_version"], "1.0.4");
        assert_eq!(requests[1]["skill_version"], "1.0.5");
        assert_eq!(requests[1]["count"], 100);
        assert_eq!(requests[1]["lastSort"], 321);
        assert_eq!(requests[1]["api_name"], "/user/notebooks");
        assert!(requests[1].get("params").is_none());
        assert_eq!(
            updates,
            vec![(
                "1.0.4".to_string(),
                Some("https://github.com/Tencent/WeChatReading".to_string())
            )]
        );
    }

    #[test]
    fn gateway_stops_when_update_fails_or_another_upgrade_is_requested() {
        for fail_update in [false, true] {
            let mut requests = 0;
            let mut updates = 0;
            let error = tauri::async_runtime::block_on(gateway_with_upgrade(
                "/book/info",
                None,
                "1.0.4".to_string(),
                |_| {
                    requests += 1;
                    std::future::ready(Ok((
                        426,
                        json!({ "upgrade_info": { "message": "请先升级" } }),
                    )))
                },
                |_, _| {
                    updates += 1;
                    std::future::ready(if fail_update {
                        Err("download failed".to_string())
                    } else {
                        Ok("1.0.5".to_string())
                    })
                },
            ))
            .expect_err("must stop");
            assert_eq!(updates, 1);
            assert_eq!(requests, if fail_update { 1 } else { 2 });
            assert!(error.contains("WeRead skill upgrade required"));
            if fail_update {
                assert!(error.contains("download failed"));
            }
        }
    }

    #[test]
    fn gateway_does_not_upgrade_auth_or_network_errors() {
        let mut updates = 0;
        let error = tauri::async_runtime::block_on(gateway_with_upgrade(
            "/book/info",
            None,
            "1.0.5".to_string(),
            |_| std::future::ready(Ok((401, json!({"errcode": -2012, "errmsg": "登录超时"})))),
            |_, _| {
                updates += 1;
                std::future::ready(Ok("1.0.6".to_string()))
            },
        ))
        .expect_err("auth error");
        assert_eq!(updates, 0);
        assert_eq!(error, "WeRead API error -2012: 登录超时");
    }
}
