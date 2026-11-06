import {
  ArrowUpRight,
  Bell,
  Circle,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileText,
} from "lucide-react";
import type { CalendarTask } from "../../types/taskCalendar";
import { useI18n } from "../../hooks/useI18n";
import { isTaskOverdue } from "./taskCalendarHelpers";

interface TaskItemProps {
  task: CalendarTask;
  now: number;
  notifications: boolean;
  showDate?: boolean;
  onOpen: (task: CalendarTask) => void;
}

export function TaskItem({
  task,
  now,
  notifications,
  showDate,
  onOpen,
}: TaskItemProps) {
  const { t } = useI18n();
  const overdue = isTaskOverdue(task, now);
  const Status = task.completed
    ? CircleCheck
    : overdue || task.dateError
      ? CircleAlert
      : Circle;
  return (
    <button
      type="button"
      className={
        "task-item" +
        (overdue ? " is-overdue" : "") +
        (task.completed ? " is-completed" : "")
      }
      onClick={() => onOpen(task)}
      disabled={!task.available}
      title={t("tasks_openSource")}
    >
      <Status size={16} className="task-item-status" aria-hidden />
      <span className="task-item-body">
        <strong>{task.title || t("tasks_untitled")}</strong>
        <span className="task-item-meta">
          <Clock3 size={12} aria-hidden />
          {showDate && task.date ? <span>{task.date}</span> : null}
          <span>
            {task.dateError
              ? t("tasks_invalid")
              : !task.date
                ? t("tasks_unscheduled")
                : task.time || t("tasks_allDay")}
          </span>
          {task.completed ? (
            <span>{t("tasks_completed")}</span>
          ) : overdue ? (
            <span className="task-overdue-text">{t("tasks_overdue")}</span>
          ) : null}
          {notifications &&
          !task.completed &&
          task.reminderAt !== null &&
          !task.dateError ? (
            <Bell size={12} aria-label={t("tasks_reminderScheduled")} />
          ) : null}
        </span>
        <span className="task-item-source">
          <FileText size={12} aria-hidden />
          <span>
            {task.relativePath}:{task.line}
          </span>
          <ArrowUpRight size={12} aria-hidden />
        </span>
        {!task.available ? (
          <span className="task-item-meta">{t("tasks_sourceUnavailable")}</span>
        ) : null}
      </span>
    </button>
  );
}
