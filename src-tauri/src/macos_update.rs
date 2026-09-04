//! macOS 应用内更新：下载 Tauri updater 产物（`*.app.tar.gz`），
//! 按 `tauri-plugin-updater` 同样的方式用 minisign 校验签名，再原子替换安装。
//!
//! 签名不匹配、latest.json 缺少平台条目或缺少 signature 时直接报错，
//! **绝不**退回无校验的 DMG / `install-macos.sh` 路径。
#![allow(dead_code)]

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::AppHandle;

pub const REPO: &str = "Yunz93/Mozi";
pub const APP_NAME: &str = "墨知";
pub const INSTALL_DIR: &str = "/Applications";
pub const USER_AGENT: &str = "Mozi-installer";
const LATEST_JSON_URL: &str =
    "https://github.com/Yunz93/Mozi/releases/latest/download/latest.json";
/// 必须与 `tauri.conf.json` → `plugins.updater.pubkey` 保持一致。
pub const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE3M0ZBRkZFQUUzNUFCNzMKUldSenF6V3UvcTgvRjMwZTdUbVp6ajMxVWNsZW9lRXJHRTVSNFRyM05ZbTJjSk5iWUNUOEVxR0UK";
const TAURI_CONF_JSON: &str = include_str!("../tauri.conf.json");
const CHECK_TIMEOUT_SECS: u64 = 30;
const DOWNLOAD_TIMEOUT_SECS: u64 = 5 * 60;
const PROGRESS_EMIT_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MacosUpdateInfo {
    pub version: String,
    pub current_version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum MacosUpdateProgressEvent {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: u64,
    },
    Finished,
}

#[derive(Debug, Deserialize)]
pub struct LatestJson {
    version: Option<String>,
    notes: Option<String>,
    pub_date: Option<String>,
    platforms: Option<HashMap<String, LatestJsonPlatform>>,
}

#[derive(Debug, Deserialize)]
pub struct LatestJsonPlatform {
    url: Option<String>,
    signature: Option<String>,
}

pub fn parse_release_tag_from_url(url: &str) -> Option<String> {
    let marker = "/releases/tag/";
    let rest = url.split(marker).nth(1)?;
    let tag = rest.split(['/', '?', '#']).next()?.trim();
    if tag.is_empty() {
        return None;
    }
    Some(normalize_release_tag(tag))
}

pub fn normalize_release_tag(tag: &str) -> String {
    let trimmed = tag.trim();
    if trimmed.starts_with('v') {
        trimmed.to_string()
    } else {
        format!("v{trimmed}")
    }
}

pub fn is_valid_release_tag(tag: &str) -> bool {
    let Some(payload) = tag.strip_prefix('v') else {
        return false;
    };
    if payload.is_empty() || tag.len() > 32 {
        return false;
    }
    payload
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-')
}

pub fn version_from_tag(tag: &str) -> String {
    tag.trim().trim_start_matches('v').to_string()
}

pub fn compare_semver(left: &str, right: &str) -> i32 {
    let parse = |value: &str| -> [u64; 3] {
        let mut parts = [0_u64; 3];
        for (index, raw) in value
            .trim()
            .trim_start_matches('v')
            .split('.')
            .take(3)
            .enumerate()
        {
            let digits: String = raw.chars().take_while(|ch| ch.is_ascii_digit()).collect();
            parts[index] = digits.parse().unwrap_or(0);
        }
        parts
    };

    let left_parts = parse(left);
    let right_parts = parse(right);
    match left_parts.cmp(&right_parts) {
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
    }
}

pub fn updater_platform_key(arch: &str) -> Result<&'static str, String> {
    match arch {
        "aarch64" => Ok("darwin-aarch64"),
        "x86_64" => Ok("darwin-x86_64"),
        other => Err(format!("不支持的 CPU 架构: {other}")),
    }
}

pub fn installed_app_path() -> PathBuf {
    Path::new(INSTALL_DIR).join(format!("{APP_NAME}.app"))
}

pub fn relaunch_waiter_command(pid: u32, app_path: &Path) -> String {
    format!(
        r#"while kill -0 {pid} 2>/dev/null; do sleep 0.2; done; open "{}""#,
        app_path.display()
    )
}

