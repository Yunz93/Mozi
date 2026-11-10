use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chacha20poly1305::aead::Aead;
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const SECURE_SETTINGS_FILE_NAME: &str = "secure-settings.json";
const SECURE_SETTINGS_KEY_FILE_NAME: &str = "secure-settings.key";
const SECURE_SETTINGS_VERSION: u8 = 1;
const SECRET_KEY_BLOG_GITHUB_TOKEN: &str = "blogGithubToken";
const SECRET_KEY_WECHAT_APP_SECRET: &str = "wechatAppSecret";
const SECRET_KEY_WEREAD_API_KEY: &str = "wereadApiKey";
const SECRET_KEY_GEMINI_API_KEY: &str = "geminiApiKey";
const SECRET_KEY_CODEX_API_KEY: &str = "codexApiKey";
const SECRET_KEY_DEEPSEEK_API_KEY: &str = "deepseekApiKey";
const SECRET_KEY_GLM_API_KEY: &str = "glmApiKey";
const SECRET_KEY_KIMI_API_KEY: &str = "kimiApiKey";
const SECRET_KEY_MIMO_API_KEY: &str = "mimoApiKey";
const SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN: &str = "imageHostingGithubToken";
const SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY: &str = "imageHostingS3SecretAccessKey";
const SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET: &str = "imageHostingOssAccessKeySecret";
const SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY: &str = "imageHostingQiniuSecretKey";
const SECRET_KEY_EMBEDDING_API_KEY: &str = "embeddingApiKey";
const SECRET_KEY_IMAGE_HOSTING_CUSTOM_HEADERS: &str = "imageHostingCustomHeaders";
static SECURE_SETTINGS_MUTEX: Mutex<()> = Mutex::new(());

fn with_secure_settings_process_lock<R>(
    operation: impl FnOnce() -> Result<R, String>,
) -> Result<R, String> {
    let _guard = SECURE_SETTINGS_MUTEX
        .lock()
        .map_err(|_| "安全设置锁不可用。".to_string())?;
    operation()
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecureSettingsResult {
    blog_github_token: Option<String>,
    wechat_app_secret: Option<String>,
    weread_api_key: Option<String>,
    gemini_api_key: Option<String>,
    codex_api_key: Option<String>,
    deepseek_api_key: Option<String>,
    glm_api_key: Option<String>,
    kimi_api_key: Option<String>,
    mimo_api_key: Option<String>,
    image_hosting_github_token: Option<String>,
    image_hosting_s3_secret_access_key: Option<String>,
    image_hosting_oss_access_key_secret: Option<String>,
    image_hosting_qiniu_secret_key: Option<String>,
    image_hosting_custom_headers: Option<String>,
    embedding_api_key: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecureSettingsFile {
    blog_github_token: Option<String>,
    wechat_app_secret: Option<String>,
    weread_api_key: Option<String>,
    gemini_api_key: Option<String>,
    codex_api_key: Option<String>,
    deepseek_api_key: Option<String>,
    glm_api_key: Option<String>,
    kimi_api_key: Option<String>,
    mimo_api_key: Option<String>,
    image_hosting_github_token: Option<String>,
    image_hosting_s3_secret_access_key: Option<String>,
    image_hosting_oss_access_key_secret: Option<String>,
    image_hosting_qiniu_secret_key: Option<String>,
    image_hosting_custom_headers: Option<String>,
    embedding_api_key: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedSecureSettingsFile {
    version: u8,
    nonce: String,
    ciphertext: String,
}

fn normalize_secret_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| {
        format!(
            "Failed to set permissions on secure settings file {}: {}",
            path.display(),
            e
        )
    })
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn secure_settings_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config directory: {}", e))?;

    fs::create_dir_all(&config_dir).map_err(|e| {
        format!(
            "Failed to create app config directory {}: {}",
            config_dir.display(),
            e
        )
    })?;

    Ok(config_dir.join(SECURE_SETTINGS_FILE_NAME))
}

fn secure_settings_key_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config directory: {}", e))?;

    fs::create_dir_all(&config_dir).map_err(|e| {
        format!(
            "Failed to create app config directory {}: {}",
            config_dir.display(),
            e
        )
    })?;

    Ok(config_dir.join(SECURE_SETTINGS_KEY_FILE_NAME))
}

