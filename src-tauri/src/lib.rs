mod image_hosting;
mod macos_update;
mod native_new_window;
mod publishing;
mod sample_notes;
mod secure_settings;
mod system_fonts;
mod url_encode;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use sample_notes::{CopySampleNotesResult, SAMPLE_NOTES_FOLDER_NAME};
use secure_settings::{get_secure_settings, set_secure_secret};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(Debug, Clone)]
struct AllowedPathEntry {
    path: PathBuf,
    recursive: bool,
}

#[derive(Debug, Default)]
struct SecurityState {
    allowed_paths: Mutex<Vec<AllowedPathEntry>>,
}

#[derive(Debug, Default)]
struct OpenedFilesState {
    paths: Mutex<Vec<String>>,
}

fn canonicalize_existing_path(path: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("Failed to resolve path {}: {}", path, e))
}

fn canonicalize_scope_path(path: &str) -> Result<PathBuf, String> {
    match fs::canonicalize(path) {
        Ok(canonical) => Ok(canonical),
        Err(_) => {
            let candidate = PathBuf::from(path);
            let parent = candidate.parent().ok_or_else(|| {
                format!("Failed to resolve path {}: missing parent directory", path)
            })?;
            let canonical_parent = fs::canonicalize(parent)
                .map_err(|e| format!("Failed to resolve path {}: {}", path, e))?;
            let file_name = candidate.file_name().ok_or_else(|| {
                format!(
                    "Failed to resolve path {}: missing final path segment",
                    path
                )
            })?;
            Ok(canonical_parent.join(file_name))
        }
    }
}

fn is_path_allowed(state: &SecurityState, path: &Path) -> Result<bool, String> {
    let allowed_paths = state
        .allowed_paths
        .lock()
        .map_err(|_| "Failed to acquire security state lock.".to_string())?;

    Ok(allowed_paths.iter().any(|entry| {
        if entry.recursive {
            path == entry.path || path.starts_with(&entry.path)
        } else {
            path == entry.path
        }
    }))
}

fn ensure_path_allowed(state: &SecurityState, path: &Path) -> Result<(), String> {
    if is_path_allowed(state, path)? {
        return Ok(());
    }

    Err(format!(
        "Access denied for path outside the authorized workspace: {}",
        path.display()
    ))
}

fn is_markdown_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn is_excalidraw_file_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    name.ends_with(".excalidraw")
        || name.ends_with(".excalidraw.json")
        || name.ends_with(".excalidraw.md")
}

/// Markdown notes and Excalidraw drawings can open in dedicated windows.
fn is_document_file_path(path: &Path) -> bool {
    is_excalidraw_file_path(path) || is_markdown_file_path(path)
}

fn normalize_opened_file_path(path: PathBuf) -> Option<String> {
    let canonical = fs::canonicalize(path).ok()?;
    if !canonical.is_file() || !is_document_file_path(&canonical) {
        return None;
    }
    Some(canonical.to_string_lossy().into_owned())
}

fn opened_file_paths_from_urls(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(normalize_opened_file_path)
        .collect()
}

fn opened_file_paths_from_args(args: &[String], cwd: &str) -> Vec<String> {
    let cwd = PathBuf::from(cwd);

    args.iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            if let Ok(url) = tauri::Url::parse(arg) {
                return url.to_file_path().ok();
            }

            let candidate = PathBuf::from(arg);
            Some(if candidate.is_absolute() {
                candidate
            } else {
                cwd.join(candidate)
            })
        })
        .filter_map(normalize_opened_file_path)
        .collect()
}

fn queue_opened_file_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    match app.state::<OpenedFilesState>().paths.lock() {
        Ok(mut queued_paths) => {
            for path in &paths {
                if !queued_paths.contains(path) {
                    queued_paths.push(path.clone());
                }
            }
        }
        Err(error) => {
            log::error!("Failed to acquire opened files lock: {}", error);
        }
    }

    let _ = app.emit_to("main", "opened-files", paths);
}

/// Matches `app.windows[main].width/height` in tauri.conf.json.
const DEFAULT_WINDOW_WIDTH: f64 = 1200.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 800.0;
/// Keep windows usable — platform default without an explicit size, or a
/// window-state restore of physical pixels onto a higher-DPI display, is often
/// ~300–400 logical px and clips the sidebar + editor chrome.
const MIN_WINDOW_WIDTH: f64 = 960.0;
const MIN_WINDOW_HEIGHT: f64 = 640.0;

const SCALE_EPSILON: f64 = 0.01;
const LOGICAL_SIZE_EPSILON: f64 = 4.0;

#[derive(Clone, Copy, Debug)]
struct WindowSizeSnapshot {
    logical: (f64, f64),
    scale: f64,
    /// Scale before the latest monitor / DPI crossing. Stale `Resized`
    /// events after that crossing still report the old physical size.
    prior_scale: Option<f64>,
}

#[derive(Default)]
struct WindowLogicalSizeMemory {
    snapshots: Mutex<HashMap<String, WindowSizeSnapshot>>,
}

