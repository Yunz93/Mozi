use super::*;

use crate::url_encode::percent_encode_component;

fn connection_failure(
    error_kind: BlogConnectionError,
    repository: Option<String>,
) -> BlogConnectionResult {
    let status = match error_kind {
        BlogConnectionError::Archived
        | BlogConnectionError::Disabled
        | BlogConnectionError::EmptyRepository => "warning",
        _ => "failed",
    };
    BlogConnectionResult {
        status,
        repository,
        branch: None,
        error_kind: Some(error_kind),
    }
}

fn connection_error_kind(error: &str) -> BlogConnectionError {
    // 复用发布接口的错误格式，仅返回分类，不把远端响应或凭据带回界面。
    let message = error.to_ascii_lowercase();
    if message.contains("rate limit") || message.contains("returned 429") {
        BlogConnectionError::RateLimited
    } else if message.contains("returned 401") {
        BlogConnectionError::InvalidToken
    } else if message.contains("returned 403") {
        BlogConnectionError::Forbidden
    } else if message.contains("returned 404") {
        BlogConnectionError::NotFound
    } else if message.contains("returned 409") {
        BlogConnectionError::EmptyRepository
    } else if message.contains("timed out") {
        BlogConnectionError::Timeout
    } else if message.contains("request failed") {
        BlogConnectionError::Network
    } else {
        BlogConnectionError::Unexpected
    }
}

pub(super) async fn check_simple_blog_connection(
    request: &CheckSimpleBlogConnectionRequest,
) -> BlogConnectionResult {
    let repo_slug = normalize_repo_target(&request.blog_repo_url)
        .ok()
        .and_then(|remote| github_repo_slug_from_remote(&remote));
    let Some(repo_slug) = repo_slug else {
        return connection_failure(BlogConnectionError::InvalidRepo, None);
    };
    let Some(token) = normalize_optional_token(request.blog_github_token.as_deref()) else {
        return connection_failure(BlogConnectionError::MissingToken, None);
    };
    let client = match create_github_api_client(&token) {
        Ok(client) => client,
        Err(_) => return connection_failure(BlogConnectionError::InvalidToken, None),
    };
    // 固定读取 GitHub 仓库及默认分支，不调用创建提交或更新引用的接口。
    let repo_info: GitHubRepoResponse =
        match github_api_get(&client, &format!("/repos/{}", repo_slug)).await {
            Ok(info) => info,
            Err(error) => return connection_failure(connection_error_kind(&error), None),
        };
    if repo_info.disabled {
        return connection_failure(BlogConnectionError::Disabled, Some(repo_slug));
    }
    if repo_info.archived {
        return connection_failure(BlogConnectionError::Archived, Some(repo_slug));
    }
    let branch = repo_info.default_branch.trim();
    if branch.is_empty() {
        return connection_failure(BlogConnectionError::EmptyRepository, Some(repo_slug));
    }
    let branch_result: Result<GitHubRefResponse, String> = github_api_get(
        &client,
        &format!(
            "/repos/{}/git/ref/heads/{}",
            repo_slug,
            percent_encode_component(branch)
        ),
    )
    .await;
    match branch_result {
        Ok(_) => BlogConnectionResult {
            status: "passed",
            repository: Some(repo_slug),
            branch: Some(branch.to_string()),
            error_kind: None,
        },
        Err(error) => connection_failure(connection_error_kind(&error), Some(repo_slug)),
    }
}

pub(super) async fn publish_remote_simple_blog(
    request: &PublishSimpleBlogRequest,
) -> Result<PublishSimpleBlogResult, String> {
    publish_log("start request");
    let remote_repo = normalize_repo_target(&request.blog_repo_url)?;
    let token =
        normalize_optional_token(request.blog_github_token.as_deref()).ok_or_else(|| {
            "GitHub token is required for publishing. Set it in Publishing settings first."
                .to_string()
        })?;
    let repo_slug = github_repo_slug_from_remote(&remote_repo).ok_or_else(|| {
        "Failed to resolve the GitHub repository owner and name from the configured repository URL."
            .to_string()
    })?;
    publish_log(format!(
        "normalized repo={} post={} assets={}",
        repo_slug,
        request.post_relative_path,
        request.assets.len()
    ));

    publish_remote_simple_blog_via_github_api(request, &remote_repo, &repo_slug, &token).await
}