fn secure_settings_lock_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(secure_settings_file_path(app)?.with_extension("json.lock"))
}

fn with_secure_settings_lock<R>(
    app: &tauri::AppHandle,
    operation: impl FnOnce() -> Result<R, String>,
) -> Result<R, String> {
    with_secure_settings_process_lock(|| with_secure_settings_file_lock(app, operation))
}

#[cfg(unix)]
fn with_secure_settings_file_lock<R>(
    app: &tauri::AppHandle,
    operation: impl FnOnce() -> Result<R, String>,
) -> Result<R, String> {
    use std::os::unix::io::AsRawFd;

    let lock_path = secure_settings_lock_path(app)?;
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| {
            format!(
                "Failed to open secure settings lock file {}: {}",
                lock_path.display(),
                e
            )
        })?;
    let lock_result = unsafe { libc::flock(lock_file.as_raw_fd(), libc::LOCK_EX) };
    if lock_result != 0 {
        return Err(format!(
            "Failed to lock secure settings file {}: {}",
            lock_path.display(),
            std::io::Error::last_os_error()
        ));
    }

    let result = operation();
    let _ = unsafe { libc::flock(lock_file.as_raw_fd(), libc::LOCK_UN) };
    result
}

#[cfg(not(unix))]
fn with_secure_settings_file_lock<R>(
    _app: &tauri::AppHandle,
    operation: impl FnOnce() -> Result<R, String>,
) -> Result<R, String> {
    operation()
}

fn read_secure_settings_key(path: &Path) -> Result<[u8; 32], String> {
    let encoded = fs::read_to_string(path).map_err(|e| {
        format!(
            "Failed to read secure settings key {}: {}",
            path.display(),
            e
        )
    })?;
    let decoded = BASE64_STANDARD.decode(encoded.trim()).map_err(|e| {
        format!(
            "Failed to decode secure settings key {}: {}",
            path.display(),
            e
        )
    })?;
    decoded.try_into().map_err(|_| {
        format!(
            "Secure settings key {} has invalid length; expected 32 bytes.",
            path.display()
        )
    })
}

fn load_or_create_secure_settings_key(app: &tauri::AppHandle) -> Result<[u8; 32], String> {
    let path = secure_settings_key_path(app)?;

    if path.exists() {
        return read_secure_settings_key(&path);
    }

    let mut key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    let encoded = BASE64_STANDARD.encode(key);

    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            file.write_all(encoded.as_bytes()).map_err(|e| {
                format!(
                    "Failed to write secure settings key {}: {}",
                    path.display(),
                    e
                )
            })?;
            set_private_permissions(&path)?;
            Ok(key)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            read_secure_settings_key(&path)
        }
        Err(error) => Err(format!(
            "Failed to create secure settings key {}: {}",
            path.display(),
            error
        )),
    }
}

fn encrypt_secure_settings(
    app: &tauri::AppHandle,
    settings: &SecureSettingsFile,
) -> Result<EncryptedSecureSettingsFile, String> {
    let key = load_or_create_secure_settings_key(app)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let payload = serde_json::to_vec(settings)
        .map_err(|e| format!("Failed to serialize secure settings: {}", e))?;
    let mut nonce = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), payload.as_ref())
        .map_err(|e| format!("Failed to encrypt secure settings: {}", e))?;

    Ok(EncryptedSecureSettingsFile {
        version: SECURE_SETTINGS_VERSION,
        nonce: BASE64_STANDARD.encode(nonce),
        ciphertext: BASE64_STANDARD.encode(ciphertext),
    })
}

