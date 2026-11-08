import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarTask } from "../../types/taskCalendar";
import { useI18n } from "../../hooks/useI18n";
import {
  dateFromKey,
  isTaskOverdue,
  localDateKey,
  sortCalendarTasks,
} from "./taskCalendarHelpers";

interface TaskCalendarViewProps {
  tasks: CalendarTask[];
  selected: string;
  month: Date;
  now: number;
  onSelect: (date: string) => void;
  onMonth: (date: Date) => void;
}

export function TaskCalendarView({
  tasks,
  selected,
  month,
  now,
  onSelect,
  onMonth,
}: TaskCalendarViewProps) {
  const { language, t } = useI18n();
  const gridRef = useRef<HTMLDivElement>(null);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const today = localDateKey(new Date(now));
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  const labels = new Intl.DateTimeFormat(language, { weekday: "short" });
  const tasksByDate = new Map<string, CalendarTask[]>();
  for (const task of sortCalendarTasks(tasks)) {
    if (task.date && !task.dateError) {
      const list = tasksByDate.get(task.date) ?? [];
      list.push(task);
      tasksByDate.set(task.date, list);
    }
  }
  function changeMonth(delta: number) {
    const date = new Date(year, monthIndex + delta, 1);
    onMonth(date);
    onSelect(localDateKey(date));
  }
  return (
    <section className="task-calendar-main" aria-label={t("tasks_calendar")}>
      <div className="task-month-header">
        <h2>
          {new Intl.DateTimeFormat(language, {
            year: "numeric",
            month: "long",
          }).format(month)}
        </h2>
        <div className="task-month-controls">
          <button
            type="button"
            className="task-icon-button"
            onClick={() => changeMonth(-1)}
            aria-label={t("tasks_previousMonth")}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="task-small-button"
            onClick={() => {
              onMonth(new Date(now));
              onSelect(today);
            }}
          >
            {t("tasks_today")}
          </button>
          <button
            type="button"
            className="task-icon-button"
            onClick={() => changeMonth(1)}
            aria-label={t("tasks_nextMonth")}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>
      <div className="task-calendar-weekdays" aria-hidden>
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index}>{labels.format(new Date(2024, 0, 1 + index))}</span>
        ))}
      </div>
      <div className="task-calendar-grid" ref={gridRef}>
        {Array.from({ length: cells }, (_, index) => {
          const date = new Date(year, monthIndex, index - offset + 1);
          const key = localDateKey(date);
          const dayTasks = tasksByDate.get(key) ?? [];
          return (
            <div
              key={key}
              className={
                "task-calendar-day" +
                (key === selected ? " is-selected" : "") +
                (key === today ? " is-today" : "") +
                (date.getMonth() !== monthIndex ? " is-outside" : "")
              }
            >
              <button
                type="button"
                className="task-calendar-date"
                data-date={key}
                aria-pressed={key === selected}
                aria-label={
                  new Intl.DateTimeFormat(language, {
                    dateStyle: "full",
                  }).format(date) +
                  " · " +
                  t("tasks_count", { count: dayTasks.length })
                }
                onClick={() => onSelect(key)}
                onKeyDown={(event) => {
                  const delta = {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7,
                  }[event.key];
                  if (!delta) return;
                  event.preventDefault();
                  const next = dateFromKey(key);
                  next.setDate(next.getDate() + delta);
                  const nextKey = localDateKey(next);
                  onMonth(next);
                  onSelect(nextKey);
                  requestAnimationFrame(() =>
                    gridRef.current
                      ?.querySelector<HTMLButtonElement>(
                        '[data-date="' + nextKey + '"]',
                      )
                      ?.focus(),
                  );
                }}
              >
                <span className="task-calendar-day-number">
                  {date.getDate()}
                  {dayTasks.length ? (
                    <span className="task-calendar-count" aria-hidden="true">
                      {dayTasks.length > 99 ? "99+" : dayTasks.length}
                    </span>
                  ) : null}
                </span>
                {key === today ? <small>{t("tasks_today")}</small> : null}
              </button>
              <div className="task-calendar-events">
                {dayTasks.slice(0, 3).map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className={
                      "task-calendar-event" +
                      (task.completed ? " is-completed" : "") +
                      (isTaskOverdue(task, now) ? " is-overdue" : "")
                    }
                    onClick={() => onSelect(key)}
                    title={
                      (task.time || t("tasks_allDay")) + " · " + task.title
                    }
                  >
                    <span className="task-event-dot" />
                    <span>{task.title || t("tasks_untitled")}</span>
                  </button>
                ))}
                {dayTasks.length > 3 ? (
                  <button
                    type="button"
                    className="task-calendar-more"
                    onClick={() => onSelect(key)}
                  >
                    {t("tasks_more", { count: dayTasks.length - 3 })}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
