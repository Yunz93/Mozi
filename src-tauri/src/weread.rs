use serde_json::{Map, Value};
use std::net::{IpAddr, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

use crate::secure_settings::read_weread_api_key;
use crate::{canonicalize_scope_path, ensure_path_allowed, SecurityState};

const WEREAD_GATEWAY_URL: &str = "https://i.weread.qq.com/api/agent/gateway";
pub(crate) const WEREAD_SKILL_VERSION: &str = "1.0.4";
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
            let object = params.as_object().ok_or_else(|| {
                "WeRead gateway params must be a JSON object.".to_string()
            })?;
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

    let body = build_gateway_body(&api_name, WEREAD_SKILL_VERSION, params.as_ref())?;
    let client = create_weread_client()?;
    let response = client
        .post(WEREAD_GATEWAY_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to request WeRead gateway: {}", e.without_url()))?;

    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|e| format!("Failed to parse WeRead gateway response: {}", e.without_url()))?;

    if !status.is_success() {
        if let Ok(()) = inspect_weread_response(&payload) {
            return Err(format!(
                "WeRead API error {}: HTTP {}",
                status.as_u16(),
                status
            ));
        }
    }

    inspect_weread_response(&payload)?;
    Ok(payload)
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
        return Err(format!(
            "WeRead cover URL must use HTTPS: {}",
            remote_url
        ));
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
    let socket_addrs = (host, port).to_socket_addrs().map_err(|e| {
        format!(
            "Failed to resolve WeRead cover URL host {}: {}",
            host, e
        )
    })?;
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
        let mime = raw.split(';').next().unwrap_or(raw).trim().to_ascii_lowercase();
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
        .map(|ext| if ext == "jpeg" { "jpg".to_string() } else { ext })
        .unwrap_or_else(|| "jpg".to_string())
}

#[tauri::command]
pub(crate) async fn weread_download_cover(
    security_state: tauri::State<'_, SecurityState>,
    url: String,
    dest_path: String,
) -> Result<String, String> {
    let parsed = validate_weread_cover_url(&url)?;
    let dest_buf = std::path::PathBuf::from(&dest_path);
    if let Some(parent) = dest_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create WeRead cover directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    let dest = canonicalize_scope_path(&dest_path)?;
    ensure_path_allowed(security_state.inner(), &dest)?;

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
    ensure_path_allowed(security_state.inner(), &final_path)?;

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
    fn gateway_body_is_flat_and_includes_skill_version() {
        let body = build_gateway_body(
            "/user/notebooks",
            WEREAD_SKILL_VERSION,
            Some(&json!({ "count": 20, "lastSort": 123 })),
        )
        .expect("body");

        assert_eq!(body["api_name"], "/user/notebooks");
        assert_eq!(body["skill_version"], WEREAD_SKILL_VERSION);
        assert_eq!(body["count"], 20);
        assert_eq!(body["lastSort"], 123);
        assert!(body.get("params").is_none());
    }

    #[test]
    fn gateway_body_strips_nested_params_wrapper() {
        let body = build_gateway_body(
            "/user/notebooks",
            WEREAD_SKILL_VERSION,
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
}