async fn publish_remote_simple_blog_via_github_api(
    request: &PublishSimpleBlogRequest,
    remote_repo: &str,
    repo_slug: &str,
    token: &str,
) -> Result<PublishSimpleBlogResult, String> {
    publish_log("creating GitHub API client");
    let client = create_github_api_client(token)?;
    let (owner, repo) = split_github_repo_slug(repo_slug)?;
    publish_log(format!("loading repo metadata for {}/{}", owner, repo));
    let repo_info: GitHubRepoResponse =
        github_api_get(&client, &format!("/repos/{}/{}", owner, repo)).await?;

    let branch = repo_info.default_branch.trim();
    if branch.is_empty() {
        return Err("GitHub repository default branch is empty.".to_string());
    }
    publish_log(format!("default branch={}", branch));

    publish_log("loading branch ref");
    let branch_ref: GitHubRefResponse = github_api_get(
        &client,
        &format!(
            "/repos/{}/{}/git/ref/heads/{}",
            owner,
            repo,
            percent_encode_component(branch)
        ),
    )
    .await?;
    let current_commit_sha = branch_ref.object.sha;
    publish_log(format!("current commit sha={}", current_commit_sha));

    publish_log("loading current commit");
    let current_commit: GitHubCommitResponse = github_api_get(
        &client,
        &format!(
            "/repos/{}/{}/git/commits/{}",
            owner, repo, current_commit_sha
        ),
    )
    .await?;
    let current_tree_sha = current_commit.tree.sha;
    publish_log(format!("current tree sha={}", current_tree_sha));

    publish_log("loading repository tree");
    let current_tree: GitHubTreeResponse = github_api_get(
        &client,
        &format!(
            "/repos/{}/{}/git/trees/{}?recursive=1",
            owner, repo, current_tree_sha
        ),
    )
    .await?;
    if current_tree.truncated {
        return Err(
            "GitHub returned a truncated repository tree, so this repository is not currently supported by the API-only publish flow."
                .to_string(),
        );
    }
    publish_log(format!(
        "repository tree entries={}",
        current_tree.tree.len()
    ));

    publish_log("collecting publish files");
    let prepared_files = collect_simple_blog_publish_files(request, remote_repo, branch)?;
    publish_log(format!("prepared files={}", prepared_files.len()));
    let current_files = current_tree_blob_map(&current_tree);
    let post_path = sanitize_relative_path(&request.post_relative_path)?
        .to_string_lossy()
        .replace('\\', "/");
    let existing_post = if let Some(sha) = current_files.get(&post_path) {
        let blob: GitHubBlobResponse = github_api_get(
            &client,
            &format!("/repos/{}/{}/git/blobs/{}", owner, repo, sha),
        )
        .await?;
        if blob.encoding != "base64" {
            return Err("Unsupported remote post encoding. Existing article was preserved.".into());
        }
        let content = BASE64_STANDARD
            .decode(blob.content.replace(['\r', '\n'], ""))
            .map_err(|_| "Could not decode the existing article. It was preserved.")?;
        Some(
            String::from_utf8(content)
                .map_err(|_| "Existing article is not UTF-8. It was preserved.")?,
        )
    } else {
        None
    };
    validate_post_ownership(request, existing_post.as_deref())?;
    publish_log(format!("current blob files={}", current_files.len()));
    publish_log("building tree entries");
    let tree_entries = build_github_tree_entries(
        &client,
        owner,
        repo,
        request,
        &prepared_files,
        &current_files,
    )
    .await?;
    publish_log(format!("tree entries to update={}", tree_entries.len()));

    if tree_entries.is_empty() {
        publish_log("no content changes detected");
        return Ok(PublishSimpleBlogResult {
            deployment_url: None,
            build_output: "No content changes detected. Skip GitHub commit update.".to_string(),
            deploy_output: String::new(),
        });
    }

    publish_log("creating git tree");
    let create_tree: GitHubCreateTreeResponse = github_api_post(
        &client,
        &format!("/repos/{}/{}/git/trees", owner, repo),
        &GitHubCreateTreeRequest {
            base_tree: current_tree_sha,
            tree: tree_entries,
        },
    )
    .await?;
    publish_log(format!("created tree sha={}", create_tree.sha));

    let post_relative_path = sanitize_relative_path(&request.post_relative_path)?;
    let post_name = post_relative_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("post");
    publish_log(format!("creating commit for {}", post_name));
    let create_commit: GitHubCreateCommitResponse = github_api_post(
        &client,
        &format!("/repos/{}/{}/git/commits", owner, repo),
        &GitHubCreateCommitRequest {
            message: format!("publish: update {}", post_name),
            tree: create_tree.sha,
            parents: vec![current_commit_sha.clone()],
        },
    )
    .await?;
    publish_log(format!("created commit sha={}", create_commit.sha));

    publish_log(format!("updating branch ref {}", branch));
    let _: GitHubRefResponse = github_api_patch(
        &client,
        &format!(
            "/repos/{}/{}/git/refs/heads/{}",
            owner,
            repo,
            percent_encode_component(branch)
        ),
        &GitHubUpdateRefRequest {
            sha: create_commit.sha.clone(),
            force: false,
        },
    )
    .await?;
    publish_log("publish finished successfully");

    Ok(PublishSimpleBlogResult {
        deployment_url: None,
        build_output: format!("Created GitHub commit {}", create_commit.sha),
        deploy_output: format!("Updated branch {} via GitHub API.", branch),
    })
}