fn decrypt_secure_settings(
    app: &tauri::AppHandle,
    encrypted: EncryptedSecureSettingsFile,
) -> Result<SecureSettingsFile, String> {
    if encrypted.version != SECURE_SETTINGS_VERSION {
        return Err(format!(
            "Unsupported secure settings version: {}",
            encrypted.version
        ));
    }

    let key = load_or_create_secure_settings_key(app)?;
    let nonce = BASE64_STANDARD
        .decode(encrypted.nonce.trim())
        .map_err(|e| format!("Failed to decode secure settings nonce: {}", e))?;
    let nonce: [u8; 24] = nonce
        .try_into()
        .map_err(|_| "Secure settings nonce has invalid length.".to_string())?;
    let ciphertext = BASE64_STANDARD
        .decode(encrypted.ciphertext.trim())
        .map_err(|e| format!("Failed to decode secure settings ciphertext: {}", e))?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let plaintext = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|e| format!("Failed to decrypt secure settings: {}", e))?;

    serde_json::from_slice(&plaintext)
        .map_err(|e| format!("Failed to parse decrypted secure settings payload: {}", e))
}

fn read_secure_settings_file(app: &tauri::AppHandle) -> Result<SecureSettingsFile, String> {
    let path = secure_settings_file_path(app)?;

    if !path.exists() {
        return Ok(SecureSettingsFile::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| {
        format!(
            "Failed to read secure settings file {}: {}",
            path.display(),
            e
        )
    })?;

    if content.trim().is_empty() {
        return Ok(SecureSettingsFile::default());
    }

    if let Ok(encrypted) = serde_json::from_str::<EncryptedSecureSettingsFile>(&content) {
        return decrypt_secure_settings(app, encrypted);
    }

    if let Ok(plaintext) = serde_json::from_str::<SecureSettingsFile>(&content) {
        // 首次读到旧版明文配置时，立即迁移为加密格式。
        write_secure_settings_file(app, &plaintext)?;
        return Ok(plaintext);
    }

    Err(format!(
        "Failed to parse secure settings file {} as encrypted or plaintext JSON.",
        path.display()
    ))
}

fn write_secure_settings_file(
    app: &tauri::AppHandle,
    settings: &SecureSettingsFile,
) -> Result<(), String> {
    let path = secure_settings_file_path(app)?;
    let has_secrets = settings.blog_github_token.is_some()
        || settings.wechat_app_secret.is_some()
        || settings.weread_api_key.is_some()
        || settings.gemini_api_key.is_some()
        || settings.codex_api_key.is_some()
        || settings.deepseek_api_key.is_some()
        || settings.glm_api_key.is_some()
        || settings.kimi_api_key.is_some()
        || settings.mimo_api_key.is_some()
        || settings.image_hosting_github_token.is_some()
        || settings.image_hosting_s3_secret_access_key.is_some()
        || settings.image_hosting_oss_access_key_secret.is_some()
        || settings.image_hosting_qiniu_secret_key.is_some()
        || settings.embedding_api_key.is_some()
        || settings.image_hosting_custom_headers.is_some();

    if !has_secrets {
        match fs::remove_file(&path) {
            Ok(()) => return Ok(()),
            Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => {
                return Err(format!(
                    "Failed to remove secure settings file {}: {}",
                    path.display(),
                    e
                ))
            }
        }
    }

    let encrypted = encrypt_secure_settings(app, settings)?;
    let serialized = serde_json::to_vec_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize encrypted secure settings: {}", e))?;
    write_secure_settings_bytes_at(&path, &serialized)
}

fn write_secure_settings_bytes_at(path: &Path, serialized: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
    let mut created = false;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| format!("创建安全设置临时文件失败: {error}"))?;
        created = true;
        // 先设置私有权限，再写入内容；失败时保留原文件。
        set_private_permissions(&temp_path)?;
        file.write_all(serialized)
            .map_err(|error| format!("写入安全设置失败: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("刷新安全设置失败: {error}"))?;
        drop(file);
        fs::rename(&temp_path, path).map_err(|error| format!("替换安全设置失败: {error}"))
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn read_secure_secret(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    with_secure_settings_lock(app, || {
        let settings = read_secure_settings_file(app)?;
        Ok(match key {
            SECRET_KEY_BLOG_GITHUB_TOKEN => settings.blog_github_token,
            SECRET_KEY_WECHAT_APP_SECRET => settings.wechat_app_secret,
            SECRET_KEY_WEREAD_API_KEY => settings.weread_api_key,
            SECRET_KEY_GEMINI_API_KEY => settings.gemini_api_key,
            SECRET_KEY_CODEX_API_KEY => settings.codex_api_key,
            SECRET_KEY_DEEPSEEK_API_KEY => settings.deepseek_api_key,
            SECRET_KEY_GLM_API_KEY => settings.glm_api_key,
            SECRET_KEY_KIMI_API_KEY => settings.kimi_api_key,
            SECRET_KEY_MIMO_API_KEY => settings.mimo_api_key,
            SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN => settings.image_hosting_github_token,
            SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY => {
                settings.image_hosting_s3_secret_access_key
            }
            SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET => {
                settings.image_hosting_oss_access_key_secret
            }
            SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY => settings.image_hosting_qiniu_secret_key,
            SECRET_KEY_EMBEDDING_API_KEY => settings.embedding_api_key,
            SECRET_KEY_IMAGE_HOSTING_CUSTOM_HEADERS => settings.image_hosting_custom_headers,
            _ => None,
        })
    })
}

fn write_secure_secret(
    app: &tauri::AppHandle,
    key: &str,
    value: Option<&str>,
) -> Result<(), String> {
    with_secure_settings_lock(app, || {
        let mut settings = read_secure_settings_file(app)?;
        let normalized = normalize_secret_value(value);

        match key {
            SECRET_KEY_BLOG_GITHUB_TOKEN => settings.blog_github_token = normalized,
            SECRET_KEY_WECHAT_APP_SECRET => settings.wechat_app_secret = normalized,
            SECRET_KEY_WEREAD_API_KEY => settings.weread_api_key = normalized,
            SECRET_KEY_GEMINI_API_KEY => settings.gemini_api_key = normalized,
            SECRET_KEY_CODEX_API_KEY => settings.codex_api_key = normalized,
            SECRET_KEY_DEEPSEEK_API_KEY => settings.deepseek_api_key = normalized,
            SECRET_KEY_GLM_API_KEY => settings.glm_api_key = normalized,
            SECRET_KEY_KIMI_API_KEY => settings.kimi_api_key = normalized,
            SECRET_KEY_MIMO_API_KEY => settings.mimo_api_key = normalized,
            SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN => {
                settings.image_hosting_github_token = normalized
            }
            SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY => {
                settings.image_hosting_s3_secret_access_key = normalized
            }
            SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET => {
                settings.image_hosting_oss_access_key_secret = normalized
            }
            SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY => {
                settings.image_hosting_qiniu_secret_key = normalized
            }
            SECRET_KEY_EMBEDDING_API_KEY => settings.embedding_api_key = normalized,
            SECRET_KEY_IMAGE_HOSTING_CUSTOM_HEADERS => {
                settings.image_hosting_custom_headers = normalized
            }
            _ => return Err(format!("Unsupported secure setting key: {}", key)),
        }

        write_secure_settings_file(app, &settings)
    })
}

fn resolve_secret_key(key: &str) -> Option<&'static str> {
    match key {
        SECRET_KEY_BLOG_GITHUB_TOKEN => Some(SECRET_KEY_BLOG_GITHUB_TOKEN),
        SECRET_KEY_WECHAT_APP_SECRET => Some(SECRET_KEY_WECHAT_APP_SECRET),
        SECRET_KEY_WEREAD_API_KEY => Some(SECRET_KEY_WEREAD_API_KEY),
        SECRET_KEY_GEMINI_API_KEY => Some(SECRET_KEY_GEMINI_API_KEY),
        SECRET_KEY_CODEX_API_KEY => Some(SECRET_KEY_CODEX_API_KEY),
        SECRET_KEY_DEEPSEEK_API_KEY => Some(SECRET_KEY_DEEPSEEK_API_KEY),
        SECRET_KEY_GLM_API_KEY => Some(SECRET_KEY_GLM_API_KEY),
        SECRET_KEY_KIMI_API_KEY => Some(SECRET_KEY_KIMI_API_KEY),
        SECRET_KEY_MIMO_API_KEY => Some(SECRET_KEY_MIMO_API_KEY),
        SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN => Some(SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN),
        SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY => {
            Some(SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY)
        }
        SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET => {
            Some(SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET)
        }
        SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY => {
            Some(SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY)
        }
        SECRET_KEY_EMBEDDING_API_KEY => Some(SECRET_KEY_EMBEDDING_API_KEY),
        SECRET_KEY_IMAGE_HOSTING_CUSTOM_HEADERS => Some(SECRET_KEY_IMAGE_HOSTING_CUSTOM_HEADERS),
        _ => None,
    }
}

/// Must stay `async`: reads take an exclusive file lock and do disk I/O; on
/// the main thread that freezes input handling for every window.
#[tauri::command]
pub(crate) async fn get_secure_settings(
    app: tauri::AppHandle,
) -> Result<SecureSettingsResult, String> {
    tauri::async_runtime::spawn_blocking(move || get_secure_settings_blocking(&app))
        .await
        .map_err(|e| format!("Failed to join secure settings read task: {}", e))?
}

fn get_secure_settings_blocking(app: &tauri::AppHandle) -> Result<SecureSettingsResult, String> {
    with_secure_settings_lock(app, || {
        let settings = read_secure_settings_file(app)?;
        Ok(SecureSettingsResult {
            blog_github_token: settings.blog_github_token,
            wechat_app_secret: settings.wechat_app_secret,
            weread_api_key: settings.weread_api_key,
            gemini_api_key: settings.gemini_api_key,
            codex_api_key: settings.codex_api_key,
            deepseek_api_key: settings.deepseek_api_key,
            glm_api_key: settings.glm_api_key,
            kimi_api_key: settings.kimi_api_key,
            mimo_api_key: settings.mimo_api_key,
            image_hosting_github_token: settings.image_hosting_github_token,
            image_hosting_s3_secret_access_key: settings.image_hosting_s3_secret_access_key,
            image_hosting_oss_access_key_secret: settings.image_hosting_oss_access_key_secret,
            image_hosting_qiniu_secret_key: settings.image_hosting_qiniu_secret_key,
            image_hosting_custom_headers: settings.image_hosting_custom_headers,
            embedding_api_key: settings.embedding_api_key,
        })
    })
}

/// Must stay `async`: writes take an exclusive file lock and do disk I/O; on
/// the main thread that freezes input handling for every window.
#[tauri::command]
pub(crate) async fn set_secure_secret(
    app: tauri::AppHandle,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(secret_key) = resolve_secret_key(&key) else {
            return Err(format!("Unsupported secure setting key: {}", key));
        };

        write_secure_secret(&app, secret_key, value.as_deref())
    })
    .await
    .map_err(|e| format!("Failed to join secure settings write task: {}", e))?
}

