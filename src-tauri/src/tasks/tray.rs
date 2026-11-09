use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub const TRAY_WINDOW_LABEL: &str = "task-tray";
const POPOVER_WIDTH: f64 = 380.0;
const POPOVER_HEIGHT: f64 = 540.0;
static OPEN_POPOVER: Mutex<()> = Mutex::new(());

// 创建 WebView 必须离开原生事件线程；锁只在工作线程获取，串行快速连点。
fn defer_popover_open(action: impl FnOnce() + Send + 'static) {
    tauri::async_runtime::spawn_blocking(move || {
        let _opening = OPEN_POPOVER
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        action();
    });
}

fn request_tasks(app: &AppHandle, anchor: Option<tauri::Rect>) {
    let app = app.clone();
    defer_popover_open(move || {
        if let Err(error) = show_tasks(&app, anchor) {
            log::error!("打开托盘待办失败：{error}");
        }
    });
}

fn show_tasks(app: &AppHandle, anchor: Option<tauri::Rect>) -> Result<(), String> {
    if crate::macos_update::update_installation_locked() {
        return Ok(());
    }
    let window = match app.get_webview_window(TRAY_WINDOW_LABEL) {
        Some(window) => window,
        None => {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                TRAY_WINDOW_LABEL,
                tauri::WebviewUrl::App("index.html?trayTasks=1".into()),
            )
            .title("墨知 · 待办事项")
            .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
            if crate::macos_update::update_installation_locked() {
                let _ = window.destroy();
                return Ok(());
            }
            window
        }
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let point = anchor
        .as_ref()
        .map(|rect| rect.position.to_physical::<f64>(scale));
    let monitor = point
        .and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = POPOVER_WIDTH.min((area.size.width as f64 / scale - 16.0).max(1.0));
        let height = POPOVER_HEIGHT.min((area.size.height as f64 / scale - 16.0).max(1.0));
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        let size = tauri::LogicalSize::new(width, height).to_physical::<u32>(scale);
        let gap = (6.0 * scale) as i32;
        let (x, y) = if let Some(rect) = anchor {
            let pos = rect.position.to_physical::<i32>(scale);
            let rect_size = rect.size.to_physical::<u32>(scale);
            let below = pos.y + rect_size.height as i32 + gap;
            let y = if below + size.height as i32 <= area.position.y + area.size.height as i32 {
                below
            } else {
                pos.y - gap - size.height as i32
            };
            (pos.x + (rect_size.width as i32 - size.width as i32) / 2, y)
        } else {
            // Linux 面板不能提供点击坐标时，在工作区右上角展示同一待办浮窗。
            (
                area.position.x + area.size.width as i32 - size.width as i32 - gap,
                area.position.y + gap,
            )
        };
        let (x, y) = crate::fit_window_position_to_work_area(
            (x, y),
            (size.width, size.height),
            (area.position.x, area.position.y),
            (area.size.width, area.size.height),
        );
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn show_window(app: &AppHandle, tasks: bool) {
    let windows = app.webview_windows();
    let window = windows.get("main").cloned().or_else(|| {
        windows
            .values()
            .find(|window| window.label() != TRAY_WINDOW_LABEL)
            .cloned()
    });
    if let Some(window) = window {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if tasks {
            let _ = window.emit_to(window.label(), "task-calendar-open", ());
        }
    } else {
        let url = if tasks {
            "index.html?taskCalendar=1"
        } else {
            "index.html"
        };
        match crate::next_window_label("win") {
            Ok(label) => {
                let _ =
                    crate::build_secondary_window(app, label, tauri::WebviewUrl::App(url.into()));
            }
            Err(error) => log::error!("恢复墨知窗口失败：{error}"),
        }
    }
}

pub fn ensure(app: &AppHandle, language: &str) -> Result<(), String> {
    if app.tray_by_id("task-calendar").is_some() {
        return Ok(());
    }
    let en = language == "en";
    let tasks = MenuItem::with_id(
        app,
        "task-calendar-open",
        if en { "Tasks" } else { "待办事项" },
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let open = MenuItem::with_id(
        app,
        "task-calendar-app",
        if en { "Open Mozi" } else { "打开墨知" },
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(
        app,
        "task-calendar-quit",
        if en { "Quit" } else { "退出" },
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&tasks, &open, &quit]).map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .ok_or("Missing application icon")?
        .clone();
    TrayIconBuilder::with_id("task-calendar")
        .icon(icon)
        .tooltip("墨知 · Mozi")
        .menu(&menu)
        // Linux 不发送托盘点击事件，保留系统菜单作为入口。
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                request_tasks(tray.app_handle(), Some(rect));
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "task-calendar-open" => {
                let anchor = app
                    .tray_by_id("task-calendar")
                    .and_then(|tray| tray.rect().ok().flatten());
                request_tasks(app, anchor);
            }
            "task-calendar-app" => show_window(app, false),
            // 仍由已有退出协调器逐窗保存，不能直接 app.exit。
            "task-calendar-quit" => {
                show_window(app, false);
                crate::request_app_exit(app);
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread, time::Duration};

    #[test]
    fn popover_creation_leaves_the_event_thread_and_serializes_repeated_clicks() {
        let caller = thread::current().id();
        let (started, first) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        defer_popover_open(move || {
            started.send(thread::current().id()).unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        let worker = first.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_ne!(worker, caller);

        let (started, second) = mpsc::channel();
        defer_popover_open(move || started.send(()).unwrap());
        let overlapping = second.recv_timeout(Duration::from_millis(50));
        release.send(()).unwrap();
        assert!(matches!(overlapping, Err(mpsc::RecvTimeoutError::Timeout)));
        second.recv_timeout(Duration::from_secs(5)).unwrap();
    }
}
