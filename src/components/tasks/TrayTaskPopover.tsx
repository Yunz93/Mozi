import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowUpRight, BookOpen, ListTodo, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
  APP_STORE_PERSIST_NAME,
  defaultSettings,
  useAppStore,
} from "../../store/appStore";
import { useTaskCalendarStore } from "../../store/taskCalendarStore";
import { useTaskCalendar } from "../../hooks/useTaskCalendar";
import { useThemeSync } from "../../hooks/useThemeSync";
import { useSystemThemeFollow } from "../../hooks/useSystemThemeFollow";
import { useUiAccentColor } from "../../hooks/useUiAccentColor";
import { useI18n } from "../../hooks/useI18n";
import { useCloseGuard } from "../../app/useCloseGuard";
import { UpdateInstallGuard } from "../../app/UpdateInstallGuard";
import {
  ensureDynamicFontFaces,
  getResolvedUiFontFamily,
} from "../../utils/fontSettings";
import { openPathInNewAppWindow } from "../../utils/appWindow";
import { isImeComposingEvent } from "../../utils/imeKeyboard";
import { isTauriEnvironment } from "../../types/filesystem";
import { TaskListView } from "./TaskListView";

/** 托盘窗口只呈现共享待办快照，不启动编辑器或重复扫描知识库。 */
export function TrayTaskPopover() {
  const settings = useAppStore((state) => state.settings);
  const { snapshot, error, reload } = useTaskCalendarStore();
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);
  const [actionError, setActionError] = useState<string | null>(null);
  useTaskCalendar();
  useCloseGuard(async () => true);
  useSystemThemeFollow();
  useThemeSync(settings.themeMode, settings.themeFollowSystem);
  useUiAccentColor(settings.uiAccentColor, settings.themeMode);

  useEffect(() => {
    void ensureDynamicFontFaces(settings).catch(() => {});
  }, [settings]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let disposed = false;
    let stopFocus: (() => void) | undefined;
    const refreshSettings = async () => {
      try {
        await useAppStore.persist.rehydrate();
        if (!disposed) await useTaskCalendarStore.getState().reload();
      } catch (reason) {
        if (!disposed) setActionError(String(reason));
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === APP_STORE_PERSIST_NAME) void refreshSettings();
    };
    window.addEventListener("storage", storage);
    if (isTauriEnvironment()) {
      void getCurrentWindow()
        .onFocusChanged(({ payload }) => {
          if (payload) void refreshSettings();
        })
        .then((stop) => {
          if (disposed) stop();
          else stopFocus = stop;
        })
        .catch((reason: unknown) => {
          if (!disposed) setActionError(String(reason));
        });
    }
    return () => {
      disposed = true;
      stopFocus?.();
      window.removeEventListener("storage", storage);
    };
  }, []);
  const hide = useCallback(() => {
    if (isTauriEnvironment())
      void getCurrentWindow()
        .hide()
        .catch((reason: unknown) => setActionError(String(reason)));
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isImeComposingEvent(event)) return;
      event.preventDefault();
      hide();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [hide]);
  const tasks = snapshot?.tasks.filter((task) => !task.completed) ?? [];
  const pending =
    (!snapshot && !error) || (snapshot?.scanning && tasks.length === 0);

  return (
    <main
      className="task-workspace task-tray ui-scaled"
      style={
        {
          fontFamily: getResolvedUiFontFamily(settings),
          "--ui-font-size": `${settings.uiFontSize}px`,
          "--ui-font-scale": `${settings.uiFontSize / defaultSettings.uiFontSize}`,
        } as CSSProperties
      }
    >
      <header className="task-tray-header">
        <h1>
          <ListTodo size={17} aria-hidden />
          {t("tasks_button")}
        </h1>
        <button type="button" aria-label={t("tasks_close")} onClick={hide}>
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="task-tray-content">
        {actionError || error || snapshot?.error ? (
          <p className="task-action-error" role="alert">
            {actionError || error || snapshot?.error}
          </p>
        ) : null}
        {pending ? (
          <p className="task-empty" role="status">
            {t("common_loading")}
          </p>
        ) : snapshot ? (
          <TaskListView
            tasks={tasks}
            now={now}
            filter="all"
            notifications={snapshot.preferences.notifications}
            onOpen={(task) => {
              setActionError(null);
              void openPathInNewAppWindow(task.filePath, { withVault: true })
                .then(hide)
                .catch((reason: unknown) => setActionError(String(reason)));
            }}
          />
        ) : null}
        {error ? (
          <button
            type="button"
            className="task-tray-retry"
            onClick={() => void reload()}
          >
            {t("errorBoundary_retry")}
          </button>
        ) : null}
      </div>
      <footer className="task-tray-footer">
        <button
          type="button"
          onClick={() => {
            setActionError(null);
            void invoke("task_calendar_open_app").catch((reason: unknown) =>
              setActionError(String(reason)),
            );
          }}
        >
          <BookOpen size={16} aria-hidden />
          <span>{t("tasks_openApp")}</span>
          <ArrowUpRight size={15} aria-hidden />
        </button>
      </footer>
      <UpdateInstallGuard />
    </main>
  );
}