pub(crate) fn read_weread_api_key(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    read_secure_secret(app, SECRET_KEY_WEREAD_API_KEY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_operations_are_serialized_across_threads_on_every_platform() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Barrier,
        };
        let start = Arc::new(Barrier::new(8));
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let start = start.clone();
                let active = active.clone();
                let maximum = maximum.clone();
                scope.spawn(move || {
                    start.wait();
                    with_secure_settings_process_lock(|| {
                        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                        maximum.fetch_max(count, Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(20));
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    })
                    .unwrap();
                });
            }
        });
        assert_eq!(maximum.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unique_temp_files_ignore_old_temp_and_preserve_failed_targets() {
        let directory = std::env::temp_dir().join(format!(
            "mozi-secure-settings-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("secure-settings.json");
        let old_temp = directory.join("secure-settings.json.tmp");
        fs::write(&old_temp, b"do not overwrite old temporary files").unwrap();
        fs::write(&path, b"previous").unwrap();
        write_secure_settings_bytes_at(&path, b"replacement").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(
            fs::read(&old_temp).unwrap(),
            b"do not overwrite old temporary files"
        );
        let directory_target = directory.join("directory-target");
        fs::create_dir(&directory_target).unwrap();
        fs::write(directory_target.join("original"), b"preserved").unwrap();
        assert!(
            write_secure_settings_bytes_at(&directory_target, b"cannot replace directory").is_err()
        );
        assert_eq!(
            fs::read(directory_target.join("original")).unwrap(),
            b"preserved"
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 3);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn custom_image_headers_are_supported_by_encrypted_secret_schema() {
        assert_eq!(
            resolve_secret_key("imageHostingCustomHeaders"),
            Some(SECRET_KEY_IMAGE_HOSTING_CUSTOM_HEADERS)
        );
        let mut settings = SecureSettingsFile::default();
        settings.image_hosting_custom_headers = Some("{\"Authorization\":\"Bearer demo\"}".into());
        let encoded = serde_json::to_value(&settings).unwrap();
        assert_eq!(
            encoded["imageHostingCustomHeaders"],
            "{\"Authorization\":\"Bearer demo\"}"
        );
    }

    #[test]
    fn resolve_secret_key_accepts_weread_api_key() {
        assert_eq!(
            resolve_secret_key(SECRET_KEY_WEREAD_API_KEY),
            Some(SECRET_KEY_WEREAD_API_KEY)
        );
    }

    #[test]
    fn new_ai_provider_secrets_are_allowed_and_survive_legacy_settings() {
        for key in ["glmApiKey", "kimiApiKey", "mimoApiKey"] {
            assert_eq!(resolve_secret_key(key), Some(key));
        }
        // 旧配置缺少新增字段时，仍能读取并保留原供应商密钥。
        let legacy: SecureSettingsFile =
            serde_json::from_str(r#"{"deepseekApiKey":"old-secret"}"#).unwrap();
        assert_eq!(legacy.deepseek_api_key.as_deref(), Some("old-secret"));
        assert!(legacy.glm_api_key.is_none());
        let current: SecureSettingsFile = serde_json::from_str(
            r#"{"glmApiKey":"glm-secret","kimiApiKey":"kimi-secret","mimoApiKey":"mimo-secret"}"#,
        )
        .unwrap();
        let encoded = serde_json::to_value(current).unwrap();
        assert_eq!(encoded["glmApiKey"], "glm-secret");
        assert_eq!(encoded["kimiApiKey"], "kimi-secret");
        assert_eq!(encoded["mimoApiKey"], "mimo-secret");
    }

    #[test]
    fn resolve_secret_key_accepts_embedding_api_key() {
        assert_eq!(
            resolve_secret_key(SECRET_KEY_EMBEDDING_API_KEY),
            Some(SECRET_KEY_EMBEDDING_API_KEY)
        );
    }

    #[test]
    fn embedding_api_key_set_then_get_reads_back() {
        let mut settings = SecureSettingsFile::default();
        settings.embedding_api_key = normalize_secret_value(Some("sk-embed-test"));
        let json = serde_json::to_string(&settings).expect("serialize");
        let parsed: SecureSettingsFile = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.embedding_api_key.as_deref(), Some("sk-embed-test"));
        assert!(parsed.embedding_api_key.is_some());
    }
}