fn collect_simple_blog_publish_files(
    request: &PublishSimpleBlogRequest,
    remote_repo: &str,
    target_branch: &str,
) -> Result<Vec<PreparedPublishFile>, String> {
    publish_log("rewriting markdown asset URLs");
    let post_relative_path = sanitize_relative_path(&request.post_relative_path)?;
    let markdown_content = rewrite_markdown_asset_urls(
        &request.markdown_content,
        &request.assets,
        remote_repo,
        target_branch,
    )?;
    let mut files = vec![PreparedPublishFile {
        relative_path: post_relative_path,
        bytes: markdown_content.into_bytes(),
    }];

    for asset in &request.assets {
        let source_path = PathBuf::from(&asset.source_path);
        if !source_path.exists() {
            return Err(format!(
                "Referenced asset does not exist: {}",
                source_path.display()
            ));
        }

        let target_relative_path = sanitize_relative_path(&asset.target_relative_path)?;
        publish_log(format!(
            "reading asset {} -> {}",
            source_path.display(),
            target_relative_path.display()
        ));
        let bytes = fs::read(&source_path)
            .map_err(|e| format!("Failed to read asset from {:?}: {}", source_path, e))?;

        files.push(PreparedPublishFile {
            relative_path: target_relative_path,
            bytes,
        });
    }

    Ok(files)
}

/** 只读取生成器使用的单行标量；不支持的旧 YAML 写法拒绝迁移，不能猜测覆盖。 */
fn frontmatter_scalar(markdown: &str, key: &str) -> Option<String> {
    let body = markdown
        .trim_start_matches('\u{feff}')
        .strip_prefix("---\n")
        .or_else(|| {
            markdown
                .trim_start_matches('\u{feff}')
                .strip_prefix("---\r\n")
        })?;
    let mut found = None;
    for line in body.lines() {
        if line.trim() == "---" {
            return found;
        }
        if let Some(value) = line.strip_prefix(&format!("{key}:")) {
            if found.is_some() {
                return None;
            }
            let value = value.trim();
            let scalar = if value.starts_with('"') {
                serde_json::from_str::<String>(value).ok()?
            } else if value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2 {
                value[1..value.len() - 1].replace("''", "'")
            } else {
                if value.starts_with(['|', '>', '[', '{']) || value.contains(" #") {
                    return None;
                }
                value.to_string()
            };
            found = Some(scalar);
        }
    }
    None
}