pub fn updater_pubkey_from_tauri_conf() -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(TAURI_CONF_JSON)
        .map_err(|error| format!("解析 tauri.conf.json 失败: {error}"))?;
    value["plugins"]["updater"]["pubkey"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .ok_or_else(|| "tauri.conf.json 缺少 plugins.updater.pubkey".to_string())
}

fn decode_tauri_updater_b64(value: &str) -> Result<String, String> {
    let bytes = BASE64_STANDARD
        .decode(value.trim())
        .map_err(|error| format!("更新签名解码失败: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("更新签名不是合法 UTF-8: {error}"))
}

/// 与 `tauri-plugin-updater` 相同：pubkey / signature 均为 minisign 文本的 Base64。
pub fn verify_update_signature(data: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    if signature.trim().is_empty() {
        return Err("latest.json 缺少 signature，已终止安装。".to_string());
    }
    let pubkey_plain = decode_tauri_updater_b64(pubkey)?;
    let signature_plain = decode_tauri_updater_b64(signature)?;
    let public_key = minisign_verify::PublicKey::decode(&pubkey_plain)
        .map_err(|error| format!("更新公钥无效: {error}"))?;
    let decoded_signature = minisign_verify::Signature::decode(&signature_plain)
        .map_err(|error| format!("更新签名格式非法: {error}"))?;
    public_key
        .verify(data, &decoded_signature, true)
        .map_err(|_| "更新包签名校验失败，已终止安装。".to_string())?;
    Ok(())
}

pub fn require_signed_platform_artifact(
    latest: &LatestJson,
    platform: &str,
) -> Result<(String, String), String> {
    let platforms = latest
        .platforms
        .as_ref()
        .ok_or_else(|| "latest.json 缺少 platforms，已终止安装。".to_string())?;
    let entry = platforms.get(platform).ok_or_else(|| {
        format!("latest.json 缺少平台条目 {platform}，已终止安装。")
    })?;
    let url = entry
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("latest.json 的 {platform} 缺少 url，已终止安装。"))?;
    let signature = entry
        .signature
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!("latest.json 的 {platform} 缺少 signature，已终止安装。")
        })?;
    Ok((url.to_string(), signature.to_string()))
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| {
            format!("删除 {} 失败: {error}", path.display())
        })
    } else {
        fs::remove_file(path).map_err(|error| {
            format!("删除 {} 失败: {error}", path.display())
        })
    }
}

/// 原子替换：先把旧 app `mv` 到 backup，再把新 app `mv` 到位。
/// 任一步失败则把 backup 移回；成功后再删除 backup。禁止先删后拷。
pub fn replace_app_atomically(
    target: &Path,
    new_app: &Path,
    backup: &Path,
) -> Result<(), String> {
    if backup.exists() {
        remove_path(backup)?;
    }

    let target_existed = target.exists();
    if target_existed {
        fs::rename(target, backup).map_err(|error| format!("备份现有应用失败: {error}"))?;
    }

    if let Err(error) = fs::rename(new_app, target) {
        if target_existed {
            if let Err(restore_error) = fs::rename(backup, target) {
                return Err(format!(
                    "安装新版本失败: {error}；并且回滚失败: {restore_error}"
                ));
            }
        }
        return Err(format!("安装新版本失败: {error}"));
    }

    if target_existed {
        let _ = remove_path(backup);
    }
    Ok(())
}

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))
}

fn fetch_latest_json(client: &reqwest::blocking::Client) -> Result<LatestJson, String> {
    let response = client
        .get(LATEST_JSON_URL)
        .send()
        .map_err(|error| format!("获取 latest.json 失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "获取 latest.json 失败: HTTP {}",
            response.status().as_u16()
        ));
    }
    response
        .json()
        .map_err(|error| format!("解析 latest.json 失败: {error}"))
}

fn download_file(
    client: &reqwest::blocking::Client,
    url: &str,
    dest: &Path,
    on_event: &Channel<MacosUpdateProgressEvent>,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("下载安装包失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "下载安装包失败: HTTP {}",
            response.status().as_u16()
        ));
    }

    let content_length = response.content_length().filter(|length| *length > 0);
    let _ = on_event.send(MacosUpdateProgressEvent::Started { content_length });

    let mut file =
        fs::File::create(dest).map_err(|error| format!("无法保存安装包: {error}"))?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut pending = 0_u64;

    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("读取安装包失败: {error}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| format!("写入安装包失败: {error}"))?;
        pending += read as u64;
        if pending >= PROGRESS_EMIT_BYTES {
            let _ = on_event.send(MacosUpdateProgressEvent::Progress {
                chunk_length: pending,
            });
            pending = 0;
        }
    }

    if pending > 0 {
        let _ = on_event.send(MacosUpdateProgressEvent::Progress {
            chunk_length: pending,
        });
    }

    let _ = on_event.send(MacosUpdateProgressEvent::Finished);
    Ok(())
}

