use super::*;

use std::net::{IpAddr, ToSocketAddrs};

const MAX_WECHAT_REMOTE_DOWNLOAD_BYTES: usize = 10 * 1024 * 1024;

pub(super) async fn publish_remote_wechat_draft(
    request: &PublishWechatDraftRequest,
) -> Result<PublishWechatDraftResult, String> {
    publish_log("publish_wechat_draft: start request");

    let app_id = request.wechat_app_id.trim();
    if app_id.is_empty() {
        return Err("WeChat AppID is required for publishing.".to_string());
    }

    let app_secret = request
        .wechat_app_secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "WeChat AppSecret is required for publishing.".to_string())?;

    if request.title.trim().is_empty() {
        return Err("WeChat draft title is required.".to_string());
    }

    let client = create_wechat_api_client()?;
    let access_token = fetch_wechat_access_token(&client, app_id, app_secret).await?;
    publish_log("publish_wechat_draft: access token ready");

    let mut content_html = request.content_html.clone();
    for asset in &request.image_assets {
        let url = upload_wechat_article_image(&client, &access_token, asset).await?;
        content_html = content_html.replace(&asset.placeholder, &url);
    }

    let thumb_media_id =
        upload_wechat_thumb_image(&client, &access_token, Path::new(&request.cover_image_path))
            .await?;

    let article = WechatDraftArticleRequest {
        title: request.title.trim().to_string(),
        author: request.author.as_deref().unwrap_or("").trim().to_string(),
        digest: request.digest.as_deref().unwrap_or("").trim().to_string(),
        content: content_html,
        content_source_url: request
            .content_source_url
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string(),
        thumb_media_id,
        show_cover_pic: if request.show_cover_pic { 1 } else { 0 },
    };

    let media_id = if let Some(existing_media_id) = request
        .draft_media_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let updated =
            update_wechat_draft(&client, &access_token, existing_media_id, &article).await?;
        if updated {
            existing_media_id.to_string()
        } else {
            create_wechat_draft(&client, &access_token, &article).await?
        }
    } else {
        create_wechat_draft(&client, &access_token, &article).await?
    };

    publish_log(format!(
        "publish_wechat_draft: finished media_id={}",
        media_id
    ));
    Ok(PublishWechatDraftResult { media_id })
}

fn create_wechat_api_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(WECHAT_API_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(WECHAT_API_REQUEST_TIMEOUT_SECS))
        .user_agent("markdown-press")
        .build()
        .map_err(|e| wechat_request_error("Failed to create WeChat API client", e))
}

fn wechat_request_error(context: &str, e: reqwest::Error) -> String {
    format!("{}: {}", context, e.without_url())
}

fn wechat_api_error(
    errcode: Option<i64>,
    errmsg: Option<String>,
    context: &str,
) -> Result<(), String> {
    match errcode.unwrap_or(0) {
        0 => Ok(()),
        code => Err(format!(
            "WeChat API error {} during {}: {}",
            code,
            context,
            errmsg.unwrap_or_else(|| "unknown error".to_string())
        )),
    }
}

async fn fetch_wechat_access_token(
    client: &Client,
    app_id: &str,
    app_secret: &str,
) -> Result<String, String> {
    let response = client
        .get("https://api.weixin.qq.com/cgi-bin/token")
        .query(&[
            ("grant_type", "client_credential"),
            ("appid", app_id),
            ("secret", app_secret),
        ])
        .send()
        .await
        .map_err(|e| wechat_request_error("Failed to request WeChat access token", e))?;

    let payload = response
        .json::<WechatAccessTokenResponse>()
        .await
        .map_err(|e| {
            wechat_request_error("Failed to decode WeChat access token response", e)
        })?;

    wechat_api_error(payload.errcode, payload.errmsg, "fetching access token")?;
    payload
        .access_token
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "WeChat access token response did not include access_token.".to_string())
}