fn validate_post_ownership(
    request: &PublishSimpleBlogRequest,
    existing: Option<&str>,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&request.publish_id)
        .map_err(|_| "Publishing identity is missing. Reopen the note and publish again.")?;
    if id.to_string() != request.publish_id.to_ascii_lowercase()
        || frontmatter_scalar(&request.markdown_content, "mozi_blog_id").as_deref()
            != Some(request.publish_id.as_str())
    {
        return Err("Publishing identity does not match the note.".into());
    }
    let post_path = sanitize_relative_path(&request.post_relative_path)?;
    if post_path.parent() != Some(Path::new("posts"))
        || post_path.extension().and_then(|value| value.to_str()) != Some("md")
        || frontmatter_scalar(&request.markdown_content, "mozi_blog_post_path").as_deref()
            != Some(request.post_relative_path.as_str())
    {
        return Err("Publishing target does not match the note.".into());
    }
    // 资源清理只允许触及当前身份的专属目录，不删除旧版可能被其他文章共用的资源。
    if request.asset_directory_relative_path != format!("resource/mozi-{}", request.publish_id)
        || request.assets.iter().any(|asset| {
            !asset
                .target_relative_path
                .starts_with(&format!("{}/", request.asset_directory_relative_path))
        })
    {
        return Err("Publishing resources do not belong to this note.".into());
    }
    let Some(existing) = existing else {
        if request
            .legacy_slug
            .as_ref()
            .is_some_and(|slug| !slug.is_empty())
        {
            return Err("The previously published article was not found at its saved path. Restore the original note filename before migrating its publishing identity; no remote article was changed.".into());
        }
        return Ok(());
    };
    let owner = frontmatter_scalar(existing, "mozi_blog_id");
    if owner.is_none()
        && existing
            .lines()
            .any(|line| line.starts_with("mozi_blog_id:"))
    {
        return Err(
            "The remote article belongs to another note. Existing content was preserved.".into(),
        );
    }
    match owner {
        Some(owner) if owner == request.publish_id => Ok(()),
        Some(_) => Err(
            "The remote article belongs to another note. Existing content was preserved.".into(),
        ),
        None => {
            let expected = request
                .legacy_slug
                .as_deref()
                .filter(|slug| !slug.is_empty());
            let remote = frontmatter_scalar(existing, "slug");
            if expected
                .zip(remote.as_deref())
                .is_some_and(|(expected, remote)| expected.eq_ignore_ascii_case(remote))
            {
                Ok(())
            } else {
                Err("The existing article could not be safely matched to this note. Existing content was preserved.".into())
            }
        }
    }
}

fn rewrite_markdown_asset_urls(
    markdown_content: &str,
    assets: &[PublishSimpleBlogAsset],
    remote_repo: &str,
    target_branch: &str,
) -> Result<String, String> {
    let Some(raw_base_url) = github_raw_base_url(remote_repo, target_branch) else {
        return Ok(markdown_content.to_string());
    };

    let mut rewritten = markdown_content.to_string();
    for asset in assets {
        let target_relative_path = sanitize_relative_path(&asset.target_relative_path)?;
        let normalized_path = target_relative_path.to_string_lossy().replace('\\', "/");
        let raw_url = format!(
            "{}/{}",
            raw_base_url,
            encode_raw_path(&target_relative_path)
        );
        rewritten = rewritten.replace(
            &format!("](/{})", normalized_path),
            &format!("]({})", raw_url),
        );
    }

    Ok(rewritten)
}

fn sanitize_relative_path(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if path.is_absolute() {
        return Err(format!("Path must be relative: {}", raw));
    }

    let mut sanitized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => sanitized.push(part),
            std::path::Component::CurDir => {}
            _ => return Err(format!("Unsafe path component in: {}", raw)),
        }
    }

    if sanitized.as_os_str().is_empty() {
        return Err("Relative path cannot be empty".to_string());
    }

    Ok(sanitized)
}

fn is_valid_repo_segment(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
}

fn normalize_github_repo_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_matches('/');
    let repo = trimmed.trim_end_matches(".git");
    let mut parts = repo.split('/');
    let owner = parts.next()?;
    let name = parts.next()?;
    if parts.next().is_some() || !is_valid_repo_segment(owner) || !is_valid_repo_segment(name) {
        return None;
    }
    Some(format!("{}/{}", owner, name))
}