fn extract_app_bundle(archive: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let output = Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(dest_dir)
        .output()
        .map_err(|error| format!("无法解压更新包: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            "解压更新包失败。".to_string()
        } else {
            format!("解压更新包失败: {}", stderr.trim())
        });
    }

    let expected = dest_dir.join(format!("{APP_NAME}.app"));
    if expected.is_dir() {
        return Ok(expected);
    }

    for entry in fs::read_dir(dest_dir).map_err(|error| format!("读取解压目录失败: {error}"))? {
        let entry = entry.map_err(|error| format!("读取解压目录失败: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("app") && path.is_dir() {
            return Ok(path);
        }
    }

    Err(format!("更新包中未找到 {APP_NAME}.app"))
}

fn clear_quarantine_xattr(app_path: &Path) -> Result<(), String> {
    let status = Command::new("xattr")
        .arg("-cr")
        .arg(app_path)
        .status()
        .map_err(|error| format!("清理隔离属性失败: {error}"))?;
    if !status.success() {
        return Err("清理隔离属性失败。".to_string());
    }
    Ok(())
}

fn spawn_relaunch_waiter(app_path: &Path) -> Result<(), String> {
    let pid = std::process::id();
    let mut command = Command::new("/bin/bash");
    command
        .arg("-c")
        .arg(relaunch_waiter_command(pid, app_path))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    command
        .spawn()
        .map_err(|error| format!("无法安排更新后重启: {error}"))?;
    Ok(())
}

pub fn check_macos_update(current_version: &str) -> Result<Option<MacosUpdateInfo>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = current_version;
        return Err("macOS in-app updates are only available on macOS.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let client = http_client(CHECK_TIMEOUT_SECS)?;
        let latest = fetch_latest_json(&client)?;
        let version = latest
            .version
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "GitHub latest.json 未包含版本号。".to_string())?;
        let tag = normalize_release_tag(version);
        if !is_valid_release_tag(&tag) {
            return Err(format!("无效的版本号: {version}"));
        }
        if compare_semver(version, current_version) <= 0 {
            return Ok(None);
        }

        let platform = updater_platform_key(std::env::consts::ARCH)?;
        let _ = require_signed_platform_artifact(&latest, platform)?;

        Ok(Some(MacosUpdateInfo {
            version: version_from_tag(&tag),
            current_version: current_version.trim_start_matches('v').to_string(),
            date: latest.pub_date.clone(),
            body: latest.notes.clone(),
            tag,
        }))
    }
}

pub fn install_macos_update(
    tag: &str,
    on_event: Channel<MacosUpdateProgressEvent>,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (tag, on_event);
        return Err("macOS in-app updates are only available on macOS.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        if !is_valid_release_tag(tag) {
            return Err(format!("无效的版本标签: {tag}"));
        }

        let client = http_client(DOWNLOAD_TIMEOUT_SECS)?;
        let latest = fetch_latest_json(&client)?;
        let platform = updater_platform_key(std::env::consts::ARCH)?;
        let (url, signature) = require_signed_platform_artifact(&latest, platform)?;

        let tmp_dir =
            std::env::temp_dir().join(format!("mozi-macos-update-{}", std::process::id()));
        fs::create_dir_all(&tmp_dir).map_err(|error| format!("无法创建临时目录: {error}"))?;
        let archive_path = tmp_dir.join("update.app.tar.gz");
        let extract_dir = tmp_dir.join("extract");
        fs::create_dir_all(&extract_dir)
            .map_err(|error| format!("无法创建解压目录: {error}"))?;
        let backup_path = tmp_dir.join(format!("{APP_NAME}.app.bak"));

        let result = (|| {
            download_file(&client, &url, &archive_path, &on_event)?;
            let bytes = fs::read(&archive_path).map_err(|error| format!("读取更新包失败: {error}"))?;
            verify_update_signature(&bytes, &signature, UPDATER_PUBKEY)?;
            let new_app = extract_app_bundle(&archive_path, &extract_dir)?;
            clear_quarantine_xattr(&new_app)?;
            replace_app_atomically(&installed_app_path(), &new_app, &backup_path)?;
            spawn_relaunch_waiter(&installed_app_path())?;
            Ok(())
        })();

        let _ = fs::remove_dir_all(&tmp_dir);
        result
    }
}

