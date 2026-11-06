import { invoke } from "@tauri-apps/api/core";
import type {
  TaskCalendarPreferencesPatch,
  TaskCalendarSnapshot,
  MacCalendarAccess,
} from "../types/taskCalendar";

export function getMacCalendarAccess(
  requestAccess = false,
): Promise<MacCalendarAccess> {
  return invoke("task_calendar_macos_access", { requestAccess });
}

export function getTaskCalendarSnapshot(): Promise<TaskCalendarSnapshot> {
  return invoke("task_calendar_snapshot");
}
export function registerTaskCalendarVault(
  path: string,
  trashFolder: string,
): Promise<void> {
  return invoke("task_calendar_register_vault", { path, trashFolder });
}
export function unregisterTaskCalendarVault(path: string): Promise<void> {
  return invoke("task_calendar_unregister_vault", { path });
}
export function refreshTaskCalendar(path: string | null = null): Promise<void> {
  return invoke("task_calendar_refresh", { path });
}
export function saveTaskCalendarPreferences(
  preferences: TaskCalendarPreferencesPatch,
): Promise<void> {
  return invoke("task_calendar_set_preferences", { preferences });
}
export function saveTaskCalendarLanguage(language: string): Promise<void> {
  return invoke("task_calendar_set_language", { language });
}
export function sendTaskCalendarTestNotification(
  language: string,
): Promise<void> {
  return invoke("task_calendar_test_notification", { language });
}
/** 保存成功后单独通知日程，不依赖链接索引是否启用；失败由原生监测补齐。 */
export function notifyTaskCalendarFileSaved(path: string): void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window))
    return;
  void Promise.resolve()
    .then(() => refreshTaskCalendar(path))
    .catch((error: unknown) => {
      console.warn("更新待办日程失败，等待后台重新扫描：", error);
    });
}
