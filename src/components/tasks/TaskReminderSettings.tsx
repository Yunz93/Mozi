import { useState } from "react";
import { BellRing, MinusCircle, Plus, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { isMacOSPlatform } from "../../utils/platform";
import { MacCalendarSettings } from "./MacCalendarSettings";
import type {
  TaskCalendarPreferences,
  TaskCalendarPreferencesPatch,
  TaskCalendarVault,
} from "../../types/taskCalendar";

export function TaskReminderSettings({
  preferences,
  vaults,
  busy,
  error,
  onChange,
  onTest,
  onRemove,
  calendarError,
  calendarSyncedAt,
}: {
  preferences: TaskCalendarPreferences;
  vaults: TaskCalendarVault[];
  busy: boolean;
  error: string | null;
  onChange: (preferences: TaskCalendarPreferencesPatch) => void;
  onTest: () => void;
  onRemove: (path: string) => void;
  calendarError: string | null;
  calendarSyncedAt: number | null;
}) {
  const { t } = useI18n();
  const [newTime, setNewTime] = useState("18:00");
  const reminderTimes = preferences.reminderTimes ?? ["09:00"];
  return (
    <div className="task-settings task-settings-inline">
      <label className="task-setting-row">
        <span>
          {t("tasks_systemNotifications")}
          <small>{t("tasks_systemNotificationsHint")}</small>
        </span>
        <input
          type="checkbox"
          className="task-toggle"
          checked={preferences.notifications}
          disabled={busy}
          onChange={(event) =>
            onChange({ notifications: event.target.checked })
          }
        />
      </label>
      <label className="task-setting-row">
        <span>
          {t("tasks_background")}
          <small>{t("tasks_backgroundHint")}</small>
        </span>
        <input
          type="checkbox"
          className="task-toggle"
          checked={preferences.background}
          disabled={busy}
          onChange={(event) => onChange({ background: event.target.checked })}
        />
      </label>
      <div className="task-setting-row task-reminder-times-row">
        <span>
          {t("tasks_allDayReminder")}
          <small>{t("tasks_reminderTimesHint")}</small>
        </span>
        <div className="task-reminder-times">
          <div className="task-reminder-time-list">
            {reminderTimes.map((time) => (
              <span className="task-reminder-time" key={time}>
                <time>{time}</time>
                <button
                  type="button"
                  className="task-icon-button"
                  disabled={busy || reminderTimes.length <= 1}
                  aria-label={t("tasks_removeReminderTime", { time })}
                  onClick={() =>
                    onChange({
                      reminderTimes: reminderTimes.filter(
                        (item) => item !== time,
                      ),
                    })
                  }
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            ))}
          </div>
          <div className="task-reminder-time-add">
            <input
              type="time"
              step={60}
              value={newTime}
              disabled={busy}
              aria-label={t("tasks_reminderTime")}
              onChange={(event) => setNewTime(event.target.value)}
            />
            <button
              type="button"
              className="task-icon-button"
              disabled={
                busy ||
                !/^\d{2}:\d{2}$/.test(newTime) ||
                reminderTimes.includes(newTime)
              }
              aria-label={t("tasks_addReminderTime")}
              title={t("tasks_addReminderTime")}
              onClick={() =>
                onChange({
                  reminderTimes: [
                    ...new Set([...reminderTimes, newTime]),
                  ].sort(),
                })
              }
            >
              <Plus size={16} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <p className="task-settings-note">{t("tasks_notificationBoundary")}</p>
      <button
        type="button"
        className="task-primary-button"
        onClick={onTest}
        disabled={busy}
      >
        <BellRing size={15} aria-hidden />
        {t("tasks_testNotification")}
      </button>
      {isMacOSPlatform() ? (
        <MacCalendarSettings
          preferences={preferences}
          busy={busy}
          syncError={calendarError}
          syncedAt={calendarSyncedAt}
          onChange={onChange}
        />
      ) : null}
      <h3>{t("tasks_includedVaults")}</h3>
      {vaults.map((vault) => (
        <div className="task-setting-row" key={vault.path}>
          <span>
            {vault.name}
            <small className="task-vault-path">{vault.path}</small>
          </span>
          <button
            type="button"
            className="task-icon-button"
            disabled={busy}
            onClick={() => onRemove(vault.path)}
            title={t("tasks_stopIncluding")}
            aria-label={t("tasks_stopIncluding") + ": " + vault.name}
          >
            <MinusCircle size={16} aria-hidden />
          </button>
        </div>
      ))}
      <p className="task-settings-note">{t("tasks_removeVaultHint")}</p>
      {error ? (
        <p className="task-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
