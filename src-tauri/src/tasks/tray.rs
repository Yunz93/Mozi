use chrono::{DateTime, Local, NaiveDate};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub const TRAY_WINDOW_LABEL: &str = "task-tray";
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

#[derive(Default)]
pub(super) struct RefreshState {
    key: Option<(u64, NaiveDate, usize)>,
}

impl RefreshState {
    pub(super) fn update(
        &mut self,
        snapshot: &super::model::Snapshot,
        now: DateTime<Local>,
    ) -> bool {
        // 同一快照的截止时间固定，逾期数量与本地日期足以识别时间引起的分组变化。
        let overdue = snapshot
            .tasks
            .iter()
            .filter(|task| is_overdue(task, now))
            .count();
        let key = (snapshot.version, now.date_naive(), overdue);
        if self.key == Some(key) {
            return false;
        }
        self.key = Some(key);
        true
    }

    pub(super) fn invalidate(&mut self) {
        self.key = None;
    }
}

fn is_overdue(task: &super::model::Task, now: DateTime<Local>) -> bool {
    !task.completed
        && !task.date_error
        && task
            .deadline_at
            .is_some_and(|at| at <= now.timestamp_millis())
}

fn task_group(task: &super::model::Task, now: DateTime<Local>, en: bool) -> String {
    let today = now.format("%Y-%m-%d").to_string();
    if task.date_error {
        if en {
            "Invalid date"
        } else {
            "日期待修正"
        }
        .to_string()
    } else if is_overdue(task, now) {
        if en { "Overdue" } else { "已逾期" }.to_string()
    } else {
        match task.date.as_deref() {
            None => if en { "Unscheduled" } else { "未安排" }.to_string(),
            Some(date) if date == today => if en { "Today" } else { "今天" }.to_string(),
            Some(date) => date.to_string(),
        }
    }
}

fn status_label(snapshot: &super::model::Snapshot, count: usize) -> Option<String> {
    let en = snapshot.preferences.language == "en";
    let failed = snapshot.error.is_some() || snapshot.vaults.iter().any(|vault| vault.unavailable);
    let mut messages = Vec::new();
    if failed {
        messages.push(
            if en {
                "Tasks could not be fully loaded. Open Mozi to check the knowledge bases."
            } else {
                "待办读取失败，请打开墨知检查知识库"
            }
            .to_string(),
        );
    }
    if count == 0 {
        if snapshot.scanning {
            messages.push(
                if en {
                    "Loading tasks…"
                } else {
                    "正在加载待办…"
                }
                .to_string(),
            );
        } else if !failed {
            messages.push(
                if en {
                    "No pending tasks"
                } else {
                    "暂无待办事项"
                }
                .to_string(),
            );
        }
    } else if count > 40 {
        messages.push(if en {
            format!("{} more tasks in Mozi", count - 40)
        } else {
            format!("其余 {} 项请在墨知查看", count - 40)
        });
    }
    if messages.is_empty() {
        None
    } else {
        Some(messages.join(" · "))
    }
}

fn task_label(task: &super::model::Task, en: bool) -> String {
    let title = task.title.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut compact = title.chars().take(36).collect::<String>();
    if title.chars().count() > 36 {
        compact.push('…');
    }
    if compact.is_empty() {
        compact = if en {
            "Untitled task"
        } else {
            "未命名待办"
        }
        .into();
    }
    let source = task
        .relative_path
        .rsplit('/')
        .next()
        .unwrap_or(&task.relative_path);
    let source = source.chars().take(28).collect::<String>();
    let label = match (&task.date, &task.time) {
        (Some(date), Some(time)) => format!("{date} {time}  {compact}"),
        (Some(date), None) => format!("{date}  {compact}"),
        _ => compact,
    };
    format!("{label} · {source}:{}", task.line)
}

fn menu_labels(tasks: &[&super::model::Task], en: bool) -> Vec<String> {
    let labels = tasks
        .iter()
        .map(|task| task_label(task, en))
        .collect::<Vec<_>>();
    let mut counts = std::collections::BTreeMap::new();
    for label in &labels {
        *counts.entry(label).or_insert(0) += 1;
    }
    tasks
        .iter()
        .zip(&labels)
        .map(|(task, label)| {
            if counts[label] > 1 {
                format!("{label} ({})", task.file_path)
            } else {
                label.clone()
            }
        })
        .collect()
}