fn normalize_repo_target(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Blog repository URL cannot be empty.".to_string());
    }

    if let Some(stripped) = trimmed.strip_prefix("https://github.com/") {
        return normalize_github_repo_path(stripped)
            .map(|repo| format!("https://github.com/{}", repo))
            .ok_or_else(|| {
                "Blog repository URL must point to a GitHub repository, for example https://github.com/owner/repo."
                    .to_string()
            });
    }

    if let Some(stripped) = trimmed.strip_prefix("git@github.com:") {
        return normalize_github_repo_path(stripped)
            .map(|repo| format!("git@github.com:{}.git", repo))
            .ok_or_else(|| {
                "Blog repository URL must point to a GitHub repository, for example https://github.com/owner/repo."
                    .to_string()
            });
    }

    if let Some(stripped) = trimmed.strip_prefix("github.com/") {
        return normalize_github_repo_path(stripped)
            .map(|repo| format!("https://github.com/{}", repo))
            .ok_or_else(|| {
                "Blog repository URL must point to a GitHub repository, for example https://github.com/owner/repo."
                    .to_string()
            });
    }

    normalize_github_repo_path(trimmed)
        .map(|repo| format!("https://github.com/{}", repo))
        .ok_or_else(|| {
            "Blog repository URL must point to a GitHub repository, for example https://github.com/owner/repo."
                .to_string()
        })
}

fn github_repo_slug_from_remote(remote_repo: &str) -> Option<String> {
    if let Some(stripped) = remote_repo.trim().strip_prefix("https://github.com/") {
        return normalize_github_repo_path(stripped);
    }

    if let Some(stripped) = remote_repo.trim().strip_prefix("git@github.com:") {
        return normalize_github_repo_path(stripped);
    }

    None
}

fn github_raw_base_url(remote_repo: &str, target_branch: &str) -> Option<String> {
    let repo_slug = github_repo_slug_from_remote(remote_repo)?;
    let (owner, repo) = repo_slug.split_once('/')?;
    Some(format!(
        "https://raw.githubusercontent.com/{}/{}/{}",
        owner,
        repo,
        percent_encode_component(target_branch)
    ))
}

