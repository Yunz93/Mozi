import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { getMacCalendarAccess } from "../../services/taskCalendarService";
import type {
  MacCalendarAccess,
  TaskCalendarPreferences,
} from "../../types/taskCalendar";
import { AppSelect } from "../ui/AppSelect";

export function MacCalendarSettings({
  preferences,
  busy,
  syncError,
  syncedAt,
  onChange,
}: {
  preferences: TaskCalendarPreferences;
  busy: boolean;
  syncError: string | null;
  syncedAt: number | null;
  onChange: (preferences: TaskCalendarPreferences) => void;
}) {
  const { t } = useI18n();
  const [access, setAccess] = useState<MacCalendarAccess | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const refresh = useCallback(async () => {
    setPending(true);
    try {
      setAccess(await getMacCalendarAccess());
      setError(null);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => void refresh();
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, [refresh]);

  async function enable() {
    setPending(true);
    setError(null);
    try {
      const next = await getMacCalendarAccess(true);
      setAccess(next);
      if (next.permission !== "granted") {
        setError(t("tasks_calendarPermissionHint"));
        return;
      }
      const calendarId =
        [preferences.calendarId, next.defaultCalendarId].find((id) =>
          next.calendars.some((calendar) => calendar.id === id),
        ) ?? next.calendars[0]?.id;
      if (!calendarId) {
        setError(t("tasks_calendarEmpty"));
        return;
      }
      // 先让用户选定目标，避免刚授权就把待办写入系统默认日历。
      setSelectedId(calendarId);
      setChoosing(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }
  const issue = error || (preferences.macCalendar ? syncError : null);
  const calendarId = choosing ? selectedId : preferences.calendarId;
  const missing =
    calendarId &&
    !access?.calendars.some((calendar) => calendar.id === calendarId);
  return (
    <div className="task-mac-calendar">
      <label className="task-setting-row">
        <span>
          {t("tasks_macCalendar")}
          <small>{t("tasks_macCalendarHint")}</small>
        </span>
        <input
          type="checkbox"
          className="task-toggle"
          checked={preferences.macCalendar || choosing}
          disabled={busy || pending}
          onChange={(event) => {
            if (event.target.checked) void enable();
            else {
              setChoosing(false);
              if (preferences.macCalendar)
                onChange({ ...preferences, macCalendar: false });
            }
          }}
        />
      </label>
      {preferences.macCalendar || choosing ? (
        <>
          <div className="task-setting-row">
            <span>{t("tasks_calendarTarget")}</span>
            <AppSelect
              value={calendarId}
              onChange={(calendarId) =>
                choosing
                  ? setSelectedId(calendarId)
                  : onChange({ ...preferences, calendarId })
              }
              disabled={busy || pending || !access?.calendars.length}
              className="task-calendar-target-select"
              aria-label={t("tasks_calendarTarget")}
              options={[
                ...(missing
                  ? [
                      {
                        value: calendarId,
                        label: t("tasks_calendarUnavailable"),
                        disabled: true,
                      },
                    ]
                  : []),
                ...(access?.calendars ?? []).map((calendar) => ({
                  value: calendar.id,
                  label:
                    calendar.title +
                    (calendar.source ? " · " + calendar.source : ""),
                })),
              ]}
            />
          </div>
          {choosing ? (
            <button
              type="button"
              className="task-primary-button"
              disabled={busy || pending || !calendarId || !!missing}
              onClick={() => {
                setChoosing(false);
                onChange({ ...preferences, macCalendar: true, calendarId });
              }}
            >
              {t("tasks_calendarStart")}
            </button>
          ) : (
            <p className="task-settings-note" role="status">
              {pending
                ? t("tasks_syncing")
                : syncedAt && !syncError
                  ? t("tasks_calendarSynced")
                  : t("tasks_calendarPending")}
            </p>
          )}
          {access && access.permission !== "granted" ? (
            <p className="task-error">{t("tasks_calendarPermissionHint")}</p>
          ) : null}
        </>
      ) : null}
      {preferences.macCalendar ||
      choosing ||
      access?.permission === "granted" ? (
        <button
          type="button"
          className="task-small-button"
          disabled={busy || pending}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} aria-hidden />
          {t("tasks_calendarRefresh")}
        </button>
      ) : null}
      <p className="task-settings-note">{t("tasks_calendarBoundary")}</p>
      {issue ? (
        <p className="task-error" role="alert">
          {issue}
        </p>
      ) : null}
    </div>
  );
}