async fn open_task_source<F: std::future::Future<Output = Result<(), String>>>(
    snapshot: Result<super::model::Snapshot, String>,
    task_id: &str,
    open: impl FnOnce(String) -> F,
    report_error: impl FnOnce(String),
) {
    let result = match snapshot {
        Ok(snapshot) => match snapshot
            .tasks
            .iter()
            .find(|task| task.id == task_id && !task.completed && task.available)
        {
            Some(task) => open(task.file_path.clone()).await,
            None => Err(if snapshot.preferences.language == "en" {
                "This task has changed or its source is unavailable. Refresh tasks in Mozi."
            } else {
                "事项已变更或来源不可用，请在墨知中刷新待办。"
            }
            .into()),
        },
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        report_error(error);
    }
}

fn show_task_error(app: &AppHandle, error: String) {
    log::error!("打开待办来源失败：{error}");
    let en = app
        .state::<super::TaskManager>()
        .snapshot()
        .is_ok_and(|snapshot| snapshot.preferences.language == "en");
    app.dialog()
        .message(error)
        .title(if en {
            "Mozi · Could not open task"
        } else {
            "墨知 · 无法打开待办来源"
        })
        .kind(MessageDialogKind::Error)
        .show(|_| {});
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = app
            .state::<super::TaskManager>()
            .request(super::index::Operation::Refresh(None))
        {
            log::warn!("刷新失效待办失败：{error}");
        }
    });
}

fn pending_tasks(
    snapshot: &super::model::Snapshot,
    now: DateTime<Local>,
) -> Vec<&super::model::Task> {
    let today = now.format("%Y-%m-%d").to_string();
    let mut tasks = snapshot
        .tasks
        .iter()
        .filter(|task| !task.completed)
        .collect::<Vec<_>>();
    tasks.sort_by_key(|task| {
        let group = if task.date_error {
            4
        } else if is_overdue(task, now) {
            0
        } else if task.date.as_deref() == Some(today.as_str()) {
            1
        } else if task.date.is_some() {
            2
        } else {
            3
        };
        (
            group,
            task.date.as_deref().unwrap_or("9999-99-99"),
            task.time.as_deref().unwrap_or("00:00"),
            &task.relative_path,
            task.start,
        )
    });
    tasks
}

