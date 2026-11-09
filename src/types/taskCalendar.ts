export interface CalendarTask {
  id: string;
  vaultPath: string;
  filePath: string;
  relativePath: string;
  title: string;
  completed: boolean;
  date: string | null;
  time: string | null;
  reminderAt: number | null;
  deadlineAt: number | null;
  dateError: boolean;
  line: number;
  start: number;
  end: number;
  rawLine: string;
  available: boolean;
}

export interface TaskCalendarPreferences {
  notifications: boolean;
  background: boolean;
  language: string;
  macCalendar: boolean;
  calendarId: string;
  reminderTimes?: string[];
}

export type TaskCalendarPreferencesPatch = Partial<
  Omit<TaskCalendarPreferences, "language">
>;

export interface TaskCalendarVault {
  path: string;
  name: string;
  trashFolder: string;
  unavailable: boolean;
}

export interface TaskCalendarSnapshot {
  version: number;
  tasks: CalendarTask[];
  vaults: TaskCalendarVault[];
  excludedVaults: string[];
  preferences: TaskCalendarPreferences;
  scanning: boolean;
  lastSyncedAt: number | null;
  error: string | null;
  calendarError: string | null;
  calendarSyncedAt: number | null;
}

export interface MacCalendarAccess {
  supported: boolean;
  permission:
    | "notDetermined"
    | "granted"
    | "denied"
    | "restricted"
    | "writeOnly"
    | "unsupported";
  calendars: Array<{ id: string; title: string; source: string }>;
  defaultCalendarId: string;
}

export type TaskFilter =
  | "all"
  | "today"
  | "upcoming"
  | "overdue"
  | "unscheduled"
  | "invalid";
