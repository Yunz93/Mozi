import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../../types";
import { useI18n } from "../../../hooks/useI18n";
import { useTaskCalendarLanguage } from "../../../hooks/useTaskCalendar";
import { useAppStore } from "../../../store/appStore";
import { useTaskCalendarStore } from "../../../store/taskCalendarStore";
import { isTauriEnvironment } from "../../../types/filesystem";
import type { TaskCalendarPreferencesPatch } from "../../../types/taskCalendar";
import {
  registerTaskCalendarVault,
  saveTaskCalendarPreferences,
  sendTaskCalendarTestNotification,
  unregisterTaskCalendarVault,
} from "../../../services/taskCalendarService";
import { TaskReminderSettings } from "../../tasks/TaskReminderSettings";
import { taskVaultPathKey } from "../../tasks/taskCalendarHelpers";

export function TasksTab({ settings }: { settings: AppSettings }) {
  const { t, language } = useI18n();
  const { snapshot, error, loading, reload } = useTaskCalendarStore();
  const rootPath = useAppStore((state) => state.rootFolderPath);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const desktop = isTauriEnvironment();
  useTaskCalendarLanguage(
    language,
    desktop && !!snapshot?.version,
    setActionError,
  );
  useEffect(() => {
    if (desktop) void reload();
  }, [desktop, reload]);
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
  const issue = actionError || error || snapshot?.error || null;
  const notIncluded =
    rootPath &&
    snapshot &&
    !snapshot.vaults.some(
      (vault) => taskVaultPathKey(vault.path) === taskVaultPathKey(rootPath),
    );
  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("tasks_title")}
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("tasks_settingsDescription")}
        </p>
      </div>
      {!desktop ? (
        <p className="text-sm text-gray-500">{t("tasks_desktopOnlyHint")}</p>
      ) : !snapshot ? (
        <p role="status">{issue || t("tasks_syncing")}</p>
      ) : (
        <>
          {notIncluded ? (
            <button
              type="button"
              className="task-small-button"
              disabled={busy || loading}
              onClick={() =>
                void run(() =>
                  registerTaskCalendarVault(rootPath!, settings.trashFolder),
                )
              }
            >
              {t("tasks_includeCurrentVault")}
            </button>
          ) : null}
          <TaskReminderSettings
            preferences={snapshot.preferences}
            vaults={snapshot.vaults}
            busy={busy || loading}
            error={issue}
            calendarError={snapshot.calendarError}
            calendarSyncedAt={snapshot.calendarSyncedAt}
            onChange={(preferences: TaskCalendarPreferencesPatch) =>
              void run(() => saveTaskCalendarPreferences(preferences))
            }
            onTest={() =>
              void run(async () => {
                await sendTaskCalendarTestNotification(language);
                useAppStore
                  .getState()
                  .showNotification(t("tasks_testSent"), "info");
              })
            }
            onRemove={(path) =>
              void run(() => unregisterTaskCalendarVault(path))
            }
          />
        </>
      )}
    </section>
  );
}
