use semver::Version;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;

const REPOSITORY: &str = "Yunz93/Mozi";
const RELEASE_INDEX_URL: &str =
    "https://raw.githubusercontent.com/Yunz93/Mozi/updater-index/releases.json";
const INDEX_CACHE_TTL: Duration = Duration::from_secs(60);
const INDEX_ERROR_TTL: Duration = Duration::from_secs(5);

#[derive(Clone, Deserialize)]
struct ReleaseAsset {
    name: String,
}

#[derive(Clone, Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseIndex {
    schema_version: u32,
    releases: Vec<Release>,
}

struct CachedIndex {
    url: String,
    expires_at: Instant,
    result: Result<ReleaseIndex, String>,
}

#[derive(Default)]
struct IndexCache(Mutex<Option<CachedIndex>>);

impl IndexCache {
    fn load(&self, url: &str) -> Result<ReleaseIndex, String> {
        // 网络请求也持有锁，使多个窗口及手动、自动检查共享同一次读取。
        let mut cached = self
            .0
            .lock()
            .map_err(|_| "更新索引缓存不可用。".to_string())?;
        if let Some(entry) = cached.as_ref() {
            if entry.url == url && Instant::now() < entry.expires_at {
                return entry.result.clone();
            }
        }
        let result = fetch_release_index(url);
        let ttl = if result.is_ok() {
            INDEX_CACHE_TTL
        } else {
            INDEX_ERROR_TTL
        };
        *cached = Some(CachedIndex {
            url: url.to_owned(),
            expires_at: Instant::now() + ttl,
            result: result.clone(),
        });
        result
    }
}

fn fetch_release_index(url: &str) -> Result<ReleaseIndex, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .user_agent("Mozi-updater")
        .build()
        .map_err(|error| format!("无法创建更新请求: {error}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("获取 Beta 更新索引失败: {error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Beta 更新索引尚未发布，请稍后重试或前往发布页面手动下载。".to_string());
    }
    if !response.status().is_success() {
        return Err(format!(
            "获取 Beta 更新索引失败: HTTP {}，请稍后重试。",
            response.status().as_u16()
        ));
    }
    let index: ReleaseIndex = response
        .json()
        .map_err(|error| format!("Beta 更新索引格式无效: {error}"))?;
    if index.schema_version != 1 {
        return Err("不支持的 Beta 更新索引版本。".to_string());
    }
    Ok(index)
}

// 本地夹具只允许在显式启用驱动的调试构建中使用，发布包始终使用固定地址。
#[cfg(all(debug_assertions, feature = "desktop-e2e"))]
fn fixture_index_url() -> Result<Option<reqwest::Url>, String> {
    let Some(value) = std::env::var_os("MOZI_TEST_RELEASE_INDEX_URL") else {
        return Ok(None);
    };
    let url = reqwest::Url::parse(&value.to_string_lossy())
        .map_err(|error| format!("无效的本地更新夹具: {error}"))?;
    if url.scheme() != "http" || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]")) {
        return Err("更新测试夹具仅允许 HTTP 回环地址。".to_string());
    }
    Ok(Some(url))
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
    #[cfg(all(debug_assertions, feature = "desktop-e2e"))]
    if let Some(url) = fixture_index_url()? {
        return url
            .join(&format!("/releases/download/{tag}/latest.json"))
            .map(|url| url.to_string())
            .map_err(|error| error.to_string());
    }
    Ok(format!(
        "https://github.com/{REPOSITORY}/releases/download/{tag}/latest.json"
    ))
}

pub fn beta_manifest_url(current_version: &str) -> Result<Option<String>, String> {
    static CACHE: OnceLock<IndexCache> = OnceLock::new();
    #[allow(unused_mut)]
    let mut url = RELEASE_INDEX_URL.to_owned();
    #[cfg(all(debug_assertions, feature = "desktop-e2e"))]
    if let Some(fixture) = fixture_index_url()? {
        url = fixture.to_string();
    }
    beta_manifest_url_from_index(
        current_version,
        &url,
        CACHE.get_or_init(IndexCache::default),
    )
}

fn beta_manifest_url_from_index(
    current_version: &str,
    url: &str,
    cache: &IndexCache,
) -> Result<Option<String>, String> {
    let current =
        Version::parse(current_version).map_err(|error| format!("无法解析当前版本: {error}"))?;
    let index = cache.load(url)?;
    // 按语义版本选取，确保 beta.10 高于 beta.2，同版本正式版高于 Beta。
    let latest = index
        .releases
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

#[cfg(test)]
#[path = "release_channel_tests.rs"]
mod tests;