fn native_menu(
    app: &AppHandle,
    snapshot: &super::model::Snapshot,
) -> Result<Menu<tauri::Wry>, String> {
    let en = snapshot.preferences.language == "en";
    let menu = Menu::new(app).map_err(|e| e.to_string())?;
    let now = Local::now();
    let tasks = pending_tasks(snapshot, now);
    let heading = if en {
        format!("Tasks · {}", tasks.len())
    } else {
        format!("待办事项 · {} 项", tasks.len())
    };
    menu.append(
        &MenuItem::with_id(app, "task-calendar-heading", heading, false, None::<&str>)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut previous = String::new();
    let labels = menu_labels(&tasks, en);
    for (index, (task, label)) in tasks.iter().zip(&labels).take(40).enumerate() {
        let group = task_group(task, now, en);
        if group != previous {
            menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            menu.append(
                &MenuItem::with_id(
                    app,
                    format!("task-calendar-group-{index}"),
                    &group,
                    false,
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            previous = group;
        }
        menu.append(
            &MenuItem::with_id(
                app,
                format!("task-calendar-item:{}", task.id),
                label,
                task.available,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(label) = status_label(snapshot, tasks.len()) {
        menu.append(
            &MenuItem::with_id(app, "task-calendar-summary", label, false, None::<&str>)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    menu.append(
        &MenuItem::with_id(
            app,
            "task-calendar-app",
            if en { "Open Mozi" } else { "打开墨知" },
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    menu.append(
        &MenuItem::with_id(
            app,
            "task-calendar-quit",
            if en { "Quit Mozi" } else { "退出墨知" },
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(menu)
}

pub fn refresh(app: &AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("task-calendar") {
        let snapshot = app.state::<super::TaskManager>().snapshot()?;
        tray.set_menu(Some(native_menu(app, &snapshot)?))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ensure(app: &AppHandle, _language: &str) -> Result<(), String> {
    if app.tray_by_id("task-calendar").is_some() {
        return refresh(app);
    }
    let snapshot = app.state::<super::TaskManager>().snapshot()?;
    let menu = native_menu(app, &snapshot)?;
    let icon = app
        .default_window_icon()
        .ok_or("Missing application icon")?
        .clone();
    TrayIconBuilder::with_id("task-calendar")
        .icon(icon)
        .tooltip("墨知 · Mozi")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            // 菜单回调不能同步创建 WebView；所有窗口操作在工作线程执行。
            let app = app.clone();
            let id = event.id.as_ref().to_string();
            defer_popover_open(move || {
                if crate::macos_update::update_installation_locked() {
                    return;
                }
                if let Some(task_id) = id.strip_prefix("task-calendar-item:") {
                    let snapshot = app.state::<super::TaskManager>().snapshot();
                    let task_id = task_id.to_string();
                    let opener = app.clone();
                    tauri::async_runtime::spawn(async move {
                        open_task_source(
                            snapshot,
                            &task_id,
                            |path| crate::open_file_in_new_window(opener, path, Some(true)),
                            |error| show_task_error(&app, error),
                        )
                        .await;
                    });
                } else if id == "task-calendar-app" {
                    show_window(&app, false);
                } else if id == "task-calendar-quit" {
                    // 沿用退出前保存流程，必要时先恢复用于协调退出的窗口。
                    show_window(&app, false);
                    crate::request_app_exit(&app);
                }
            });
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread, time::Duration};

    use super::super::{model::Snapshot, parser};
    use chrono::TimeZone;

    fn at(day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 11, day, hour, minute, 0)
            .single()
            .unwrap()
    }

    fn snapshot(text: &str) -> Snapshot {
        Snapshot {
            version: 1,
            tasks: parser::parse(
                text,
                std::path::Path::new("/vault"),
                std::path::Path::new("/vault/note.md"),
            ),
            ..Default::default()
        }
    }

    #[test]
    fn clock_refreshes_after_midnight_without_a_snapshot_change() {
        let snapshot = snapshot("- [ ] 全天事项 @2026-11-09");
        let mut state = RefreshState::default();
        assert!(state.update(&snapshot, at(9, 23, 59)));
        assert!(!state.update(&snapshot, at(9, 23, 59)));
        assert!(state.update(&snapshot, at(10, 0, 0)));
        assert!(!state.update(&snapshot, at(10, 0, 1)));
    }

    #[test]
    fn clock_refreshes_at_deadline_and_after_clock_moves_back() {
        let snapshot = snapshot("- [ ] 定时事项 @2026-11-09 09:00");
        let mut state = RefreshState::default();
        assert!(state.update(&snapshot, at(9, 8, 59)));
        assert!(state.update(&snapshot, at(9, 9, 0)));
        assert!(!state.update(&snapshot, at(9, 10, 0)));
        assert!(state.update(&snapshot, at(9, 8, 59)));
    }

    #[test]
    fn timed_and_all_day_groups_match_their_actual_deadlines() {
        let timed = snapshot("- [ ] 定时事项 @2026-11-09 09:00").tasks.remove(0);
        assert_eq!(task_group(&timed, at(9, 8, 59), false), "今天");
        assert_eq!(task_group(&timed, at(9, 9, 0), false), "已逾期");
        assert_eq!(task_group(&timed, at(9, 10, 0), true), "Overdue");
        let all_day = snapshot("- [ ] 全天事项 @2026-11-09").tasks.remove(0);
        assert_eq!(task_group(&all_day, at(9, 23, 59), false), "今天");
        assert_eq!(task_group(&all_day, at(10, 0, 0), false), "已逾期");
    }

    #[test]
    fn read_failures_are_not_reported_as_an_empty_task_list() {
        let mut snapshot = Snapshot::default();
        assert_eq!(status_label(&snapshot, 0).as_deref(), Some("暂无待办事项"));
        snapshot.error = Some("Knowledge base is unavailable".into());
        for count in [0, 1, 41] {
            assert!(status_label(&snapshot, count).unwrap().contains("读取失败"));
        }
        snapshot.error = None;
        snapshot.vaults.push(super::super::model::Vault {
            name: "离线知识库".into(),
            path: "/offline".into(),
            trash_folder: ".trash".into(),
            unavailable: true,
        });
        assert!(status_label(&snapshot, 0).unwrap().contains("读取失败"));
    }

    #[test]
    fn overdue_and_today_sections_stay_contiguous_with_all_day_tasks() {
        let snapshot = snapshot(
            "- [ ] 全天 @2026-11-09\n- [ ] 已到期 @2026-11-09 09:00\n- [ ] 稍后 @2026-11-09 18:00",
        );
        let tasks = pending_tasks(&snapshot, at(9, 10, 0));
        let groups = tasks
            .iter()
            .map(|task| task_group(task, at(9, 10, 0), false))
            .collect::<Vec<_>>();
        assert_eq!(groups, vec!["已逾期", "今天", "今天"]);
        assert_eq!(tasks[0].title, "已到期");
    }

    #[test]
    fn menu_refresh_retries_failed_render_and_tracks_new_snapshot_versions() {
        let mut snapshot = snapshot("- [ ] 普通事项");
        let mut state = RefreshState::default();
        assert!(state.update(&snapshot, at(9, 10, 0)));
        assert!(!state.update(&snapshot, at(9, 10, 1)));
        state.invalidate();
        assert!(state.update(&snapshot, at(9, 10, 1)));
        snapshot.version += 1;
        assert!(state.update(&snapshot, at(9, 10, 1)));
    }

    #[test]
    fn task_labels_distinguish_the_same_title_in_different_notes() {
        let first = snapshot("- [ ] 整理笔记").tasks.remove(0);
        let mut second = first.clone();
        second.relative_path = "other.md".into();
        assert_ne!(task_label(&first, false), task_label(&second, false));
        assert!(task_label(&first, false).contains("note.md:1"));
    }

    #[test]
    fn duplicate_file_names_are_disambiguated_across_folders_and_vaults() {
        let first = snapshot("- [ ] 同名事项").tasks.remove(0);
        let mut second = first.clone();
        second.file_path = "/vault/project/note.md".into();
        second.relative_path = "project/note.md".into();
        let mut third = first.clone();
        third.file_path = "/other-vault/note.md".into();
        third.vault_path = "/other-vault".into();
        let tasks = vec![&first, &second, &third];
        let labels = menu_labels(&tasks, false);
        assert_eq!(
            labels
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            3
        );
        assert!(labels[1].contains("/vault/project/note.md"));
        assert_eq!(
            menu_labels(&[&first], false),
            vec![task_label(&first, false)]
        );
    }

    #[test]
    fn failed_opens_reach_visible_feedback_but_successful_opens_do_not() {
        for fail in [false, true] {
            let snapshot = snapshot("- [ ] 整理笔记");
            let id = snapshot.tasks[0].id.clone();
            let mut opened = Vec::new();
            let mut errors = Vec::new();
            tauri::async_runtime::block_on(open_task_source(
                Ok(snapshot),
                &id,
                |path| {
                    opened.push(path);
                    std::future::ready(if fail {
                        Err("来源文件已移动".into())
                    } else {
                        Ok(())
                    })
                },
                |error| errors.push(error),
            ));
            assert_eq!(opened, vec!["/vault/note.md"]);
            assert_eq!(
                errors,
                if fail {
                    vec!["来源文件已移动"]
                } else {
                    vec![]
                }
            );
        }
    }

    #[test]
    fn stale_menu_items_report_unavailable_instead_of_opening_old_sources() {
        let mut snapshot = snapshot("- [ ] 整理笔记");
        let id = snapshot.tasks[0].id.clone();
        snapshot.tasks[0].completed = true;
        let mut errors = Vec::new();
        tauri::async_runtime::block_on(open_task_source(
            Ok(snapshot),
            &id,
            |_| async { panic!("已完成事项不能按旧菜单继续打开") },
            |error| errors.push(error),
        ));
        assert_eq!(errors.len(), 1);
        let mut errors = Vec::new();
        tauri::async_runtime::block_on(open_task_source(
            Err("无法读取待办快照".into()),
            &id,
            |_| async { panic!("读取失败不能继续打开来源") },
            |error| errors.push(error),
        ));
        assert_eq!(errors, vec!["无法读取待办快照"]);
    }

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
