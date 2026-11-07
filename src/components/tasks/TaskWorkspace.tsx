import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Settings2,
  CalendarDays,
  CheckCheck,
  FilePenLine,
  List,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useTaskCalendarStore } from "../../store/taskCalendarStore";
import { isTauriEnvironment } from "../../types/filesystem";
import { useTaskCalendarLanguage } from "../../hooks/useTaskCalendar";
import { isImeComposingEvent } from "../../utils/imeKeyboard";
import type { CalendarTask, TaskFilter } from "../../types/taskCalendar";
import { AppSelect } from "../ui/AppSelect";
import {
  getTaskCalendarSnapshot,
  refreshTaskCalendar,
  registerTaskCalendarVault,
} from "../../services/taskCalendarService";
import { TaskCalendarView } from "./TaskCalendarView";
import { TaskItem } from "./TaskItem";
import { TASK_FILTER_LABELS, TaskListView } from "./TaskListView";
import {
  dateFromKey,
  localDateKey,
  matchesTaskFilter,
  sortCalendarTasks,
  taskVaultPathKey,
} from "./taskCalendarHelpers";

export function TaskWorkspace({
  rootPath,
  trashFolder,
  hasUnsavedChanges,
  onOpenTask,
  onClose,
  onOpenSettings,
}: {
  rootPath: string | null;
  trashFolder: string;
  hasUnsavedChanges: boolean;
  onOpenTask: (task: CalendarTask) => Promise<void>;
  onClose: (restoreFocus?: boolean) => void;
  onOpenSettings?: () => void;
}) {
  const { t, language } = useI18n();
  const { snapshot, error, loading, reload } = useTaskCalendarStore();
  const [now, setNow] = useState(Date.now);
  const [selected, setSelected] = useState(() => localDateKey(new Date()));
  const [month, setMonth] = useState(() => new Date());
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        !panelRef.current?.contains(target) &&
        !target.closest?.(".app-select-menu, [data-task-calendar-trigger]")
      )
        onCloseRef.current(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        isImeComposingEvent(event) ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    const frame = requestAnimationFrame(() =>
      panelRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);
  const desktop = isTauriEnvironment();
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        await reload();
      } catch (error) {
        setActionError(String(error));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const initialize = async () => {
      setBusy(true);
      try {
        const initial = await getTaskCalendarSnapshot();
        if (
          rootPath &&
          !initial.excludedVaults.some(
            (path) => taskVaultPathKey(path) === taskVaultPathKey(rootPath),
          ) &&
          !initial.vaults.some(
            (vault) =>
              taskVaultPathKey(vault.path) === taskVaultPathKey(rootPath) &&
              vault.trashFolder === trashFolder,
          )
        )
          await registerTaskCalendarVault(rootPath, trashFolder);
        await reload();
      } catch (error) {
        if (!disposed) setActionError(String(error));
      } finally {
        if (!disposed) setBusy(false);
      }
    };
    void initialize();
    return () => {
      disposed = true;
    };
  }, [desktop, reload, rootPath, trashFolder]);

  useTaskCalendarLanguage(
    language,
    desktop && !!snapshot?.version,
    setActionError,
  );

  useEffect(() => {
    // 仅刷新日期和逾期标签，系统提醒由 Rust 负责。
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const update = () => setNow(Date.now());
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);

  const tasks = useMemo(
    () =>
      sortCalendarTasks(
        (snapshot?.tasks ?? []).filter(
          (task) =>
            (scope === "all" || task.vaultPath === scope) &&
            (showCompleted || !task.completed) &&
            (!search ||
              (task.title + " " + task.relativePath)
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase())),
        ),
      ),
    [snapshot?.tasks, scope, showCompleted, search],
  );
  const active = tasks.filter((task) => !task.completed);
  const filters: TaskFilter[] = [
    "all",
    "overdue",
    "today",
    "upcoming",
    "unscheduled",
    "invalid",
  ];
  const selectedTasks = tasks.filter(
    (task) => task.date === selected && !task.dateError,
  );
  const preferences = snapshot?.preferences ?? {
    notifications: false,
    background: false,
    language,
    macCalendar: false,
    calendarId: "",
  };
  const issue = actionError || error || snapshot?.error;
  const notIncluded =
    !!rootPath &&
    snapshot &&
    !snapshot.vaults.some(
      (vault) => taskVaultPathKey(vault.path) === taskVaultPathKey(rootPath),
    );
  function setTaskFilter(next: TaskFilter) {
    setFilter(next);
    if (next !== "all") setView("list");
  }
  function openTask(task: CalendarTask) {
    void run(() => onOpenTask(task));
  }
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      className="task-workspace task-popover ui-scaled"
      aria-label={t("tasks_button")}
    >
      <header className="task-workspace-header">
        <div className="task-workspace-heading">
          <h1>{t("tasks_button")}</h1>
          <span className="task-sync" role="status">
            {busy || loading || snapshot?.scanning ? (
              <>
                <LoaderCircle size={13} className="task-spinner" aria-hidden />
                {t("tasks_syncing")}
              </>
            ) : (
              <>
                <CheckCheck size={13} aria-hidden />
                {t(hasUnsavedChanges ? "tasks_waitingSave" : "tasks_synced")}
              </>
            )}
          </span>
        </div>
        <div className="task-workspace-actions">
          <div className="task-view-switch" aria-label={t("tasks_view")}>
            <button
              type="button"
              aria-pressed={view === "calendar"}
              onClick={() => {
                setView("calendar");
                setFilter("all");
              }}
            >
              <CalendarDays size={14} aria-hidden />
              {t("tasks_calendar")}
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List size={14} aria-hidden />
              {t("tasks_list")}
            </button>
          </div>
          {onOpenSettings ? (
            <button
              type="button"
              className="task-icon-button"
              onClick={onOpenSettings}
              title={t("tasks_openSettings")}
              aria-label={t("tasks_openSettings")}
            >
              <Settings2 size={16} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="task-icon-button"
            onClick={() => onClose()}
            title={t("tasks_close")}
            aria-label={t("tasks_close")}
          >
            <X size={17} aria-hidden />
          </button>
        </div>
      </header>
      {!desktop ? (
        <div className="task-empty">
          <CalendarDays size={26} aria-hidden />
          <h2>{t("tasks_desktopOnly")}</h2>
          <p>{t("tasks_desktopOnlyHint")}</p>
        </div>
      ) : !snapshot ? (
        <p className="task-empty" role="status">
          {issue || t("tasks_syncing")}
        </p>
      ) : (
        <>
          <div className="task-workspace-content">
            <div className="task-workspace-tools">
              <AppSelect
                value={scope}
                onChange={setScope}
                aria-label={t("tasks_vaultScope")}
                className="task-vault-select"
                options={[
                  { value: "all", label: t("tasks_allVaults") },
                  ...(snapshot?.vaults ?? []).map((vault) => ({
                    value: vault.path,
                    label:
                      vault.name +
                      (vault.unavailable
                        ? " · " + t("tasks_sourceUnavailable")
                        : ""),
                  })),
                ]}
              />
              <label className="task-search">
                <Search size={15} aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("tasks_search")}
                  aria-label={t("tasks_search")}
                />
              </label>
              <button
                type="button"
                className="task-icon-button"
                disabled={busy}
                onClick={() => void run(() => refreshTaskCalendar())}
                title={t("tasks_refresh")}
                aria-label={t("tasks_refresh")}
              >
                <RefreshCw size={15} aria-hidden />
              </button>
            </div>
            <nav className="task-filters" aria-label={t("tasks_filter")}>
              {filters.map((value) => {
                const count =
                  value === "all"
                    ? active.length
                    : active.filter((task) =>
                        matchesTaskFilter(task, value, now),
                      ).length;
                if (value === "invalid" && count === 0) return null;
                return (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={filter === value}
                    className={
                      value === "overdue" && count ? "task-overdue-text" : ""
                    }
                    onClick={() => setTaskFilter(value)}
                  >
                    {t(TASK_FILTER_LABELS[value])}
                    <span>{count}</span>
                  </button>
                );
              })}
            </nav>
            {hasUnsavedChanges ? (
              <p className="task-workspace-note">{t("tasks_unsavedHint")}</p>
            ) : null}
            {issue ? (
              <p className="task-error" role="alert">
                {t("tasks_syncError")} {issue}
              </p>
            ) : null}
            {snapshot?.preferences.macCalendar && snapshot.calendarError ? (
              <p className="task-error" role="alert">
                {t("tasks_calendarSyncError")} {snapshot.calendarError}
              </p>
            ) : null}
            {notIncluded ? (
              <button
                type="button"
                className="task-small-button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    registerTaskCalendarVault(rootPath!, trashFolder),
                  )
                }
              >
                {t("tasks_includeCurrentVault")}
              </button>
            ) : null}
            {view === "calendar" ? (
              <div className="task-calendar-layout">
                <TaskCalendarView
                  tasks={tasks}
                  selected={selected}
                  month={month}
                  now={now}
                  onSelect={setSelected}
                  onMonth={setMonth}
                />
                <aside className="task-day-panel">
                  <h2>
                    {new Intl.DateTimeFormat(language, {
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    }).format(dateFromKey(selected))}
                  </h2>
                  <p className="task-day-caption">
                    {t("tasks_count", { count: selectedTasks.length })}
                  </p>
                  <div className="task-day-items">
                    {selectedTasks.map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        now={now}
                        notifications={preferences.notifications}
                        onOpen={openTask}
                      />
                    ))}
                  </div>
                  {!selectedTasks.length ? (
                    <p className="task-empty">{t("tasks_dayEmpty")}</p>
                  ) : null}
                  <p className="task-source-hint">
                    <FilePenLine size={14} aria-hidden />
                    {t("tasks_sourceHint")}
                  </p>
                </aside>
              </div>
            ) : (
              <TaskListView
                tasks={tasks}
                now={now}
                filter={filter}
                notifications={preferences.notifications}
                onOpen={openTask}
              />
            )}
            <div className="task-workspace-bottom">
              <span>{t("tasks_timeSyntax")}</span>
              <label>
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(event) => setShowCompleted(event.target.checked)}
                />
                {t("tasks_showCompleted")}
              </label>
            </div>
            {snapshot &&
            snapshot.tasks.length === 0 &&
            !busy &&
            !snapshot.scanning ? (
              <div className="task-empty-help">
                <p>{t("tasks_emptyHint")}</p>
                <code>
                  - [ ] {t("tasks_exampleTask")} @
                  {localDateKey(new Date(now + 86_400_000))} 15:00
                </code>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
