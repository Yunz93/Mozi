use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Manager;

const DEFAULT_SKILL_URL: &str =
    "https://raw.githubusercontent.com/Tencent/WeChatReading/main/skills/SKILL.md";
const BUNDLED_SKILL: &str = include_str!("../resources/weread-skill/SKILL.md");
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;
const MAX_SKILL_FILES: usize = 32;
const MAX_SKILL_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug)]
struct SkillBundle {
    version: String,
    files: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct InstalledSkill {
    directory: String,
    version: String,
    files: Vec<String>,
}

fn version_numbers(version: &str) -> Result<Vec<u64>, String> {
    let parts = version.split('.').collect::<Vec<_>>();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Invalid WeRead Skill version.".to_string());
    }
    parts
        .iter()
        .map(|part| {
            part.parse::<u64>()
                .map_err(|_| "Invalid WeRead Skill version.".to_string())
        })
        .collect()
}

fn skill_version(document: &str) -> Result<String, String> {
    let mut lines = document.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim) != Some("---") {
        return Err("WeRead SKILL.md is missing its metadata.".to_string());
    }
    let mut version = None;
    let mut name = None;
    let mut closed = false;
    for line in lines {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim().trim_matches(['\'', '"']);
            match key.trim() {
                "version" => version = Some(value.to_string()),
                "name" => name = Some(value.to_string()),
                _ => {}
            }
        }
    }
    if !closed || name.as_deref() != Some("weread-skills") {
        return Err("Invalid WeRead SKILL.md metadata.".to_string());
    }
    let version = version.ok_or("WeRead SKILL.md is missing its version.")?;
    version_numbers(&version)?;
    Ok(version)
}

fn valid_document_path(path: &str) -> bool {
    path.ends_with(".md")
        && path.len() <= 200
        && path.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn referenced_documents(document: &str) -> Result<BTreeSet<String>, String> {
    // 官方文档同时使用反引号文件名和 Markdown 链接，递归收集两种写法。
    let code_refs = document
        .split('`')
        .enumerate()
        .filter_map(|(index, text)| (index % 2 == 1).then_some(text));
    let link_refs = document
        .split("](")
        .skip(1)
        .filter_map(|text| text.split(')').next());
    let mut paths = BTreeSet::new();
    for raw in code_refs.chain(link_refs) {
        let path = raw.split('#').next().unwrap_or("").trim();
        if !path.ends_with(".md") || path.contains("://") || path.contains(char::is_whitespace) {
            continue;
        }
        let path = path.strip_prefix("./").unwrap_or(path);
        if !valid_document_path(path) {
            return Err("Unsafe WeRead Skill document path.".to_string());
        }
        paths.insert(path.to_string());
    }
    Ok(paths)
}

fn skill_download_url(upgrade_url: Option<&str>) -> Result<reqwest::Url, String> {
    let raw = upgrade_url
        .filter(|url| !url.trim().is_empty())
        .unwrap_or(DEFAULT_SKILL_URL);
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "Invalid WeRead Skill upgrade URL.")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return Err("WeRead Skill upgrade URL must be an official HTTPS URL.".to_string());
    }
    let path = url.path().trim_matches('/');
    let parts = path.split('/').collect::<Vec<_>>();
    let raw_path = match url.host_str() {
        Some("weread.qq.com") if path == "r/weread-skills" => {
            return reqwest::Url::parse(DEFAULT_SKILL_URL).map_err(|error| error.to_string());
        }
        Some("github.com") if parts.starts_with(&["Tencent", "WeChatReading"]) => {
            if parts.len() == 2 {
                "Tencent/WeChatReading/main/skills/SKILL.md".to_string()
            } else if parts.len() >= 4 && matches!(parts[2], "tree" | "blob" | "raw") {
                format!("Tencent/WeChatReading/{}", parts[3..].join("/"))
            } else {
                return Err("Unsupported WeRead Skill upgrade URL.".to_string());
            }
        }
        Some("raw.githubusercontent.com") => path.to_string(),
        _ => return Err("WeRead Skill upgrade URL must use Tencent/WeChatReading.".to_string()),
    };
    let raw_path = if raw_path.ends_with("/skills") {
        format!("{raw_path}/SKILL.md")
    } else {
        raw_path
    };
    let parts = raw_path.split('/').collect::<Vec<_>>();
    if parts.len() != 5
        || parts[..2] != ["Tencent", "WeChatReading"]
        || parts[3..] != ["skills", "SKILL.md"]
        || !parts[2]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        || parts[2].is_empty()
        || parts[2] == "."
        || parts[2] == ".."
    {
        return Err("Unsupported WeRead Skill document URL.".to_string());
    }
    reqwest::Url::parse(&format!("https://raw.githubusercontent.com/{raw_path}"))
        .map_err(|error| error.to_string())
}

