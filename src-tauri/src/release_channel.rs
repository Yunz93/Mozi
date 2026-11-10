use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;

const REPOSITORY: &str = "Yunz93/Mozi";

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}

pub fn release_version(tag: &str) -> Option<Version> {
    let version = Version::parse(tag.strip_prefix('v')?).ok()?;
    if !version.build.is_empty() {
        return None;
    }
    if !version.pre.is_empty() {
        let sequence = version.pre.as_str().strip_prefix("beta.")?;
        if sequence.starts_with('0') || sequence.parse::<u64>().ok()? == 0 {
            return None;
        }
    }
    Some(version)
}

pub fn manifest_url_for_tag(tag: &str) -> Result<String, String> {
    release_version(tag).ok_or_else(|| format!("无效的版本标签: {tag}"))?;
    Ok(format!(
        "https://github.com/{REPOSITORY}/releases/download/{tag}/latest.json"
    ))
}

pub fn beta_manifest_url(current_version: &str) -> Result<Option<String>, String> {
    let current =
        Version::parse(current_version).map_err(|error| format!("无法解析当前版本: {error}"))?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mozi-updater")
        .build()
        .map_err(|error| format!("无法创建更新请求: {error}"))?;
    let releases: Vec<Release> = client
        .get(format!(
            "https://api.github.com/repos/{REPOSITORY}/releases?per_page=100"
        ))
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .and_then(reqwest::blocking::Response::json)
        .map_err(|error| format!("获取 Beta 更新失败: {error}"))?;
    // 按语义版本选取，确保 beta.10 高于 beta.2，同版本正式版高于 Beta。
    let latest = releases
        .into_iter()
        .filter_map(|release| {
            let version = release_version(&release.tag_name)?;
            if release.draft
                || release.prerelease != !version.pre.is_empty()
                || version <= current
                || !release
                    .assets
                    .iter()
                    .any(|asset| asset.name == "latest.json")
            {
                return None;
            }
            Some((version, release.tag_name))
        })
        .max_by(|left, right| left.0.cmp(&right.0));
    latest
        .map(|(_, tag)| manifest_url_for_tag(&tag))
        .transpose()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

pub async fn check_beta_update(webview: Webview) -> Result<Option<UpdateMetadata>, String> {
    let current_version = webview.app_handle().package_info().version.to_string();
    let endpoint =
        tauri::async_runtime::spawn_blocking(move || beta_manifest_url(&current_version))
            .await
            .map_err(|error| format!("检查 Beta 更新失败: {error}"))??;
    let Some(endpoint) = endpoint else {
        return Ok(None);
    };
    let updater = webview
        .updater_builder()
        .endpoints(vec![endpoint
            .parse()
            .map_err(|error| format!("无效的更新地址: {error}"))?])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    // 复用 updater 的资源表与签名安装流程，渠道只决定本次检查的地址。
    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update
            .raw_json
            .get("pub_date")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(Some(metadata))
}
