import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTaskCalendarStore } from "../store/taskCalendarStore";
import { isTauriEnvironment } from "../types/filesystem";
import { saveTaskCalendarLanguage } from "../services/taskCalendarService";

/** 只响应当前窗口实际的语言变化，不能把共享快照差异再次写回形成多窗反馈环。 */
export function useTaskCalendarLanguage(
  language: string,
  ready: boolean,
  onError: (error: string) => void,
): void {
  useEffect(() => {
    if (!ready) return;
    void saveTaskCalendarLanguage(language).catch((error: unknown) =>
      onError(String(error)),
    );
  }, [language, ready, onError]);
}

/** 提醒调度在 Rust 进程中进行，这里只同步界面，不创建页面提醒计时器。 */
export function useTaskCalendar(): void {
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    const stops: Array<() => void> = [];
    const subscribe = async () => {
      for (const event of ["task-calendar-changed", "task-calendar-open"]) {
        const stop = await listen(event, () => {
          const state = useTaskCalendarStore.getState();
          if (event === "task-calendar-open") state.open();
          if (state.isOpen || state.snapshot || event === "task-calendar-open")
            void state.reload();
        });
        if (disposed) stop();
        else stops.push(stop);
      }
      if (!disposed) await useTaskCalendarStore.getState().reload();
    };
    void subscribe().catch((error: unknown) => {
      if (!disposed) useTaskCalendarStore.setState({ error: String(error) });
    });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, []);
}
