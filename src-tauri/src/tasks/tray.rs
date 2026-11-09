use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

pub fn show_window(app: &AppHandle, tasks: bool) {
    let windows = app.webview_windows();
    let window = windows
        .get("main")
        .cloned()
        .or_else(|| windows.values().next().cloned());
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
        if en {
            "Tasks & calendar"
        } else {
            "待办与日程"
        },
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
        .on_menu_event(|app, event| match event.id.as_ref() {
            "task-calendar-open" => show_window(app, true),
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
