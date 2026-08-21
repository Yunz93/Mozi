//! macOS in-app updates reuse `scripts/install-macos.sh`.
//!
//! The app downloads the GitHub Release DMG with progress, then runs the same
//! installer (xattr / hdiutil / ditto) used by the one-line README command.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
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
const LATEST_RELEASE_URL: &str = "https://github.com/Yunz93/Mozi/releases/latest";
const LATEST_JSON_URL: &str =
    "https://github.com/Yunz93/Mozi/releases/latest/download/latest.json";
const INSTALL_SCRIPT: &str = include_str!("../../scripts/install-macos.sh");
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
struct LatestJson {
    version: Option<String>,
    notes: Option<String>,
    pub_date: Option<String>,
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

pub fn macos_asset_arch(arch: &str) -> Result<&'static str, String> {
    match arch {
        "aarch64" => Ok("aarch64"),
        "x86_64" => Ok("x64"),
        other => Err(format!("不支持的 CPU 架构: {other}")),
    }
}

pub fn build_macos_dmg_url(tag: &str, asset_arch: &str) -> String {
    let version = version_from_tag(tag);
    format!("https://github.com/{REPO}/releases/download/{tag}/Mozi_{version}_{asset_arch}.dmg")
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

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))
}

fn fetch_optional_latest_json(
    client: &reqwest::blocking::Client,
) -> Option<LatestJson> {
    client
        .get(LATEST_JSON_URL)
        .send()
        .ok()
        .and_then(|response| {
            if response.status().is_success() {
                response.json().ok()
            } else {
                None
            }
        })
}

pub fn resolve_latest_release_tag(
    client: &reqwest::blocking::Client,
) -> Result<String, String> {
    let response = client
        .get(LATEST_RELEASE_URL)
        .send()
        .map_err(|error| format!("检查更新失败: {error}"))?;
    if let Some(tag) = parse_release_tag_from_url(response.url().as_str()) {
        if is_valid_release_tag(&tag) {
            return Ok(tag);
        }
    }

    let latest = fetch_optional_latest_json(client).ok_or_else(|| {
        "无法解析 GitHub Release 版本，请稍后重试或从 Releases 页面手动安装。".to_string()
    })?;
    let version = latest.version.ok_or_else(|| {
        "GitHub latest.json 未包含版本号。".to_string()
    })?;
    let tag = normalize_release_tag(&version);
    if !is_valid_release_tag(&tag) {
        return Err(format!("无效的版本号: {version}"));
    }
    Ok(tag)
}

fn dmg_url_exists(client: &reqwest::blocking::Client, url: &str) -> bool {
    client
        .head(url)
        .send()
        .ok()
        .map(|response| {
            let status = response.status().as_u16();
            (200..400).contains(&status)
        })
        .unwrap_or(false)
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
        let tag = resolve_latest_release_tag(&client)?;
        let version = version_from_tag(&tag);
        if compare_semver(&version, current_version) <= 0 {
            return Ok(None);
        }

        let asset_arch = macos_asset_arch(std::env::consts::ARCH)?;
        let dmg_url = build_macos_dmg_url(&tag, asset_arch);
        if !dmg_url_exists(&client, &dmg_url) {
            return Err(format!(
                "未找到 {asset_arch} 版 macOS 安装包。可尝试手动下载: https://github.com/{REPO}/releases/latest"
            ));
        }

        let latest = fetch_optional_latest_json(&client);
        Ok(Some(MacosUpdateInfo {
            version,
            current_version: current_version.trim_start_matches('v').to_string(),
            date: latest.as_ref().and_then(|value| value.pub_date.clone()),
            body: latest.as_ref().and_then(|value| value.notes.clone()),
            tag,
        }))
    }
}

fn write_install_script(dir: &Path) -> Result<PathBuf, String> {
    let path = dir.join("install-macos.sh");
    fs::write(&path, INSTALL_SCRIPT)
        .map_err(|error| format!("写入安装脚本失败: {error}"))?;
    Ok(path)
}

fn download_dmg(
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

fn run_install_script(script_path: &Path, dmg_path: &Path, tag: &str) -> Result<(), String> {
    let output = Command::new("/bin/bash")
        .arg(script_path)
        .env("RELEASE_TAG", tag)
        .env("DMG_FILE", dmg_path)
        .env("OPEN_APP", "0")
        .output()
        .map_err(|error| format!("无法启动安装脚本: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if !stderr.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };
    Err(if detail.is_empty() {
        "安装脚本执行失败。".to_string()
    } else {
        detail
    })
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
        let asset_arch = macos_asset_arch(std::env::consts::ARCH)?;
        let dmg_url = build_macos_dmg_url(tag, asset_arch);
        if !dmg_url_exists(&client, &dmg_url) {
            return Err(format!("未找到安装包: {dmg_url}"));
        }

        let tmp_dir =
            std::env::temp_dir().join(format!("mozi-macos-update-{}", std::process::id()));
        fs::create_dir_all(&tmp_dir).map_err(|error| format!("无法创建临时目录: {error}"))?;
        let dmg_path = tmp_dir.join("Mozi.dmg");
        let script_path = write_install_script(&tmp_dir)?;

        let result = (|| {
            download_dmg(&client, &dmg_url, &dmg_path, &on_event)?;
            run_install_script(&script_path, &dmg_path, tag)?;
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
    fn builds_the_same_dmg_url_as_the_install_script() {
        assert_eq!(
            build_macos_dmg_url("v0.9.1", "aarch64"),
            "https://github.com/Yunz93/Mozi/releases/download/v0.9.1/Mozi_0.9.1_aarch64.dmg"
        );
        assert_eq!(
            build_macos_dmg_url("v0.9.1", "x64"),
            "https://github.com/Yunz93/Mozi/releases/download/v0.9.1/Mozi_0.9.1_x64.dmg"
        );
        assert_eq!(macos_asset_arch("aarch64").unwrap(), "aarch64");
        assert_eq!(macos_asset_arch("x86_64").unwrap(), "x64");
        assert!(INSTALL_SCRIPT.contains("Mozi_%s_%s.dmg"));
        assert!(INSTALL_SCRIPT.contains("DMG_FILE"));
        assert!(INSTALL_SCRIPT.contains("OPEN_APP"));
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
