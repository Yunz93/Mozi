import { BellRing, MinusCircle } from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { useI18n } from "../../hooks/useI18n";
import { isMacOSPlatform } from "../../utils/platform";
import { MacCalendarSettings } from "./MacCalendarSettings";
import type {
  TaskCalendarPreferences,
  TaskCalendarVault,
} from "../../types/taskCalendar";

export function TaskReminderSettings({
  preferences,
  vaults,
  busy,
  error,
  onClose,
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
  onClose: () => void;
  onChange: (preferences: TaskCalendarPreferences) => void;
  onTest: () => void;
  onRemove: (path: string) => void;
  calendarError: string | null;
  calendarSyncedAt: number | null;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t("tasks_reminderSettings")}
      className="max-w-lg task-settings-dialog"
    >
      <div className="task-settings">
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
              onChange({ ...preferences, notifications: event.target.checked })
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
            onChange={(event) =>
              onChange({ ...preferences, background: event.target.checked })
            }
          />
        </label>
        <div className="task-setting-row">
          <span>{t("tasks_allDayReminder")}</span>
          <span>09:00</span>
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
    </Dialog>
  );
}