pub fn check_macos_update_command(
    app: AppHandle,
) -> Result<Option<MacosUpdateInfo>, String> {
    let current_version = app.package_info().version.to_string();
    check_macos_update(&current_version)
}

pub fn install_macos_update_command(
    app: AppHandle,
    tag: String,
    on_event: Channel<MacosUpdateProgressEvent>,
) -> Result<(), String> {
    install_macos_update(&tag, on_event)?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn create_test_directory(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let unique = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        path.push(format!(
            "markdown-press-macos-update-{}-{}-{}",
            prefix,
            std::process::id(),
            unique
        ));
        if path.exists() {
            fs::remove_dir_all(&path).expect("cleanup existing test dir");
        }
        fs::create_dir_all(&path).expect("create test dir");
        path
    }

    fn cleanup_test_directory(path: &Path) {
        if path.exists() {
            fs::remove_dir_all(path).expect("cleanup test dir");
        }
    }

    fn write_dir_marker(dir: &Path, marker: &str) {
        fs::create_dir_all(dir).expect("create app dir");
        fs::write(dir.join("marker.txt"), marker).expect("write marker");
    }

    fn read_dir_marker(dir: &Path) -> String {
        fs::read_to_string(dir.join("marker.txt")).expect("read marker")
    }

    fn encode_tauri_b64(plain: &str) -> String {
        BASE64_STANDARD.encode(plain.as_bytes())
    }

    /// minisign-verify 仓库公开测试向量：对 `test` 的合法签名。
    fn minisign_test_vector() -> (String, String) {
        let pubkey = encode_tauri_b64(
            "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3",
        );
        let signature = encode_tauri_b64(
            "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==",
        );
        (pubkey, signature)
    }

    fn parse_latest_json(raw: &str) -> LatestJson {
        serde_json::from_str(raw).expect("parse latest.json")
    }

    #[test]
    fn parse_tag_from_github_latest_redirect() {
        assert_eq!(
            parse_release_tag_from_url(
                "https://github.com/Yunz93/Mozi/releases/tag/v0.9.1?foo=1"
            )
            .as_deref(),
            Some("v0.9.1")
        );
        assert_eq!(
            parse_release_tag_from_url("https://github.com/Yunz93/Mozi/releases/latest"),
            None
        );
    }

    #[test]
    fn updater_platform_keys_match_latest_json() {
        assert_eq!(updater_platform_key("aarch64").unwrap(), "darwin-aarch64");
        assert_eq!(updater_platform_key("x86_64").unwrap(), "darwin-x86_64");
        assert!(updater_platform_key("arm").is_err());
    }

    #[test]
    fn embedded_updater_pubkey_matches_tauri_conf() {
        let from_conf = updater_pubkey_from_tauri_conf().expect("pubkey in tauri.conf.json");
        assert_eq!(from_conf, UPDATER_PUBKEY);
    }

    #[test]
    fn require_signed_platform_rejects_missing_signature() {
        let latest = parse_latest_json(
            r#"{
                "version": "1.0.0",
                "platforms": {
                    "darwin-aarch64": {
                        "url": "https://example.com/app.tar.gz"
                    }
                }
            }"#,
        );
        let error = require_signed_platform_artifact(&latest, "darwin-aarch64")
            .expect_err("missing signature");
        assert!(error.contains("signature"));
    }

    #[test]
    fn require_signed_platform_rejects_missing_platform() {
        let latest = parse_latest_json(r#"{ "version": "1.0.0", "platforms": {} }"#);
        let error = require_signed_platform_artifact(&latest, "darwin-aarch64")
            .expect_err("missing platform");
        assert!(error.contains("darwin-aarch64"));
    }

    #[test]
    fn require_signed_platform_accepts_url_and_signature() {
        let latest = parse_latest_json(
            r#"{
                "version": "1.0.0",
                "platforms": {
                    "darwin-aarch64": {
                        "url": "https://example.com/app.tar.gz",
                        "signature": "dGVzdA=="
                    }
                }
            }"#,
        );
        let (url, signature) =
            require_signed_platform_artifact(&latest, "darwin-aarch64").expect("ok");
        assert_eq!(url, "https://example.com/app.tar.gz");
        assert_eq!(signature, "dGVzdA==");
    }

    #[test]
    fn verify_update_signature_rejects_missing_signature() {
        let error = verify_update_signature(b"test", "   ", UPDATER_PUBKEY)
            .expect_err("empty signature");
        assert!(error.contains("signature"));
    }

    #[test]
    fn verify_update_signature_rejects_invalid_format() {
        let pubkey = encode_tauri_b64("not-a-minisign-key");
        let signature = encode_tauri_b64("not-a-minisign-signature");
        let error =
            verify_update_signature(b"test", &signature, &pubkey).expect_err("invalid format");
        assert!(error.contains("公钥") || error.contains("签名"));
    }

    #[test]
    fn verify_update_signature_rejects_tampered_bytes() {
        let (pubkey, signature) = minisign_test_vector();
        verify_update_signature(b"test", &signature, &pubkey).expect("valid vector");
        let error = verify_update_signature(b"tampered-tar-bytes", &signature, &pubkey)
            .expect_err("tampered");
        assert!(error.contains("签名校验失败"));
    }

    #[test]
    fn replace_app_atomically_swaps_and_removes_backup() {
        let temp = create_test_directory("replace-ok");
        let target = temp.join("墨知.app");
        let incoming = temp.join("incoming.app");
        let backup = temp.join("backup.app");
        write_dir_marker(&target, "old");
        write_dir_marker(&incoming, "new");

        replace_app_atomically(&target, &incoming, &backup).expect("replace");

        assert_eq!(read_dir_marker(&target), "new");
        assert!(!backup.exists());
        cleanup_test_directory(&temp);
    }

    #[test]
    fn replace_app_atomically_rolls_back_when_incoming_missing() {
        let temp = create_test_directory("replace-fail");
        let target = temp.join("墨知.app");
        let incoming = temp.join("missing.app");
        let backup = temp.join("backup.app");
        write_dir_marker(&target, "old");

        let error =
            replace_app_atomically(&target, &incoming, &backup).expect_err("incoming missing");
        assert!(error.contains("安装新版本失败"));
        assert_eq!(read_dir_marker(&target), "old");
        cleanup_test_directory(&temp);
    }

    #[test]
    fn compares_semver_without_prerelease_noise() {
        assert!(compare_semver("0.9.1", "0.9.0") > 0);
        assert!(compare_semver("v0.9.0", "0.9.0") == 0);
        assert!(compare_semver("0.8.9", "0.9.0") < 0);
        assert!(compare_semver("1.0.0", "0.9.9") > 0);
    }

    #[test]
    fn validates_release_tags() {
        assert!(is_valid_release_tag("v0.9.1"));
        assert!(is_valid_release_tag("v1.0.0-beta.1"));
        assert!(!is_valid_release_tag("0.9.1"));
        assert!(!is_valid_release_tag("v0.9.1; rm -rf /"));
        assert!(!is_valid_release_tag("v"));
    }

    #[test]
    fn relaunch_waiter_waits_for_the_old_pid() {
        let command = relaunch_waiter_command(42, Path::new("/Applications/墨知.app"));
        assert!(command.contains("kill -0 42"));
        assert!(command.contains(r#"open "/Applications/墨知.app""#));
    }

    #[test]
    fn check_is_macos_only() {
        #[cfg(not(target_os = "macos"))]
        {
            let error = check_macos_update("0.9.0").expect_err("linux stub");
            assert!(error.contains("macOS"));
        }
    }

    #[test]
    fn progress_events_match_tauri_updater_shape() {
        let started = serde_json::to_value(MacosUpdateProgressEvent::Started {
            content_length: Some(1024),
        })
        .expect("serialize started");
        assert_eq!(started["event"], "Started");
        assert_eq!(started["data"]["contentLength"], 1024);

        let progress = serde_json::to_value(MacosUpdateProgressEvent::Progress {
            chunk_length: 256,
        })
        .expect("serialize progress");
        assert_eq!(progress["event"], "Progress");
        assert_eq!(progress["data"]["chunkLength"], 256);

        let finished =
            serde_json::to_value(MacosUpdateProgressEvent::Finished).expect("serialize finished");
        assert_eq!(finished["event"], "Finished");
    }
}