impl WindowLogicalSizeMemory {
    fn snapshot(&self, label: &str) -> Option<WindowSizeSnapshot> {
        self.snapshots.lock().ok()?.get(label).copied()
    }

    fn last(&self, label: &str) -> Option<(f64, f64)> {
        self.snapshot(label).map(|snapshot| snapshot.logical)
    }

    fn remember(&self, label: &str, size: (f64, f64), scale: f64) {
        if let Ok(mut snapshots) = self.snapshots.lock() {
            snapshots.insert(
                label.to_string(),
                WindowSizeSnapshot {
                    logical: size,
                    scale,
                    prior_scale: None,
                },
            );
        }
    }

    fn remember_scale_transition(&self, label: &str, new_scale: f64) {
        if new_scale <= 0.0 {
            return;
        }
        if let Ok(mut snapshots) = self.snapshots.lock() {
            if let Some(snapshot) = snapshots.get_mut(label) {
                if scales_differ(snapshot.scale, new_scale) {
                    snapshot.prior_scale = Some(snapshot.scale);
                    snapshot.scale = new_scale;
                }
            }
        }
    }

    fn any_in_scale_transition(&self) -> bool {
        self.snapshots
            .lock()
            .ok()
            .map(|snapshots| {
                snapshots
                    .values()
                    .any(|snapshot| snapshot.prior_scale.is_some())
            })
            .unwrap_or(false)
    }
}

fn clamp_window_size(width: f64, height: f64) -> (f64, f64) {
    (width.max(MIN_WINDOW_WIDTH), height.max(MIN_WINDOW_HEIGHT))
}

fn is_usable_logical_window_size(width: f64, height: f64) -> bool {
    width.is_finite()
        && height.is_finite()
        && width + 0.5 >= MIN_WINDOW_WIDTH
        && height + 0.5 >= MIN_WINDOW_HEIGHT
}

fn scales_differ(left: f64, right: f64) -> bool {
    (left - right).abs() > SCALE_EPSILON
}

fn logical_sizes_close(left: (f64, f64), right: (f64, f64)) -> bool {
    (left.0 - right.0).abs() <= LOGICAL_SIZE_EPSILON
        && (left.1 - right.1).abs() <= LOGICAL_SIZE_EPSILON
}

fn is_dpi_monitor_change(last_scale: Option<f64>, current_scale: f64) -> bool {
    match last_scale {
        Some(previous) if current_scale > 0.0 && scales_differ(previous, current_scale) => true,
        _ => false,
    }
}

/// True when the OS kept the same physical pixel size after a DPI change
/// (2× → 1× makes a 1200×800 window report as 2400×1600 logical).
fn is_physical_pixels_kept_across_scale(
    last_logical: (f64, f64),
    from_scale: f64,
    to_scale: f64,
    current_logical: (f64, f64),
) -> bool {
    if from_scale <= 0.0 || to_scale <= 0.0 || !scales_differ(from_scale, to_scale) {
        return false;
    }
    let expected = (
        last_logical.0 * from_scale / to_scale,
        last_logical.1 * from_scale / to_scale,
    );
    logical_sizes_close(current_logical, expected)
}

fn should_ignore_resize_after_monitor_move(
    snapshot: Option<WindowSizeSnapshot>,
    current_logical: (f64, f64),
    current_scale: f64,
) -> bool {
    let Some(snapshot) = snapshot else {
        return false;
    };
    if logical_sizes_close(current_logical, snapshot.logical) {
        return false;
    }
    if let Some(from_scale) = snapshot.prior_scale {
        if is_physical_pixels_kept_across_scale(
            snapshot.logical,
            from_scale,
            current_scale,
            current_logical,
        ) || is_physical_pixels_kept_across_scale(
            snapshot.logical,
            from_scale,
            snapshot.scale,
            current_logical,
        ) {
            return true;
        }
    }
    is_dpi_monitor_change(Some(snapshot.scale), current_scale)
        && is_physical_pixels_kept_across_scale(
            snapshot.logical,
            snapshot.scale,
            current_scale,
            current_logical,
        )
}

