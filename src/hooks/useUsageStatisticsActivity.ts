import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriEnvironment } from "../types/filesystem";
import {
  recordUsageStatisticsActivity,
  USAGE_STATISTICS_CHANGED,
} from "../services/usageStatisticsService";

export function useUsageStatisticsActivity(
  language: string,
  ready: boolean,
): void {
  useEffect(() => {
    if (!ready || !isTauriEnvironment()) return;
    let disposed = false;
    const record = () => {
      if (
        disposed ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        !navigator.onLine
      )
        return;
      // 原生层统一检查同意状态和日期，界面无需持有用户标识。
      void recordUsageStatisticsActivity(language).catch(() => {});
    };
    record();
    window.addEventListener("focus", record);
    window.addEventListener("online", record);
    document.addEventListener("visibilitychange", record);
    const timer = window.setInterval(record, 60_000);
    const subscription = listen(USAGE_STATISTICS_CHANGED, record).catch(
      () => null,
    );
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", record);
      window.removeEventListener("online", record);
      document.removeEventListener("visibilitychange", record);
      void subscription.then((unlisten) => unlisten?.());
    };
  }, [language, ready]);
}