async fn download_bundle<F, Fut>(
    upgrade_url: Option<&str>,
    mut fetch: F,
) -> Result<SkillBundle, String>
where
    F: FnMut(reqwest::Url) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let main_url = skill_download_url(upgrade_url)?;
    let base = main_url.join("./").map_err(|error| error.to_string())?;
    let mut queue = VecDeque::from(["SKILL.md".to_string()]);
    let mut files = BTreeMap::new();
    let mut total_bytes = 0;
    while let Some(path) = queue.pop_front() {
        if files.contains_key(&path) {
            continue;
        }
        if files.len() >= MAX_SKILL_FILES {
            return Err("WeRead Skill contains too many documents.".to_string());
        }
        let url = base.join(&path).map_err(|error| error.to_string())?;
        let text = fetch(url).await?;
        total_bytes += text.len();
        if text.trim().is_empty()
            || text.trim_start().starts_with('<')
            || text.len() > MAX_DOCUMENT_BYTES
            || total_bytes > MAX_SKILL_BYTES
        {
            return Err("Invalid or oversized WeRead Skill document.".to_string());
        }
        let parent = Path::new(&path).parent().unwrap_or(Path::new(""));
        for child in referenced_documents(&text)? {
            let child = parent.join(child).to_string_lossy().replace('\\', "/");
            if !valid_document_path(&child) {
                return Err("Unsafe WeRead Skill document path.".to_string());
            }
            queue.push_back(child);
        }
        files.insert(path, text);
    }
    let version = skill_version(files.get("SKILL.md").ok_or("Missing WeRead SKILL.md.")?)?;
    Ok(SkillBundle { version, files })
}

fn install_bundle(root: &Path, bundle: &SkillBundle) -> Result<(), String> {
    let directory = uuid::Uuid::new_v4().to_string();
    let destination = root.join(&directory);
    for (name, text) in &bundle.files {
        let path = destination.join(name);
        fs::create_dir_all(path.parent().ok_or("Invalid WeRead Skill path.")?)
            .map_err(|error| format!("Failed to create WeRead Skill directory: {error}"))?;
        fs::write(&path, text)
            .map_err(|error| format!("Failed to write WeRead Skill document: {error}"))?;
    }
    let installed = InstalledSkill {
        directory,
        version: bundle.version.clone(),
        files: bundle.files.keys().cloned().collect(),
    };
    // 全部文件落盘后才切换当前版本；下载或写入中断不会覆盖仍可用的旧版本。
    crate::write_text_file_atomic_at(
        &root.join("current.json"),
        &serde_json::to_string(&installed).map_err(|error| error.to_string())?,
    )
}

fn installed_version(root: &Path) -> Option<String> {
    let manifest: InstalledSkill =
        serde_json::from_str(&fs::read_to_string(root.join("current.json")).ok()?).ok()?;
    uuid::Uuid::parse_str(&manifest.directory).ok()?;
    if manifest.files.len() > MAX_SKILL_FILES
        || !manifest.files.iter().any(|name| name == "SKILL.md")
    {
        return None;
    }
    let mut total_bytes = 0;
    for name in &manifest.files {
        if !valid_document_path(name) {
            return None;
        }
        let text = fs::read_to_string(root.join(&manifest.directory).join(name)).ok()?;
        total_bytes += text.len();
        if text.trim().is_empty()
            || text.len() > MAX_DOCUMENT_BYTES
            || total_bytes > MAX_SKILL_BYTES
        {
            return None;
        }
        if name == "SKILL.md" && skill_version(&text).ok()? != manifest.version {
            return None;
        }
        let parent = Path::new(name).parent().unwrap_or(Path::new(""));
        for child in referenced_documents(&text).ok()? {
            let child = parent.join(child).to_string_lossy().replace('\\', "/");
            if !manifest.files.contains(&child) {
                return None;
            }
        }
    }
    Some(manifest.version)
}