/// Pick a usable logical size after restore or a DPI / monitor change.
///
/// `tauri-plugin-window-state` persists `inner_size()` as **physical** pixels
/// and restores with `set_size(PhysicalSize)`. On a higher-DPI display that
/// shrinks the logical window (1200×800 physical on 2× → 600×400 logical) and
/// bypasses `minWidth`/`minHeight` from tauri.conf.json.
fn resolve_enforced_window_size(
    current_logical: Option<(f64, f64)>,
    scale: f64,
    last_good: Option<(f64, f64)>,
) -> (f64, f64) {
    if let Some((width, height)) = current_logical {
        if is_usable_logical_window_size(width, height) {
            return (width, height);
        }
        let recovered = (width * scale, height * scale);
        if scale > 1.0 && is_usable_logical_window_size(recovered.0, recovered.1) {
            return recovered;
        }
    }
    if let Some((width, height)) = last_good {
        if is_usable_logical_window_size(width, height) {
            return (width, height);
        }
    }
    (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
}

fn resolve_scale_change_logical_size(
    last_good: Option<(f64, f64)>,
    new_scale: f64,
    new_physical_width: u32,
    new_physical_height: u32,
) -> (f64, f64) {
    if let Some((width, height)) = last_good {
        if is_usable_logical_window_size(width, height) {
            return (width, height);
        }
    }
    if new_scale > 0.0 {
        let logical = (
            new_physical_width as f64 / new_scale,
            new_physical_height as f64 / new_scale,
        );
        if is_usable_logical_window_size(logical.0, logical.1) {
            return logical;
        }
    }
    (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
}

fn resolve_file_window_size(main_logical_size: Option<(f64, f64)>) -> (f64, f64) {
    match main_logical_size {
        Some((width, height))
            if width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0 =>
        {
            clamp_window_size(width, height)
        }
        _ => (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT),
    }
}

fn window_logical_inner_size(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    let size = window.inner_size().ok()?;
    Some((size.width as f64 / scale, size.height as f64 / scale))
}

fn window_has_usable_logical_size(window: &tauri::WebviewWindow) -> bool {
    match window_logical_inner_size(window) {
        Some((width, height)) => is_usable_logical_window_size(width, height),
        None => false,
    }
}

fn ensure_usable_window_size(window: &tauri::WebviewWindow, last_good: Option<(f64, f64)>) {
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
        MIN_WINDOW_WIDTH,
        MIN_WINDOW_HEIGHT,
    )));
    let scale = window
        .scale_factor()
        .ok()
        .filter(|value| *value > 0.0)
        .unwrap_or(1.0);
    let current = window_logical_inner_size(window);
    let (width, height) = resolve_enforced_window_size(current, scale, last_good);
    let should_apply = match current {
        Some((current_width, current_height)) => {
            (current_width - width).abs() > 1.0 || (current_height - height).abs() > 1.0
        }
        None => true,
    };
    if !should_apply {
        return;
    }
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    if current
        .map(|(current_width, current_height)| {
            !is_usable_logical_window_size(current_width, current_height)
        })
        .unwrap_or(true)
    {
        let _ = window.center();
    }
}

fn remember_usable_window_size(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let Some(size) = window_logical_inner_size(window) else {
        return;
    };
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    if scale > 0.0 && is_usable_logical_window_size(size.0, size.1) {
        app.state::<WindowLogicalSizeMemory>()
            .remember(window.label(), size, scale);
    }
}

fn restore_remembered_logical_size(
    window: &tauri::WebviewWindow,
    last_good: Option<(f64, f64)>,
) {
    let Some((width, height)) =
        last_good.filter(|(width, height)| is_usable_logical_window_size(*width, *height))
    else {
        return;
    };
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
        MIN_WINDOW_WIDTH,
        MIN_WINDOW_HEIGHT,
    )));
    if let Some(current) = window_logical_inner_size(window) {
        if logical_sizes_close(current, (width, height)) {
            return;
        }
    }
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
}

fn preserve_logical_size_on_monitor_change(window: &tauri::WebviewWindow) -> bool {
    let Ok(scale) = window.scale_factor() else {
        return false;
    };
    if scale <= 0.0 {
        return false;
    }
    let memory = window.app_handle().state::<WindowLogicalSizeMemory>();
    let snapshot = memory.snapshot(window.label());
    let current_logical = window_logical_inner_size(window);
    let dpi_changed = is_dpi_monitor_change(snapshot.map(|item| item.scale), scale);
    let stale_resize = current_logical
        .map(|size| should_ignore_resize_after_monitor_move(snapshot, size, scale))
        .unwrap_or(false);
    if !dpi_changed && !stale_resize {
        return false;
    }
    restore_remembered_logical_size(window, snapshot.map(|item| item.logical));
    memory.remember_scale_transition(window.label(), scale);
    true
}

fn enforce_all_window_sizes(app: &tauri::AppHandle) {
    let memory = app.state::<WindowLogicalSizeMemory>();
    for window in app.webview_windows().values() {
        let last_good = memory.last(window.label());
        ensure_usable_window_size(window, last_good);
        remember_usable_window_size(app, window);
    }
}

fn main_window_logical_size(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let main = app.get_webview_window("main")?;
    window_logical_inner_size(&main)
}

fn next_window_label(prefix: &str) -> Result<String, String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Failed to read system time.".to_string())?
        .as_millis();
    Ok(format!("{}-{}-{}", prefix, now_ms, uuid::Uuid::new_v4()))
}

fn build_secondary_window(
    app: &tauri::AppHandle,
    label: String,
    url: tauri::WebviewUrl,
) -> Result<tauri::WebviewWindow, String> {
    let (width, height) = resolve_file_window_size(main_window_logical_size(app));

    // Match main window chrome. Overlay titlebar APIs are macOS-only.
    let mut builder = tauri::WebviewWindowBuilder::new(app, label, url)
        .title("")
        .inner_size(width, height)
        .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        .resizable(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay);
    }

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    let last_good = app.state::<WindowLogicalSizeMemory>().last(window.label());
    ensure_usable_window_size(&window, last_good);
    remember_usable_window_size(app, &window);

    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
}

