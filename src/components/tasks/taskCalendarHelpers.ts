import type { CalendarTask, TaskFilter } from "../../types/taskCalendar";

/** Windows 原生路径可能带扩展前缀，仅在 Windows 路径上忽略大小写。 */
export function taskVaultPathKey(path: string): string {
  const value =
    path
      .replace(/\\/g, "/")
      .replace(/^\/\/\?\/UNC\//i, "//")
      .replace(/^\/\/\?\//, "")
      .replace(/\/+$/, "") || "/";
  return /^[a-z]:\//i.test(value) || value.startsWith("//")
    ? value.toLowerCase()
    : value;
}

export function localDateKey(date: Date): string {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}
export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}
export function isTaskOverdue(task: CalendarTask, now: number): boolean {
  return (
    !task.completed &&
    !task.dateError &&
    task.deadlineAt !== null &&
    task.deadlineAt <= now
  );
}
export function matchesTaskFilter(
  task: CalendarTask,
  filter: TaskFilter,
  now: number,
): boolean {
  const date = new Date(now);
  const today = localDateKey(date);
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 7,
  );
  switch (filter) {
    case "today":
      return task.date === today && !task.dateError && !task.completed;
    case "upcoming":
      return (
        !task.completed &&
        !task.dateError &&
        !!task.date &&
        task.date > today &&
        task.date <= localDateKey(lastDay)
      );
    case "overdue":
      return isTaskOverdue(task, now);
    case "unscheduled":
      return !task.date && !task.dateError && !task.completed;
    case "invalid":
      return task.dateError && !task.completed;
    default:
      return true;
  }
}
export function sortCalendarTasks(tasks: CalendarTask[]): CalendarTask[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.date || "9999").localeCompare(b.date || "9999") ||
      (a.time || "").localeCompare(b.time || "") ||
      a.relativePath.localeCompare(b.relativePath) ||
      a.line - b.line,
  );
}
/** 跨库打开任务前先保存旧工作区，再载入来源知识库的完整上下文。 */
export async function prepareTaskSourceVault(
  currentRoot: string | null,
  targetRoot: string,
  flushTabs: () => Promise<boolean>,
  openVault: (
    path: string,
    options: {
      silentSuccess: true;
      skipSampleNotes: true;
      restoreLastOpenedFile: false;
    },
  ) => Promise<string | null>,
): Promise<boolean> {
  if (
    currentRoot &&
    taskVaultPathKey(currentRoot) === taskVaultPathKey(targetRoot)
  )
    return true;
  if (!(await flushTabs())) return false;
  return Boolean(
    await openVault(targetRoot, {
      silentSuccess: true,
      skipSampleNotes: true,
      restoreLastOpenedFile: false,
    }),
  );
}

/** 先匹配当前缓冲区中的完整任务行，避免磁盘偏移覆盖未保存编辑。 */
export function findTaskRange(
  content: string,
  task: CalendarTask,
): { start: number; end: number } | null {
  let offset = 0;
  const matches: Array<{ start: number; end: number }> = [];
  for (const line of content.split("\n")) {
    const clean = line.replace(/\r$/, "");
    const comparable = offset === 0 ? clean.replace(/^\uFEFF/, "") : clean;
    if (comparable === task.rawLine)
      matches.push({ start: offset, end: offset + clean.length });
    offset += line.length + 1;
  }
  if (matches.length === 1) return matches[0];
  // 同一行重复时仅接受原位置仍完全匹配的情形。
  return matches.find((match) => match.start === task.start) ?? null;
}
