use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chacha20poly1305::aead::Aead;
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SECURE_SETTINGS_FILE_NAME: &str = "secure-settings.json";
const SECURE_SETTINGS_KEY_FILE_NAME: &str = "secure-settings.key";
const SECURE_SETTINGS_VERSION: u8 = 1;
const SECRET_KEY_BLOG_GITHUB_TOKEN: &str = "blogGithubToken";
const SECRET_KEY_WECHAT_APP_SECRET: &str = "wechatAppSecret";
const SECRET_KEY_GEMINI_API_KEY: &str = "geminiApiKey";
const SECRET_KEY_CODEX_API_KEY: &str = "codexApiKey";
const SECRET_KEY_DEEPSEEK_API_KEY: &str = "deepseekApiKey";
const SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN: &str = "imageHostingGithubToken";
const SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY: &str = "imageHostingS3SecretAccessKey";
const SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET: &str = "imageHostingOssAccessKeySecret";
const SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY: &str = "imageHostingQiniuSecretKey";

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecureSettingsResult {
    blog_github_token: Option<String>,
    wechat_app_secret: Option<String>,
    gemini_api_key: Option<String>,
    codex_api_key: Option<String>,
    deepseek_api_key: Option<String>,
    image_hosting_github_token: Option<String>,
    image_hosting_s3_secret_access_key: Option<String>,
    image_hosting_oss_access_key_secret: Option<String>,
    image_hosting_qiniu_secret_key: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecureSettingsFile {
    blog_github_token: Option<String>,
    wechat_app_secret: Option<String>,
    gemini_api_key: Option<String>,
    codex_api_key: Option<String>,
    deepseek_api_key: Option<String>,
    image_hosting_github_token: Option<String>,
    image_hosting_s3_secret_access_key: Option<String>,
    image_hosting_oss_access_key_secret: Option<String>,
    image_hosting_qiniu_secret_key: Option<String>,
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

#[cfg(unix)]
fn with_secure_settings_lock<R>(
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
fn with_secure_settings_lock<R>(
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

    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
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
        || settings.gemini_api_key.is_some()
        || settings.codex_api_key.is_some()
        || settings.deepseek_api_key.is_some()
        || settings.image_hosting_github_token.is_some()
        || settings.image_hosting_s3_secret_access_key.is_some()
        || settings.image_hosting_oss_access_key_secret.is_some()
        || settings.image_hosting_qiniu_secret_key.is_some();

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
    let temp_path = path.with_extension("json.tmp");

    fs::write(&temp_path, serialized).map_err(|e| {
        format!(
            "Failed to write secure settings temp file {}: {}",
            temp_path.display(),
            e
        )
    })?;

    set_private_permissions(&temp_path)?;

    fs::rename(&temp_path, &path).map_err(|e| {
        format!(
            "Failed to replace secure settings file {}: {}",
            path.display(),
            e
        )
    })
}

fn read_secure_secret(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    let settings = read_secure_settings_file(app)?;
    Ok(match key {
        SECRET_KEY_BLOG_GITHUB_TOKEN => settings.blog_github_token,
        SECRET_KEY_WECHAT_APP_SECRET => settings.wechat_app_secret,
        SECRET_KEY_GEMINI_API_KEY => settings.gemini_api_key,
        SECRET_KEY_CODEX_API_KEY => settings.codex_api_key,
        SECRET_KEY_DEEPSEEK_API_KEY => settings.deepseek_api_key,
        SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN => settings.image_hosting_github_token,
        SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY => {
            settings.image_hosting_s3_secret_access_key
        }
        SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET => {
            settings.image_hosting_oss_access_key_secret
        }
        SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY => settings.image_hosting_qiniu_secret_key,
        _ => None,
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
            SECRET_KEY_GEMINI_API_KEY => settings.gemini_api_key = normalized,
            SECRET_KEY_CODEX_API_KEY => settings.codex_api_key = normalized,
            SECRET_KEY_DEEPSEEK_API_KEY => settings.deepseek_api_key = normalized,
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
            _ => return Err(format!("Unsupported secure setting key: {}", key)),
        }

        write_secure_settings_file(app, &settings)
    })
}

fn resolve_secret_key(key: &str) -> Option<&'static str> {
    match key {
        SECRET_KEY_BLOG_GITHUB_TOKEN => Some(SECRET_KEY_BLOG_GITHUB_TOKEN),
        SECRET_KEY_WECHAT_APP_SECRET => Some(SECRET_KEY_WECHAT_APP_SECRET),
        SECRET_KEY_GEMINI_API_KEY => Some(SECRET_KEY_GEMINI_API_KEY),
        SECRET_KEY_CODEX_API_KEY => Some(SECRET_KEY_CODEX_API_KEY),
        SECRET_KEY_DEEPSEEK_API_KEY => Some(SECRET_KEY_DEEPSEEK_API_KEY),
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
    Ok(SecureSettingsResult {
        blog_github_token: read_secure_secret(&app, SECRET_KEY_BLOG_GITHUB_TOKEN)?,
        wechat_app_secret: read_secure_secret(&app, SECRET_KEY_WECHAT_APP_SECRET)?,
        gemini_api_key: read_secure_secret(&app, SECRET_KEY_GEMINI_API_KEY)?,
        codex_api_key: read_secure_secret(&app, SECRET_KEY_CODEX_API_KEY)?,
        deepseek_api_key: read_secure_secret(&app, SECRET_KEY_DEEPSEEK_API_KEY)?,
        image_hosting_github_token: read_secure_secret(
            &app,
            SECRET_KEY_IMAGE_HOSTING_GITHUB_TOKEN,
        )?,
        image_hosting_s3_secret_access_key: read_secure_secret(
            &app,
            SECRET_KEY_IMAGE_HOSTING_S3_SECRET_ACCESS_KEY,
        )?,
        image_hosting_oss_access_key_secret: read_secure_secret(
            &app,
            SECRET_KEY_IMAGE_HOSTING_OSS_ACCESS_KEY_SECRET,
        )?,
        image_hosting_qiniu_secret_key: read_secure_secret(
            &app,
            SECRET_KEY_IMAGE_HOSTING_QINIU_SECRET_KEY,
        )?,
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