/// Must stay `async`: window-creating commands executed synchronously run on
/// the main thread and can deadlock the whole app (all windows stop reacting
/// to input) — see the Tauri docs on creating windows from commands.
#[tauri::command]
async fn open_file_in_new_window(
    app: tauri::AppHandle,
    path: String,
    with_vault: Option<bool>,
) -> Result<(), String> {
    let normalized = tauri::async_runtime::spawn_blocking(move || {
        normalize_opened_file_path(PathBuf::from(path))
    })
    .await
    .map_err(|e| format!("Failed to join path normalization task: {}", e))?;
    let Some(normalized) = normalized else {
        return Err("Only existing Markdown or Excalidraw files can be opened.".to_string());
    };

    let label = next_window_label("file")?;
    let encoded = urlencoding::encode(&normalized);
    // `with_vault=1` is set by in-app "Open in New Window". OS / system file
    // launches omit it so the window opens the document alone (no vault restore).
    let url = if with_vault.unwrap_or(false) {
        tauri::WebviewUrl::App(format!("index.html?openFile={}&withVault=1", encoded).into())
    } else {
        tauri::WebviewUrl::App(format!("index.html?openFile={}", encoded).into())
    };
    let _ = build_secondary_window(&app, label, url)?;
    Ok(())
}

/// Shared window-create path for the IPC command and native Dock menu.
///
/// The Tauri command cannot be `pub` in `lib.rs`: `#[tauri::command]` glue
/// reimports `__cmd__open_new_window` and fails rustc with E0255. Dock
/// therefore calls this ordinary helper instead of the command.
pub(crate) async fn create_empty_window(app: tauri::AppHandle) -> Result<(), String> {
    let label = next_window_label("win")?;
    let url = tauri::WebviewUrl::App("index.html".into());
    let _ = build_secondary_window(&app, label, url)?;
    Ok(())
}

/// Open an empty secondary window (restores the last knowledge base on boot).
/// Must stay private in `lib.rs` — see `create_empty_window`.
#[tauri::command]
async fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    create_empty_window(app).await
}