fn encode_raw_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => {
                Some(percent_encode_component(&part.to_string_lossy()))
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_optional_token(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}

fn split_github_repo_slug(repo_slug: &str) -> Result<(&str, &str), String> {
    repo_slug
        .split_once('/')
        .ok_or_else(|| format!("Invalid GitHub repository slug: {}", repo_slug))
}

fn create_github_api_client(token: &str) -> Result<Client, String> {
    publish_log("create_github_api_client: preparing headers");
    let mut headers = reqwest::header::HeaderMap::new();
    let auth_value = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", token))
        .map_err(|e| format!("Failed to encode GitHub token header: {}", e))?;
    headers.insert(reqwest::header::AUTHORIZATION, auth_value);
    publish_log("create_github_api_client: building reqwest client");

    let client = Client::builder()
        .default_headers(headers)
        .connect_timeout(Duration::from_secs(GITHUB_API_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(GITHUB_API_REQUEST_TIMEOUT_SECS))
        .user_agent("markdown-press")
        .build()
        .map_err(|e| format!("Failed to create GitHub API client: {}", e))?;
    publish_log("create_github_api_client: client ready");
    Ok(client)
}

async fn github_api_get<T: DeserializeOwned>(client: &Client, path: &str) -> Result<T, String> {
    github_api_json(
        client,
        Method::GET,
        path,
        Option::<&serde_json::Value>::None,
    )
    .await
}

async fn github_api_post<T: DeserializeOwned, B: Serialize>(
    client: &Client,
    path: &str,
    body: &B,
) -> Result<T, String> {
    github_api_json(client, Method::POST, path, Some(body)).await
}

async fn github_api_patch<T: DeserializeOwned, B: Serialize>(
    client: &Client,
    path: &str,
    body: &B,
) -> Result<T, String> {
    github_api_json(client, Method::PATCH, path, Some(body)).await
}

async fn github_api_json<T: DeserializeOwned, B: Serialize>(
    client: &Client,
    method: Method,
    path: &str,
    body: Option<&B>,
) -> Result<T, String> {
    let url = format!("https://api.github.com{}", path);
    let method_name = method.as_str().to_string();
    publish_log(format!("GitHub API start {} {}", method_name, path));
    let mut request = client
        .request(method.clone(), &url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(body) = body {
        request = request.json(body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                publish_log(format!("GitHub API timeout {} {}", method_name, path));
                return format!(
                    "GitHub API request timed out for {} {}. Check your network connection to github.com and api.github.com, then try again.",
                    method, path
                );
            }

            publish_log(format!(
                "GitHub API failure {} {}: {}",
                method_name, path, e
            ));
            format!("GitHub API request failed for {} {}: {}", method, path, e)
        })?;
    let status = response.status();
    publish_log(format!(
        "GitHub API response {} {} -> {}",
        method_name, path, status
    ));

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let api_message = serde_json::from_str::<GitHubApiErrorResponse>(&body)
            .map(|parsed| parsed.message)
            .unwrap_or_else(|_| body.trim().to_string());
        publish_log(format!(
            "GitHub API error {} {} -> {}",
            method_name, path, api_message
        ));
        let suffix = if api_message.is_empty() {
            String::new()
        } else {
            format!(" {}", api_message)
        };

        return Err(format!(
            "GitHub API returned {} for {}.{}",
            status, path, suffix
        ));
    }

    response
        .json::<T>()
        .await
        .map_err(|e| format!("Failed to decode GitHub API response for {}: {}", path, e))
}

fn current_tree_blob_map(tree: &GitHubTreeResponse) -> BTreeMap<String, String> {
    tree.tree
        .iter()
        .filter(|item| item.item_type == "blob")
        .filter_map(|item| {
            item.sha
                .as_ref()
                .map(|sha| (item.path.clone(), sha.clone()))
        })
        .collect()
}

async fn build_github_tree_entries(
    client: &Client,
    owner: &str,
    repo: &str,
    request: &PublishSimpleBlogRequest,
    files: &[PreparedPublishFile],
    current_files: &BTreeMap<String, String>,
) -> Result<Vec<GitHubTreeEntry>, String> {
    let desired_paths: Vec<String> = files
        .iter()
        .map(|file| file.relative_path.to_string_lossy().replace('\\', "/"))
        .collect();
    let desired_path_set: BTreeSet<&str> = desired_paths.iter().map(String::as_str).collect();
    let asset_directory_relative_path =
        sanitize_relative_path(&request.asset_directory_relative_path)?;
    let asset_directory = asset_directory_relative_path
        .to_string_lossy()
        .replace('\\', "/");
    let mut entries = Vec::new();

    for file in files {
        let path = file.relative_path.to_string_lossy().replace('\\', "/");
        let local_blob_sha = git_blob_sha(&file.bytes);
        if current_files.get(&path) == Some(&local_blob_sha) {
            continue;
        }

        let blob: GitHubCreateBlobResponse = github_api_post(
            client,
            &format!("/repos/{}/{}/git/blobs", owner, repo),
            &GitHubCreateBlobRequest {
                content: BASE64_STANDARD.encode(&file.bytes),
                encoding: "base64".to_string(),
            },
        )
        .await?;

        entries.push(GitHubTreeEntry {
            path,
            mode: "100644".to_string(),
            item_type: "blob".to_string(),
            sha: Some(blob.sha),
        });
    }

    for path in current_files.keys() {
        if path_is_under_asset_directory(path, &asset_directory)
            && !desired_path_set.contains(path.as_str())
        {
            entries.push(GitHubTreeEntry {
                path: path.clone(),
                mode: "100644".to_string(),
                item_type: "blob".to_string(),
                sha: None,
            });
        }
    }

    Ok(entries)
}

fn path_is_under_asset_directory(path: &str, asset_directory: &str) -> bool {
    let asset_directory = asset_directory.trim_end_matches('/');
    if asset_directory.is_empty() {
        return false;
    }
    if path == asset_directory {
        return true;
    }
    path.strip_prefix(asset_directory)
        .map(|rest| rest.starts_with('/'))
        .unwrap_or(false)
}

fn git_blob_sha(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", bytes.len()).as_bytes());
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned_post_request() -> PublishSimpleBlogRequest {
        let id = "00000000-0000-4000-8000-000000000001";
        PublishSimpleBlogRequest {
            blog_repo_url: "https://github.com/example/blog".into(), blog_github_token: None,
            post_relative_path: "posts/note.md".into(), asset_directory_relative_path: format!("resource/mozi-{id}"),
            markdown_content: format!("---\nmozi_blog_id: {id}\nmozi_blog_post_path: posts/note.md\nslug: note\n---\nbody"),
            assets: vec![], publish_id: id.into(), legacy_slug: None,
        }
    }

    #[test]
    fn publish_ownership_rejects_unrelated_posts_before_uploading() {
        let request = owned_post_request();
        assert!(validate_post_ownership(&request, None).is_ok());
        assert!(validate_post_ownership(&request, Some(&request.markdown_content)).is_ok());
        assert!(
            validate_post_ownership(&request, Some("---\nslug: unrelated\n---\nprivate body"))
                .is_err()
        );
        let foreign = request
            .markdown_content
            .replace(&request.publish_id, "00000000-0000-4000-8000-000000000002");
        assert!(validate_post_ownership(&request, Some(&foreign)).is_err());
    }

    #[test]
    fn legacy_post_migration_requires_a_matching_saved_slug_and_no_foreign_owner() {
        let mut request = owned_post_request();
        request.legacy_slug = Some("old-slug".into());
        assert!(validate_post_ownership(&request, None).is_err());
        assert!(
            validate_post_ownership(&request, Some("---\nslug: old-slug\n---\nold body")).is_ok()
        );
        assert!(validate_post_ownership(
            &request,
            Some("---\nslug: another-slug\n---\nother body")
        )
        .is_err());
        let foreign =
            "---\nmozi_blog_id: 00000000-0000-4000-8000-000000000002\nslug: old-slug\n---\nbody";
        assert!(validate_post_ownership(&request, Some(foreign)).is_err());
        assert_eq!(
            frontmatter_scalar("---\r\nslug: \"old-slug\"\r\n---\r\n", "slug").as_deref(),
            Some("old-slug")
        );
    }

    #[test]
    fn publish_resources_cannot_clean_a_shared_legacy_or_foreign_directory() {
        let mut request = owned_post_request();
        request.asset_directory_relative_path = "resource/shared-legacy".into();
        assert!(validate_post_ownership(&request, None).is_err());
        let mut request = owned_post_request();
        request.assets.push(PublishSimpleBlogAsset {
            source_path: "/tmp/image.png".into(),
            target_relative_path: "resource/other/image.png".into(),
        });
        assert!(validate_post_ownership(&request, None).is_err());
    }

    #[test]
    fn publish_requires_github_token() {
        let request = PublishSimpleBlogRequest {
            blog_repo_url: "https://github.com/Yunz93/bxyz-blog".to_string(),
            blog_github_token: None,
            post_relative_path: "posts/test-post.md".to_string(),
            asset_directory_relative_path: "resource/test-post".to_string(),
            markdown_content: "---\ntitle: test\n---\n\nbody\n".to_string(),
            assets: vec![],
            publish_id: String::new(),
            legacy_slug: None,
        };

        let error =
            tauri::async_runtime::block_on(publish_remote_simple_blog(&request)).unwrap_err();
        assert!(error.contains("GitHub token is required"));
    }

    #[test]
    fn local_path_is_rejected_as_blog_repo_url() {
        assert!(normalize_repo_target("/Users/example/projects/blog").is_err());
    }

    #[test]
    fn github_assets_are_rewritten_to_raw_urls() {
        let rewritten = rewrite_markdown_asset_urls(
            "![cover](/resource/test-post/01-cover.txt)",
            &[PublishSimpleBlogAsset {
                source_path: "/tmp/cover.txt".to_string(),
                target_relative_path: "resource/test-post/01-cover.txt".to_string(),
            }],
            "https://github.com/Yunz93/bxyz-blog",
            "main",
        )
        .unwrap();

        assert_eq!(
            rewritten,
            "![cover](https://raw.githubusercontent.com/Yunz93/bxyz-blog/main/resource/test-post/01-cover.txt)"
        );
    }
}