fn guess_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn guess_mime_type_from_name(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

async fn wechat_api_upload_bytes<T: DeserializeOwned>(
    client: &Client,
    url: &str,
    context: &str,
    file_name: String,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<T, String> {
    let media = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(mime_type)
        .map_err(|e| {
            wechat_request_error(&format!("Failed to prepare {} multipart upload", context), e)
        })?;
    let form = reqwest::multipart::Form::new().part("media", media);

    client
        .post(url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            wechat_request_error(&format!("Failed to upload {} to WeChat API", context), e)
        })?
        .json::<T>()
        .await
        .map_err(|e| {
            wechat_request_error(
                &format!("Failed to decode WeChat {} upload response", context),
                e,
            )
        })
}

async fn wechat_api_upload_file<T: DeserializeOwned>(
    client: &Client,
    url: &str,
    source_path: &Path,
    context: &str,
) -> Result<T, String> {
    let bytes = fs::read(source_path).map_err(|e| {
        format!(
            "Failed to read {} file {}: {}",
            context,
            source_path.display(),
            e
        )
    })?;
    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("upload.bin")
        .to_string();
    wechat_api_upload_bytes(
        client,
        url,
        context,
        file_name,
        guess_mime_type(source_path),
        bytes,
    )
    .await
}

async fn wechat_api_upload_remote_url<T: DeserializeOwned>(
    client: &Client,
    url: &str,
    remote_url: &str,
    context: &str,
) -> Result<T, String> {
    validate_wechat_remote_image_url(remote_url)?;

    let response = client.get(remote_url).send().await.map_err(|e| {
        wechat_request_error(
            &format!("Failed to download remote {} {}", context, remote_url),
            e,
        )
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Failed to download remote {} {}: HTTP {}",
            context, remote_url, status
        ));
    }

    if let Some(content_length) = response.content_length() {
        if content_length as usize > MAX_WECHAT_REMOTE_DOWNLOAD_BYTES {
            return Err(format!(
                "Remote {} exceeds maximum download size of {} bytes: {}",
                context, MAX_WECHAT_REMOTE_DOWNLOAD_BYTES, remote_url
            ));
        }
    }

    let downloaded_url = response.url().clone();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| {
            wechat_request_error(
                &format!("Failed to read remote {} bytes {}", context, remote_url),
                e,
            )
        })?
        .to_vec();
    if bytes.len() > MAX_WECHAT_REMOTE_DOWNLOAD_BYTES {
        return Err(format!(
            "Remote {} exceeds maximum download size of {} bytes: {}",
            context, MAX_WECHAT_REMOTE_DOWNLOAD_BYTES, remote_url
        ));
    }
    let file_name = downloaded_url
        .path_segments()
        .and_then(|segments| segments.last())
        .filter(|segment| !segment.trim().is_empty())
        .unwrap_or("remote-image")
        .to_string();
    let mime_type = content_type
        .as_deref()
        .filter(|value| value.starts_with("image/"))
        .unwrap_or_else(|| guess_mime_type_from_name(&file_name));

    wechat_api_upload_bytes(client, url, context, file_name, mime_type, bytes).await
}

fn validate_wechat_remote_image_url(remote_url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(remote_url.trim())
        .map_err(|e| format!("Invalid remote image URL {}: {}", remote_url, e))?;
    if parsed.scheme() != "https" {
        return Err(format!(
            "Remote image URL must use HTTPS: {}",
            remote_url
        ));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| format!("Remote image URL is missing a host: {}", remote_url))?;
    let host_lower = host.to_ascii_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return Err(format!("Remote image URL host is not allowed: {}", remote_url));
    }

    if host.parse::<IpAddr>().map(is_blocked_ip).unwrap_or(false) {
        return Err(format!("Remote image URL host is not allowed: {}", remote_url));
    }

    let port = parsed.port_or_known_default().unwrap_or(443);
    let socket_addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve remote image URL host {}: {}", host, e))?;
    for addr in socket_addrs {
        if is_blocked_ip(addr.ip()) {
            return Err(format!(
                "Remote image URL resolves to a blocked address: {}",
                remote_url
            ));
        }
    }

    Ok(())
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

async fn upload_wechat_article_image(
    client: &Client,
    access_token: &str,
    asset: &PublishWechatLocalImageAsset,
) -> Result<String, String> {
    let url = format!(
        "https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token={}",
        access_token
    );
    let payload: WechatUploadImageResponse = if let Some(source_path) = asset
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        wechat_api_upload_file(client, &url, Path::new(source_path), "article image").await?
    } else if let Some(source_url) = asset
        .source_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        wechat_api_upload_remote_url(client, &url, source_url, "article image").await?
    } else {
        return Err(
            "WeChat article image asset is missing both sourcePath and sourceUrl.".to_string(),
        );
    };
    wechat_api_error(payload.errcode, payload.errmsg, "uploading article image")?;
    payload
        .url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "WeChat article image upload did not return url.".to_string())
}