/// When the frontend has already flushed (or the user discarded), the next
/// CloseRequested must not `prevent_close` again — otherwise `destroy()` /
/// `close()` bounce back into the JS save dialog and the window never dies.
static ALLOW_NEXT_WINDOW_CLOSE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn allow_next_window_close() {
    ALLOW_NEXT_WINDOW_CLOSE.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn force_close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    ALLOW_NEXT_WINDOW_CLOSE.store(true, Ordering::SeqCst);
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
fn force_exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn persist_window_state(app: &tauri::AppHandle, require_settled: bool) {
    use tauri_plugin_window_state::{AppHandleExt, StateFlags};
    // The plugin writes physical pixels. Skip mid-DPI-move frames so a ~400px
    // or blown-up transitional size is not what the next launch restores.
    if require_settled
        && app
            .state::<WindowLogicalSizeMemory>()
            .any_in_scale_transition()
    {
        return;
    }
    if app
        .webview_windows()
        .values()
        .any(|window| !window_has_usable_logical_size(window))
    {
        return;
    }
    if let Err(error) = app.save_window_state(StateFlags::all()) {
        log::warn!("Failed to persist window state: {error}");
    }
}

const MAX_UPLOAD_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[tauri::command]
async fn upload_image_to_hosting(
    provider: String,
    config_json: String,
    image_base64: String,
    filename: String,
) -> Result<image_hosting::ImageUploadResponse, String> {
    let trimmed = image_base64.trim();
    let estimated_decoded_len = trimmed.len().saturating_mul(3).saturating_div(4);
    if estimated_decoded_len > MAX_UPLOAD_IMAGE_BYTES {
        return Err(format!(
            "Image data exceeds maximum upload size of {} bytes.",
            MAX_UPLOAD_IMAGE_BYTES
        ));
    }

    let image_bytes = BASE64_STANDARD
        .decode(trimmed)
        .map_err(|e| format!("Failed to decode image data: {}", e))?;
    if image_bytes.len() > MAX_UPLOAD_IMAGE_BYTES {
        return Err(format!(
            "Image data exceeds maximum upload size of {} bytes.",
            MAX_UPLOAD_IMAGE_BYTES
        ));
    }
    image_hosting::upload_image(&provider, &config_json, &image_bytes, &filename).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let _ = app.get_webview_window("main").map(|window| {
                let _ = window.show();
                let _ = window.set_focus();
            });

            let paths = opened_file_paths_from_args(&args, &cwd);
            queue_opened_file_paths(app, paths);
        }));
    }

    builder
        .manage(SecurityState::default())
        .manage(OpenedFilesState::default())
        .manage(WindowLogicalSizeMemory::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            ping,
            take_opened_files,
            open_file_in_new_window,
            open_new_window,
            get_secure_settings,
            set_secure_secret,
            list_system_fonts,
            register_allowed_path,
            delete_path_recursively,
            reveal_in_explorer,
            copy_sample_notes,
            publishing::publish_simple_blog,
            publishing::publish_wechat_draft,
            upload_image_to_hosting,
            check_macos_update,
            install_macos_update,
            write_text_file_atomic,
            allow_next_window_close,
            force_close_window,
            force_exit_app
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let _ = preserve_logical_size_on_monitor_change(window);
                    persist_window_state(window.app_handle(), false);
                    if ALLOW_NEXT_WINDOW_CLOSE.swap(false, Ordering::SeqCst) {
                        return;
                    }
                    // 插件默认只在 RunEvent::Exit 落盘；本应用会 preventClose
                    // 再 destroy，必须在 CloseRequested 时显式保存。
                    // 只通知被关闭的那个窗口自己去刷盘并 destroy；
                    // 用 emit 会广播到所有窗口，导致其它窗口也把自己关掉。
                    api.prevent_close();
                    let _ = window.emit_to(window.label(), "app-close-requested", "window");
                }
                tauri::WindowEvent::ScaleFactorChanged {
                    scale_factor,
                    new_inner_size,
                } => {
                    let memory = window.app_handle().state::<WindowLogicalSizeMemory>();
                    let last_good = memory.last(window.label());
                    let (width, height) = resolve_scale_change_logical_size(
                        last_good,
                        *scale_factor,
                        new_inner_size.width,
                        new_inner_size.height,
                    );
                    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
                        MIN_WINDOW_WIDTH,
                        MIN_WINDOW_HEIGHT,
                    )));
                    let incoming_logical = if *scale_factor > 0.0 {
                        (
                            new_inner_size.width as f64 / *scale_factor,
                            new_inner_size.height as f64 / *scale_factor,
                        )
                    } else {
                        (0.0, 0.0)
                    };
                    if !logical_sizes_close(incoming_logical, (width, height)) {
                        let _ = window.set_size(tauri::LogicalSize::new(width, height));
                    }
                    if last_good.is_some() {
                        memory.remember_scale_transition(window.label(), *scale_factor);
                    } else {
                        memory.remember(window.label(), (width, height), *scale_factor);
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    if preserve_logical_size_on_monitor_change(window) {
                        return;
                    }
                    let memory = window.app_handle().state::<WindowLogicalSizeMemory>();
                    match window_logical_inner_size(window) {
                        Some(size) if is_usable_logical_window_size(size.0, size.1) => {
                            let scale = window.scale_factor().ok().filter(|value| *value > 0.0);
                            if let Some(scale) = scale {
                                memory.remember(window.label(), size, scale);
                            }
                            persist_window_state(window.app_handle(), true);
                        }
                        Some(_) if memory.last(window.label()).is_none() => {
                            // First paint after a tiny window-state restore.
                            ensure_usable_window_size(window, None);
                            remember_usable_window_size(window.app_handle(), window);
                        }
                        _ => {}
                    }
                }
                tauri::WindowEvent::Moved(_) => {
                    if preserve_logical_size_on_monitor_change(window) {
                        return;
                    }
                    persist_window_state(window.app_handle(), true);
                }
                _ => {}
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(target_os = "macos")]
            {
                if let Err(error) = native_new_window::install_dock_new_window_menu(app.handle()) {
                    log::error!("Failed to install Dock new-window menu: {error}");
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let args: Vec<String> = std::env::args().skip(1).collect();
                if let Ok(cwd) = std::env::current_dir() {
                    let cwd = cwd.to_string_lossy().into_owned();
                    queue_opened_file_paths(app.handle(), opened_file_paths_from_args(&args, &cwd));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Ready = &event {
                // Plugin restore runs on window-ready and can override conf.json
                // min sizes with a physical-pixel snapshot from another display.
                enforce_all_window_sizes(app);
            }
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                enforce_all_window_sizes(app);
                persist_window_state(app, false);
                // 仅拦截系统触发的退出（Cmd+Q / 任务栏关闭）；前端在保存完成后调用 exit(0)
                // 会带 code，直接放行。最后一个窗口已经 destroy 时也不能再拦，否则进程会变成僵尸。
                if code.is_none() && !app.webview_windows().is_empty() {
                    api.prevent_exit();
                    let _ = app.emit("app-close-requested", "exit");
                }
            }
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    let paths = opened_file_paths_from_urls(&urls);
                    queue_opened_file_paths(app, paths);
                }
            }
        });
}

fn write_text_file_atomic_at(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Failed to resolve parent directory for {}", path.display()))?;
    let basename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_path = parent.join(format!(
        ".{}.tmp-{}-{}",
        basename,
        std::process::id(),
        nanos
    ));

    let write_result = (|| {
        fs::write(&temp_path, content).map_err(|error| {
            format!(
                "Failed to write temporary file {}: {}",
                temp_path.display(),
                error
            )
        })?;
        fs::rename(&temp_path, path).map_err(|error| {
            format!(
                "Failed to replace {} with temporary file: {}",
                path.display(),
                error
            )
        })?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

/// Must stay `async`: disk I/O on the main thread freezes every window.
#[tauri::command]
async fn write_text_file_atomic(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = canonicalize_scope_path(&path)?;
        ensure_path_allowed(app.state::<SecurityState>().inner(), &canonical)?;
        write_text_file_atomic_at(&canonical, &content)
    })
    .await
    .map_err(|error| format!("Failed to join atomic write task: {}", error))?
}

#[tauri::command]
fn ping() -> Result<String, String> {
    Ok("pong".to_string())
}

#[tauri::command]
fn take_opened_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let opened_files_state = app.state::<OpenedFilesState>();
    let mut paths = opened_files_state
        .paths
        .lock()
        .map_err(|_| "Failed to acquire opened files lock.".to_string())?;

    Ok(paths.drain(..).collect())
}

