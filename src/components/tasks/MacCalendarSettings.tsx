import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { getMacCalendarAccess } from "../../services/taskCalendarService";
import type {
  MacCalendarAccess,
  TaskCalendarPreferences,
  TaskCalendarPreferencesPatch,
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
  onChange: (preferences: TaskCalendarPreferencesPatch) => void;
}) {
  const { t } = useI18n();
  const [access, setAccess] = useState<MacCalendarAccess | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const latestRequest = useRef(0);
  const enabling = useRef(false);
  const refresh = useCallback(async () => {
    if (enabling.current) return;
    const request = ++latestRequest.current;
    setPending(true);
    try {
      const next = await getMacCalendarAccess();
      if (request !== latestRequest.current) return;
      setAccess(next);
      setError(null);
    } catch (error) {
      if (request === latestRequest.current) setError(String(error));
    } finally {
      if (request === latestRequest.current) setPending(false);
    }
  }, []);
  useEffect(() => {
    const requests = latestRequest;
    void refresh();
    const update = () => void refresh();
    window.addEventListener("focus", update);
    return () => {
      requests.current++;
      window.removeEventListener("focus", update);
    };
  }, [refresh]);

  async function enable() {
    const request = ++latestRequest.current;
    enabling.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await getMacCalendarAccess(true);
      if (request !== latestRequest.current) return;
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
      if (request === latestRequest.current) setError(String(error));
    } finally {
      enabling.current = false;
      if (request === latestRequest.current) setPending(false);
    }
  }
  const issue = error || (preferences.macCalendar ? syncError : null);
  const calendarId = choosing ? selectedId : preferences.calendarId;
  const targetUnknown =
    calendarId &&
    !access?.calendars.some((calendar) => calendar.id === calendarId);
  const missing =
    targetUnknown && !pending && !error && access?.permission === "granted";
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
              if (preferences.macCalendar) onChange({ macCalendar: false });
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
                choosing ? setSelectedId(calendarId) : onChange({ calendarId })
              }
              disabled={busy || pending || !access?.calendars.length}
              className="task-calendar-target-select"
              aria-label={t("tasks_calendarTarget")}
              options={[
                ...(targetUnknown
                  ? [
                      {
                        value: calendarId,
                        label: t(
                          missing
                            ? "tasks_calendarUnavailable"
                            : pending || (!access && !error)
                              ? "tasks_syncing"
                              : "tasks_calendarTarget",
                        ),
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
          {!choosing && (
            <p className="task-settings-note" role="status">
              {pending
                ? t("tasks_syncing")
                : syncedAt && !syncError
                  ? t("tasks_calendarSynced")
                  : t("tasks_calendarPending")}
            </p>
          )}
          {access && !pending && access.permission !== "granted" ? (
            <p className="task-error">{t("tasks_calendarPermissionHint")}</p>
          ) : null}
        </>
      ) : null}
      {preferences.macCalendar ||
      choosing ||
      access?.permission === "granted" ? (
        <div
          className="task-calendar-actions"
          role="group"
          aria-label={t("tasks_calendarActions")}
        >
          {choosing && (
            <button
              type="button"
              className="task-primary-button"
              disabled={busy || pending || !calendarId || !!missing}
              onClick={() => {
                setChoosing(false);
                onChange({ macCalendar: true, calendarId });
              }}
            >
              {t("tasks_calendarStart")}
            </button>
          )}
          <button
            type="button"
            className="task-small-button"
            disabled={busy || pending}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} aria-hidden />
            {t("tasks_calendarRefresh")}
          </button>
        </div>
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
