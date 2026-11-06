import type { CalendarTask, TaskFilter } from "../../types/taskCalendar";
import { useI18n } from "../../hooks/useI18n";
import {
  isTaskOverdue,
  localDateKey,
  matchesTaskFilter,
  sortCalendarTasks,
} from "./taskCalendarHelpers";
import { TaskItem } from "./TaskItem";
import type { TranslationKey } from "../../utils/i18n";

export const TASK_FILTER_LABELS: Record<TaskFilter, TranslationKey> = {
  all: "tasks_all",
  today: "tasks_today",
  upcoming: "tasks_upcoming",
  overdue: "tasks_overdue",
  unscheduled: "tasks_unscheduled",
  invalid: "tasks_invalid",
};

export function TaskListView({
  tasks,
  now,
  filter,
  notifications,
  onOpen,
}: {
  tasks: CalendarTask[];
  now: number;
  filter: TaskFilter;
  notifications: boolean;
  onOpen: (task: CalendarTask) => void;
}) {
  const { t } = useI18n();
  const selected = sortCalendarTasks(
    tasks.filter((task) => matchesTaskFilter(task, filter, now)),
  );
  const groups = new Map<TranslationKey, CalendarTask[]>();
  const today = localDateKey(new Date(now));
  for (const task of selected) {
    const key: TranslationKey = task.completed
      ? "tasks_completed"
      : task.dateError
        ? "tasks_invalid"
        : isTaskOverdue(task, now)
          ? "tasks_overdue"
          : task.date === today
            ? "tasks_today"
            : !task.date
              ? "tasks_unscheduled"
              : "tasks_scheduled";
    const list = groups.get(key) ?? [];
    list.push(task);
    groups.set(key, list);
  }
  return (
    <section className="task-list-view">
      <div className="task-list-heading">
        <h2>{t(TASK_FILTER_LABELS[filter])}</h2>
        <span>{t("tasks_count", { count: selected.length })}</span>
      </div>
      {selected.length === 0 ? (
        <p className="task-empty">{t("tasks_noMatches")}</p>
      ) : null}
      {[...groups].map(([key, list]) => (
        <section key={key}>
          <h3 className="task-group-heading">{t(key)}</h3>
          {list.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              now={now}
              showDate
              notifications={notifications}
              onOpen={onOpen}
            />
          ))}
        </section>
      ))}
    </section>
  );
}