#[tauri::command]
async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(system_fonts::collect_system_fonts)
        .await
        .map_err(|e| format!("Failed to join system font query task: {}", e))?
}

/// Must stay `async`: `fs::canonicalize` can block for a long time on slow or
/// disconnected volumes (network drives, cloud placeholders). Running that on
/// the main thread freezes input handling for every window.
#[tauri::command]
async fn register_allowed_path(
    path: String,
    recursive: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = canonicalize_scope_path(&path)?;
        let fs_scope = app.fs_scope();

        if canonical.is_dir() {
            fs_scope
                .allow_directory(&canonical, recursive)
                .map_err(|e| format!("Failed to register fs scope for directory: {}", e))?;
        } else {
            fs_scope
                .allow_file(&canonical)
                .map_err(|e| format!("Failed to register fs scope for file: {}", e))?;
        }

        let security_state = app.state::<SecurityState>();
        let mut allowed_paths = security_state
            .allowed_paths
            .lock()
            .map_err(|_| "Failed to acquire security state lock.".to_string())?;

        if let Some(existing) = allowed_paths
            .iter_mut()
            .find(|entry| entry.path == canonical)
        {
            existing.recursive = existing.recursive || recursive;
            return Ok(());
        }

        allowed_paths.push(AllowedPathEntry {
            path: canonical,
            recursive,
        });

        Ok(())
    })
    .await
    .map_err(|e| format!("Failed to join path registration task: {}", e))?
}

/// Must stay `async`: deleting large directory trees blocks for the whole
/// duration; on the main thread that freezes input handling for every window.
#[tauri::command]
async fn delete_path_recursively(path: String, app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = canonicalize_existing_path(&path)?;
        ensure_path_allowed(app.state::<SecurityState>().inner(), &canonical)?;

        if canonical.is_dir() {
            fs::remove_dir_all(&canonical).map_err(|e| {
                format!("Failed to delete directory {}: {}", canonical.display(), e)
            })?;
        } else {
            fs::remove_file(&canonical)
                .map_err(|e| format!("Failed to delete file {}: {}", canonical.display(), e))?;
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Failed to join delete task: {}", e))?
}

/// Must stay `async`: this waits for a child process (`open` / `explorer` /
/// `xdg-open`) to exit, which can block indefinitely; on the main thread that
/// freezes input handling for every window.
#[tauri::command]
async fn reveal_in_explorer(path: String, app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reveal_in_explorer_blocking(&app, &path))
        .await
        .map_err(|e| format!("Failed to join reveal task: {}", e))?
}