pub(crate) fn current_version(root: &Path) -> String {
    let bundled = skill_version(BUNDLED_SKILL).expect("bundled WeRead Skill metadata");
    installed_version(root)
        .filter(|version| version_numbers(version).ok() >= version_numbers(&bundled).ok())
        .unwrap_or(bundled)
}

pub(crate) fn cache_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("weread-skill"))
        .map_err(|error| format!("Failed to resolve WeRead Skill directory: {error}"))
}

pub(crate) async fn update_skill(
    root: &Path,
    upgrade_url: Option<&str>,
    requested_version: Option<&str>,
) -> Result<String, String> {
    static UPDATE_LOCK: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
    let _guard = UPDATE_LOCK
        .get_or_init(|| tauri::async_runtime::Mutex::new(()))
        .lock()
        .await;
    let current = current_version(root);
    // 并行请求只下载一次，其余请求复用已经成功启用的新版本。
    if requested_version.is_some_and(|version| version != current) {
        return Ok(current);
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("markdown-press")
        .build()
        .map_err(|error| {
            format!(
                "Failed to create WeRead Skill client: {}",
                error.without_url()
            )
        })?;
    let bundle = download_bundle(upgrade_url, |url| {
        let client = &client;
        async move {
            // Skill 下载不携带 API Key，也不跟随重定向到其它来源。
            let mut response = client.get(url).send().await.map_err(|error| {
                format!("Failed to download WeRead Skill: {}", error.without_url())
            })?;
            if !response.status().is_success() {
                return Err(format!(
                    "Failed to download WeRead Skill: HTTP {}",
                    response.status()
                ));
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_DOCUMENT_BYTES as u64)
            {
                return Err("WeRead Skill document is too large.".to_string());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| error.without_url().to_string())?
            {
                if bytes.len() + chunk.len() > MAX_DOCUMENT_BYTES {
                    return Err("WeRead Skill document is too large.".to_string());
                }
                bytes.extend_from_slice(&chunk);
            }
            String::from_utf8(bytes).map_err(|_| "WeRead Skill document is not UTF-8.".to_string())
        }
    })
    .await?;
    let downloaded = version_numbers(&bundle.version)?;
    let existing = version_numbers(&current)?;
    if downloaded < existing || (requested_version.is_some() && downloaded == existing) {
        return Err("WeRead Skill download did not provide a newer version.".to_string());
    }
    install_bundle(root, &bundle)?;
    Ok(bundle.version)
}

#[tauri::command]
pub(crate) async fn weread_update_skill(app: tauri::AppHandle) -> Result<String, String> {
    update_skill(&cache_directory(&app)?, None, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_directory() -> PathBuf {
        std::env::temp_dir().join(format!("weread-skill-test-{}", uuid::Uuid::new_v4()))
    }

    fn fixture(version: &str) -> SkillBundle {
        SkillBundle {
            version: version.to_string(),
            files: BTreeMap::from([
                (
                    "SKILL.md".to_string(),
                    format!(
                        "---\nname: weread-skills\nversion: {version}\n---\n# WeRead\n`notes.md`"
                    ),
                ),
                ("notes.md".to_string(), "# 笔记\n划线和书评".to_string()),
            ]),
        }
    }

    #[test]
    fn bundled_skill_includes_the_complete_official_document_set() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/weread-skill");
        let bundle = tauri::async_runtime::block_on(download_bundle(None, |url| {
            std::future::ready(
                fs::read_to_string(root.join(url.path_segments().unwrap().last().unwrap()))
                    .map_err(|error| error.to_string()),
            )
        }))
        .expect("complete bundled Skill");
        assert_eq!(bundle.version, "1.0.5");
        assert_eq!(bundle.files.len(), 8);
        assert!(bundle.files.contains_key("notes.md"));
        assert!(bundle.files.contains_key("review.md"));
        assert_eq!(current_version(&temporary_directory()), bundle.version);
    }

    #[test]
    fn skill_urls_accept_only_the_official_repository() {
        for url in [
            "https://github.com/Tencent/WeChatReading",
            "https://github.com/Tencent/WeChatReading/tree/main/skills",
            "https://github.com/Tencent/WeChatReading/blob/main/skills/SKILL.md",
            "https://weread.qq.com/r/weread-skills",
            DEFAULT_SKILL_URL,
        ] {
            assert_eq!(
                skill_download_url(Some(url)).unwrap().as_str(),
                DEFAULT_SKILL_URL
            );
        }
        for url in [
            "http://github.com/Tencent/WeChatReading",
            "https://127.0.0.1/skills/SKILL.md",
            "https://github.com.evil.test/Tencent/WeChatReading",
            "https://raw.githubusercontent.com/other/WeChatReading/main/skills/SKILL.md",
            "https://user:password@github.com/Tencent/WeChatReading",
            "https://github.com:444/Tencent/WeChatReading",
            "https://raw.githubusercontent.com/Tencent/WeChatReading/main/skills/%2e%2e/SKILL.md",
        ] {
            assert!(skill_download_url(Some(url)).is_err(), "{url}");
        }
    }

    #[test]
    fn skill_metadata_and_paths_reject_invalid_documents() {
        for document in [
            "<html>not a Skill</html>",
            "---\nname: other-skill\nversion: 1.0.6\n---",
            "---\nname: weread-skills\nversion: ../1.0.6\n---",
            "---\nname: weread-skills\nversion: 1.0.6",
        ] {
            assert!(skill_version(document).is_err());
        }
        assert!(referenced_documents("`../outside.md`").is_err());
        assert!(referenced_documents("[文档](/outside.md)").is_err());
        assert_eq!(
            referenced_documents("`notes.md` [书评](review.md#reviews)").unwrap(),
            BTreeSet::from(["notes.md".to_string(), "review.md".to_string()])
        );
    }

    #[test]
    fn recursive_download_failure_preserves_the_previously_installed_skill() {
        let root = temporary_directory();
        install_bundle(&root, &fixture("1.0.5")).expect("initial install");
        let original = fs::read(root.join("current.json")).unwrap();
        let mut fetched = Vec::new();
        let result = tauri::async_runtime::block_on(download_bundle(None, |url| {
            let name = url.path_segments().unwrap().last().unwrap();
            fetched.push(name.to_string());
            std::future::ready(match name {
                "SKILL.md" => Ok(fixture("1.0.6").files["SKILL.md"].clone()),
                "notes.md" => Ok("# 笔记\n[书评](review.md)".to_string()),
                _ => Err("download interrupted".to_string()),
            })
        }));
        assert_eq!(fetched, ["SKILL.md", "notes.md", "review.md"]);
        assert!(result.unwrap_err().contains("download interrupted"));
        assert_eq!(fs::read(root.join("current.json")).unwrap(), original);
        assert_eq!(current_version(&root), "1.0.5");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_skill_survives_reload_and_corrupt_cache_falls_back_to_bundle() {
        let root = temporary_directory();
        install_bundle(&root, &fixture("1.0.6")).expect("install");
        assert_eq!(current_version(&root), "1.0.6");
        let manifest: InstalledSkill =
            serde_json::from_str(&fs::read_to_string(root.join("current.json")).unwrap()).unwrap();
        fs::write(root.join(manifest.directory).join("notes.md"), "").unwrap();
        assert_eq!(current_version(&root), "1.0.5");
        install_bundle(&root, &fixture("1.0.4")).expect("older cache");
        assert_eq!(current_version(&root), "1.0.5");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn another_request_reuses_the_update_completed_while_it_was_waiting() {
        let root = temporary_directory();
        install_bundle(&root, &fixture("1.0.6")).unwrap();
        let version =
            tauri::async_runtime::block_on(update_skill(&root, Some("invalid URL"), Some("1.0.5")))
                .expect("reuse installed version without downloading");
        assert_eq!(version, "1.0.6");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn downloads_reject_html_oversized_files_and_path_traversal() {
        for document in [
            "<html>download failed</html>".to_string(),
            "x".repeat(MAX_DOCUMENT_BYTES + 1),
            "# Skill\n`../escape.md`".to_string(),
        ] {
            assert!(tauri::async_runtime::block_on(download_bundle(None, |_| {
                std::future::ready(Ok(document.clone()))
            }))
            .is_err());
        }
    }
}
