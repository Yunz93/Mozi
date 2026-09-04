use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::{Client, Method};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{canonicalize_existing_path, ensure_path_allowed, SecurityState};

const GITHUB_API_CONNECT_TIMEOUT_SECS: u64 = 10;
const GITHUB_API_REQUEST_TIMEOUT_SECS: u64 = 30;
const WECHAT_API_CONNECT_TIMEOUT_SECS: u64 = 10;
const WECHAT_API_REQUEST_TIMEOUT_SECS: u64 = 30;

/// Matches `identifier` in `tauri.conf.json` — log path aligns with Tauri app config folder layout.
const APP_CONFIG_DIR_NAME: &str = "com.bxyz.markdown-press";

fn publish_log_file_path() -> Option<PathBuf> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let mut path = dirs::config_dir()?;
            path.push(APP_CONFIG_DIR_NAME);
            path.push("publish-debug.log");
            Some(path)
        })
        .clone()
}

const PUBLISH_DEBUG_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn publish_debug_file_enabled() -> bool {
    cfg!(debug_assertions)
        || std::env::var("MOZI_PUBLISH_DEBUG")
            .map(|value| value == "1")
            .unwrap_or(false)
}

fn publish_log(message: impl AsRef<str>) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let line = format!(
        "[publish_simple_blog][{}.{:03}] {}",
        now.as_secs(),
        now.subsec_millis(),
        message.as_ref()
    );
    println!("{}", line);
    log::info!("{}", line);
    if !publish_debug_file_enabled() {
        return;
    }
    if let Some(path) = publish_log_file_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > PUBLISH_DEBUG_LOG_MAX_BYTES {
                let _ = OpenOptions::new()
                    .write(true)
                    .truncate(true)
                    .open(&path);
            }
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{}", line);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishSimpleBlogAsset {
    source_path: String,
    target_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishWechatLocalImageAsset {
    placeholder: String,
    source_path: Option<String>,
    source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishSimpleBlogRequest {
    blog_repo_url: String,
    blog_github_token: Option<String>,
    post_relative_path: String,
    asset_directory_relative_path: String,
    markdown_content: String,
    assets: Vec<PublishSimpleBlogAsset>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishWechatDraftRequest {
    wechat_app_id: String,
    wechat_app_secret: Option<String>,
    draft_media_id: Option<String>,
    title: String,
    author: Option<String>,
    digest: Option<String>,
    content_source_url: Option<String>,
    show_cover_pic: bool,
    cover_image_path: String,
    content_html: String,
    image_assets: Vec<PublishWechatLocalImageAsset>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishSimpleBlogResult {
    deployment_url: Option<String>,
    build_output: String,
    deploy_output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishWechatDraftResult {
    media_id: String,
}

#[derive(Debug)]
struct PreparedPublishFile {
    relative_path: PathBuf,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct GitHubRepoResponse {
    default_branch: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRefResponse {
    object: GitHubGitObject,
}

#[derive(Debug, Deserialize)]
struct GitHubGitObject {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GitHubCommitResponse {
    tree: GitHubCommitTree,
}

#[derive(Debug, Deserialize)]
struct GitHubCommitTree {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GitHubTreeResponse {
    truncated: bool,
    tree: Vec<GitHubTreeItem>,
}

#[derive(Debug, Deserialize)]
struct GitHubTreeItem {
    path: String,
    #[serde(rename = "type")]
    item_type: String,
    sha: Option<String>,
}

#[derive(Debug, Serialize)]
struct GitHubCreateBlobRequest {
    content: String,
    encoding: String,
}

#[derive(Debug, Deserialize)]
struct GitHubCreateBlobResponse {
    sha: String,
}

#[derive(Debug, Serialize)]
struct GitHubCreateTreeRequest {
    base_tree: String,
    tree: Vec<GitHubTreeEntry>,
}

#[derive(Debug, Serialize)]
struct GitHubTreeEntry {
    path: String,
    mode: String,
    #[serde(rename = "type")]
    item_type: String,
    sha: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubCreateTreeResponse {
    sha: String,
}

#[derive(Debug, Serialize)]
struct GitHubCreateCommitRequest {
    message: String,
    tree: String,
    parents: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubCreateCommitResponse {
    sha: String,
}

#[derive(Debug, Serialize)]
struct GitHubUpdateRefRequest {
    sha: String,
    force: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubApiErrorResponse {
    message: String,
}

#[derive(Debug, Deserialize)]
struct WechatAccessTokenResponse {
    access_token: Option<String>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WechatUploadImageResponse {
    url: Option<String>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WechatAddMaterialResponse {
    media_id: Option<String>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WechatDraftAddResponse {
    media_id: Option<String>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WechatCommonResponse {
    errcode: Option<i64>,
    errmsg: Option<String>,
}

#[derive(Debug, Serialize)]
struct WechatDraftArticleRequest {
    title: String,
    author: String,
    digest: String,
    content: String,
    content_source_url: String,
    thumb_media_id: String,
    show_cover_pic: u8,
}

#[derive(Debug, Serialize)]
struct WechatDraftAddPayload {
    articles: Vec<WechatDraftArticleRequest>,
}

#[derive(Debug, Serialize)]
struct WechatDraftUpdatePayload {
    media_id: String,
    index: u8,
    articles: WechatDraftArticleRequest,
}

#[tauri::command]
pub(crate) async fn publish_simple_blog(
    request: PublishSimpleBlogRequest,
    security_state: tauri::State<'_, SecurityState>,
) -> Result<PublishSimpleBlogResult, String> {
    validate_publish_request_access(security_state.inner(), &request)?;
    blog::publish_remote_simple_blog(&request).await
}

#[tauri::command]
pub(crate) async fn publish_wechat_draft(
    request: PublishWechatDraftRequest,
    security_state: tauri::State<'_, SecurityState>,
) -> Result<PublishWechatDraftResult, String> {
    validate_wechat_publish_request_access(security_state.inner(), &request)?;
    wechat::publish_remote_wechat_draft(&request).await
}


mod blog;
mod wechat;

fn validate_publish_request_access(
    security_state: &SecurityState,
    request: &PublishSimpleBlogRequest,
) -> Result<(), String> {
    for asset in &request.assets {
        let source_path = canonicalize_existing_path(&asset.source_path)?;
        ensure_path_allowed(security_state, &source_path)?;
    }

    Ok(())
}

fn validate_wechat_publish_request_access(
    security_state: &SecurityState,
    request: &PublishWechatDraftRequest,
) -> Result<(), String> {
    let cover_image_path = canonicalize_existing_path(&request.cover_image_path)?;
    ensure_path_allowed(security_state, &cover_image_path)?;

    for asset in &request.image_assets {
        if let Some(source_path) = asset
            .source_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let source_path = canonicalize_existing_path(source_path)?;
            ensure_path_allowed(security_state, &source_path)?;
        }
    }

    Ok(())
}