fn reveal_in_explorer_blocking(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let canonical = canonicalize_existing_path(path)?;
    ensure_path_allowed(app.state::<SecurityState>().inner(), &canonical)?;

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-R")
            .arg(&canonical)
            .status()
            .map_err(|e| format!("Failed to reveal path in Finder: {}", e))?;
        if !status.success() {
            return Err(format!(
                "Finder failed to reveal path: {}",
                canonical.display()
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("explorer")
            .arg(format!("/select,{}", canonical.display()))
            .status()
            .map_err(|e| format!("Failed to reveal path in Explorer: {}", e))?;
        if !status.success() {
            return Err(format!(
                "Explorer failed to reveal path: {}",
                canonical.display()
            ));
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = canonical.parent().unwrap_or(&canonical);
        let status = Command::new("xdg-open")
            .arg(parent)
            .status()
            .map_err(|e| format!("Failed to reveal path in file manager: {}", e))?;
        if !status.success() {
            return Err(format!(
                "File manager failed to reveal path: {}",
                canonical.display()
            ));
        }
    }

    Ok(())
}

/// Copy sample notes from resources to the target directory
#[tauri::command]
async fn copy_sample_notes(
    app_handle: tauri::AppHandle,
    target_dir: String,
    security_state: tauri::State<'_, SecurityState>,
) -> Result<CopySampleNotesResult, String> {
    use tauri::Manager;

    let target_root = canonicalize_existing_path(&target_dir)?;
    ensure_path_allowed(security_state.inner(), &target_root)?;

    // Get the resource directory
    let resource_dir = app_handle
        .path()
        .resolve(
            "resources/sample-notes",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("Failed to resolve sample notes resource directory: {}", e))?;

    let source = Path::new(&resource_dir);
    let target = target_root.join(SAMPLE_NOTES_FOLDER_NAME);

    println!("[copy_sample_notes] Source: {:?}", source);
    println!("[copy_sample_notes] Target: {:?}", target);
    println!("[copy_sample_notes] Source exists: {}", source.exists());

    if !source.exists() {
        return Err(format!(
            "Sample notes source directory not found: {:?}",
            source
        ));
    }

    // Ensure target directory exists
    if !target.exists() {
        fs::create_dir_all(&target)
            .map_err(|e| format!("Failed to create target directory: {}", e))?;
    }

    sample_notes::sync_sample_notes(source, &target)
}

#[tauri::command]
async fn check_macos_update(
    app: tauri::AppHandle,
) -> Result<Option<macos_update::MacosUpdateInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || macos_update::check_macos_update_command(app))
        .await
        .map_err(|error| format!("Failed to join macOS update check: {error}"))?
}

#[tauri::command]
async fn install_macos_update(
    app: tauri::AppHandle,
    tag: String,
    on_event: tauri::ipc::Channel<macos_update::MacosUpdateProgressEvent>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        macos_update::install_macos_update_command(app, tag, on_event)
    })
    .await
    .map_err(|error| format!("Failed to join macOS update install: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn opened_file_paths_from_args_resolves_relative_markdown_paths() {
        let temp_dir = create_test_directory("opened-file-args");
        let note_path = temp_dir.join("note.md");
        let text_path = temp_dir.join("note.txt");
        fs::write(&note_path, "# note\n").expect("write note");
        fs::write(&text_path, "plain text\n").expect("write text");

        let paths = opened_file_paths_from_args(
            &[
                "note.md".to_string(),
                "note.txt".to_string(),
                "--flag".to_string(),
            ],
            temp_dir.to_str().expect("temp dir path"),
        );

        assert_eq!(
            paths,
            vec![fs::canonicalize(&note_path)
                .expect("canonical note path")
                .to_string_lossy()
                .into_owned()]
        );

        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn opened_file_paths_from_urls_accepts_file_urls() {
        let temp_dir = create_test_directory("opened-file-url");
        let note_path = temp_dir.join("note.markdown");
        fs::write(&note_path, "# note\n").expect("write note");
        let url = tauri::Url::from_file_path(&note_path).expect("file url");

        let paths = opened_file_paths_from_urls(&[url]);

        assert_eq!(
            paths,
            vec![fs::canonicalize(&note_path)
                .expect("canonical note path")
                .to_string_lossy()
                .into_owned()]
        );

        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn window_state_plugin_is_registered_and_linked() {
        use tauri_plugin_window_state::StateFlags;
        let src = include_str!("lib.rs");
        assert!(
            src.contains("tauri_plugin_window_state::Builder::default().build()"),
            "window-state plugin must be registered on the Tauri builder"
        );
        assert!(
            src.contains("save_window_state"),
            "CloseRequested path must flush window state explicitly"
        );
        let flags = StateFlags::all();
        assert!(flags.contains(StateFlags::SIZE));
        assert!(flags.contains(StateFlags::POSITION));
    }

    #[test]
    fn resolve_file_window_size_uses_defaults_when_main_size_is_missing() {
        assert_eq!(
            resolve_file_window_size(None),
            (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        );
        assert_eq!(
            resolve_file_window_size(Some((0.0, 100.0))),
            (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        );
    }

    #[test]
    fn write_text_file_atomic_at_writes_content_and_leaves_no_tmp() {
        let temp_dir = create_test_directory("atomic-write");
        let target = temp_dir.join("note.md");

        write_text_file_atomic_at(&target, "# hello\n").expect("atomic write");

        let written = fs::read_to_string(&target).expect("read written file");
        assert_eq!(written, "# hello\n");

        let leftover_tmp = fs::read_dir(&temp_dir)
            .expect("read temp dir")
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.file_name().to_string_lossy().contains(".tmp-"));
        assert!(
            !leftover_tmp,
            "temporary file should be removed after rename"
        );

        cleanup_test_directory(&temp_dir);
    }

    #[test]
    fn allow_next_window_close_is_consumed_once() {
        ALLOW_NEXT_WINDOW_CLOSE.store(false, Ordering::SeqCst);
        allow_next_window_close();
        assert!(
            ALLOW_NEXT_WINDOW_CLOSE.swap(false, Ordering::SeqCst),
            "the first CloseRequested after allow must proceed"
        );
        assert!(
            !ALLOW_NEXT_WINDOW_CLOSE.swap(false, Ordering::SeqCst),
            "later CloseRequested events must be intercepted again"
        );
    }

    #[test]
    fn close_commands_are_registered_and_honor_allow_flag() {
        let src = include_str!("lib.rs");
        assert!(
            src.contains("allow_next_window_close,"),
            "frontend must be able to mark the next close as intentional"
        );
        assert!(
            src.contains("force_close_window,"),
            "frontend must have a rust-side destroy fallback"
        );
        assert!(
            src.contains("force_exit_app"),
            "frontend must have a rust-side exit fallback"
        );
        assert!(
            src.contains("if ALLOW_NEXT_WINDOW_CLOSE.swap(false, Ordering::SeqCst)"),
            "CloseRequested must skip prevent_close after a successful flush/discard"
        );
    }

    #[test]
    fn resolve_file_window_size_clamps_tiny_main_window_sizes() {
        assert_eq!(
            resolve_file_window_size(Some((400.0, 300.0))),
            (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        );
        assert_eq!(
            resolve_file_window_size(Some((1400.0, 900.0))),
            (1400.0, 900.0)
        );
    }

    #[test]
    fn resolve_enforced_window_size_keeps_usable_logical_sizes() {
        assert_eq!(
            resolve_enforced_window_size(Some((1400.0, 900.0)), 2.0, None),
            (1400.0, 900.0)
        );
        assert_eq!(
            resolve_enforced_window_size(Some((960.0, 640.0)), 1.0, None),
            (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        );
    }

    #[test]
    fn resolve_enforced_window_size_recovers_physical_restore_on_retina() {
        // window-state saved 1200×800 physical on a 1× display, then restored
        // that PhysicalSize onto a 2× display → 600×400 logical.
        assert_eq!(
            resolve_enforced_window_size(Some((600.0, 400.0)), 2.0, None),
            (1200.0, 800.0)
        );
        assert_eq!(
            resolve_enforced_window_size(Some((400.0, 800.0 / 3.0)), 3.0, None),
            (1200.0, 800.0)
        );
    }

    #[test]
    fn resolve_enforced_window_size_defaults_when_size_is_genuinely_tiny() {
        assert_eq!(
            resolve_enforced_window_size(None, 1.0, None),
            (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        );
        assert_eq!(
            resolve_enforced_window_size(Some((400.0, 300.0)), 1.0, None),
            (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        );
        assert_eq!(
            resolve_enforced_window_size(Some((400.0, 300.0)), 2.0, None),
            (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        );
        assert_eq!(
            resolve_enforced_window_size(
                Some((400.0, 300.0)),
                1.0,
                Some((DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT))
            ),
            (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        );
    }

    #[test]
    fn resolve_scale_change_logical_size_keeps_last_good_size() {
        assert_eq!(
            resolve_scale_change_logical_size(Some((1200.0, 800.0)), 2.0, 1200, 800),
            (1200.0, 800.0)
        );
        assert_eq!(
            resolve_scale_change_logical_size(Some((1400.0, 900.0)), 1.0, 2800, 1800),
            (1400.0, 900.0)
        );
        assert_eq!(
            resolve_scale_change_logical_size(None, 2.0, 2400, 1600),
            (1200.0, 800.0)
        );
        assert_eq!(
            resolve_scale_change_logical_size(None, 2.0, 800, 600),
            (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
        );
    }

    #[test]
    fn is_usable_logical_window_size_rejects_sidebar_clipping_widths() {
        assert!(!is_usable_logical_window_size(400.0, 300.0));
        assert!(!is_usable_logical_window_size(767.0, 640.0));
        assert!(is_usable_logical_window_size(960.0, 640.0));
    }

    #[test]
    fn physical_pixels_kept_across_scale_detects_2x_to_1x_blowup() {
        assert!(is_physical_pixels_kept_across_scale(
            (1200.0, 800.0),
            2.0,
            1.0,
            (2400.0, 1600.0),
        ));
        assert!(is_physical_pixels_kept_across_scale(
            (1200.0, 800.0),
            1.0,
            2.0,
            (600.0, 400.0),
        ));
        assert!(!is_physical_pixels_kept_across_scale(
            (1200.0, 800.0),
            2.0,
            1.0,
            (1300.0, 820.0),
        ));
        assert!(!is_physical_pixels_kept_across_scale(
            (1200.0, 800.0),
            2.0,
            2.0,
            (2400.0, 1600.0),
        ));
    }

    #[test]
    fn ignore_resize_after_monitor_move_until_logical_size_matches() {
        let snapshot = WindowSizeSnapshot {
            logical: (1200.0, 800.0),
            scale: 2.0,
            prior_scale: None,
        };
        assert!(should_ignore_resize_after_monitor_move(
            Some(snapshot),
            (2400.0, 1600.0),
            1.0,
        ));
        assert!(!should_ignore_resize_after_monitor_move(
            Some(snapshot),
            (1200.0, 800.0),
            1.0,
        ));

        let after_transition = WindowSizeSnapshot {
            logical: (1200.0, 800.0),
            scale: 1.0,
            prior_scale: Some(2.0),
        };
        assert!(should_ignore_resize_after_monitor_move(
            Some(after_transition),
            (2400.0, 1600.0),
            1.0,
        ));
        assert!(!should_ignore_resize_after_monitor_move(
            Some(after_transition),
            (1400.0, 900.0),
            1.0,
        ));
    }

    #[test]
    fn dpi_monitor_change_ignores_first_reading_and_same_scale() {
        assert!(!is_dpi_monitor_change(None, 2.0));
        assert!(!is_dpi_monitor_change(Some(2.0), 2.0));
        assert!(is_dpi_monitor_change(Some(2.0), 1.0));
        assert!(is_dpi_monitor_change(Some(1.0), 2.0));
    }

    fn create_test_directory(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let unique = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        path.push(format!(
            "markdown-press-{}-{}-{}",
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
}