async fn upload_wechat_thumb_image(
    client: &Client,
    access_token: &str,
    source_path: &Path,
) -> Result<String, String> {
    let url = format!(
        "https://api.weixin.qq.com/cgi-bin/material/add_material?access_token={}&type=thumb",
        access_token
    );
    let payload: WechatAddMaterialResponse =
        wechat_api_upload_file(client, &url, source_path, "thumbnail image").await?;
    wechat_api_error(payload.errcode, payload.errmsg, "uploading thumbnail image")?;
    payload
        .media_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "WeChat thumbnail upload did not return media_id.".to_string())
}

async fn create_wechat_draft(
    client: &Client,
    access_token: &str,
    article: &WechatDraftArticleRequest,
) -> Result<String, String> {
    let url = format!(
        "https://api.weixin.qq.com/cgi-bin/draft/add?access_token={}",
        access_token
    );
    let payload = WechatDraftAddPayload {
        articles: vec![WechatDraftArticleRequest {
            title: article.title.clone(),
            author: article.author.clone(),
            digest: article.digest.clone(),
            content: article.content.clone(),
            content_source_url: article.content_source_url.clone(),
            thumb_media_id: article.thumb_media_id.clone(),
            show_cover_pic: article.show_cover_pic,
        }],
    };

    let response = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| wechat_request_error("Failed to create WeChat draft", e))?;

    let payload = response
        .json::<WechatDraftAddResponse>()
        .await
        .map_err(|e| {
            wechat_request_error("Failed to decode WeChat draft/create response", e)
        })?;
    wechat_api_error(payload.errcode, payload.errmsg, "creating draft")?;
    payload
        .media_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "WeChat draft/create response did not include media_id.".to_string())
}

/// 草稿 `media_id` 已失效 / 草稿不存在时应回退新建。
///
/// 来源：
/// - `40007` `invalid media_id`：微信通用错误码；`draft/update` 在草稿
///   media_id 无效或草稿已被后台删除时返回。
///   https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Global_Return_Code.html
/// - `draft/update` 文档列出的 `53404`/`53405` 实际是带货能力限制
///   （账号被限制带货 / 商品信息有误），不是草稿不存在，回退新建会再次失败，
///   因此不纳入本集合。
///   https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_update
const STALE_DRAFT_MEDIA_ERRCODES: &[i64] = &[40007];

fn is_stale_draft_media_error(errcode: i64) -> bool {
    STALE_DRAFT_MEDIA_ERRCODES.contains(&errcode)
}

async fn update_wechat_draft(
    client: &Client,
    access_token: &str,
    media_id: &str,
    article: &WechatDraftArticleRequest,
) -> Result<bool, String> {
    let url = format!(
        "https://api.weixin.qq.com/cgi-bin/draft/update?access_token={}",
        access_token
    );
    let payload = WechatDraftUpdatePayload {
        media_id: media_id.to_string(),
        index: 0,
        articles: WechatDraftArticleRequest {
            title: article.title.clone(),
            author: article.author.clone(),
            digest: article.digest.clone(),
            content: article.content.clone(),
            content_source_url: article.content_source_url.clone(),
            thumb_media_id: article.thumb_media_id.clone(),
            show_cover_pic: article.show_cover_pic,
        },
    };

    let response = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| wechat_request_error("Failed to update WeChat draft", e))?;

    let payload = response
        .json::<WechatCommonResponse>()
        .await
        .map_err(|e| {
            wechat_request_error("Failed to decode WeChat draft/update response", e)
        })?;
    let code = payload.errcode.unwrap_or(0);
    if code == 0 {
        return Ok(true);
    }
    if is_stale_draft_media_error(code) {
        publish_log(format!(
            "publish_wechat_draft: stale media_id errcode={code}, falling back to create"
        ));
        return Ok(false);
    }
    wechat_api_error(payload.errcode, payload.errmsg, "updating draft")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_stale_draft_media_errors() {
        assert!(is_stale_draft_media_error(40007));
        // 官方 draft/update 文档：53404/53405 是带货限制，不是草稿不存在。
        assert!(!is_stale_draft_media_error(53404));
        assert!(!is_stale_draft_media_error(53405));
        assert!(!is_stale_draft_media_error(53406));
        assert!(!is_stale_draft_media_error(45166));
        assert!(!is_stale_draft_media_error(40114));
        assert!(!is_stale_draft_media_error(0));
    }
}

