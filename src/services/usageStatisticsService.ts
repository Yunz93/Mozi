import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../types/filesystem";

export interface UsageStatisticsStatus {
  available: boolean;
  enabled: boolean;
}

export const USAGE_STATISTICS_CHANGED = "usage-statistics-changed";

export async function getUsageStatisticsStatus(): Promise<UsageStatisticsStatus> {
  if (!isTauriEnvironment()) return { available: false, enabled: false };
  return invoke("usage_statistics_status");
}

export function setUsageStatisticsEnabled(
  enabled: boolean,
): Promise<UsageStatisticsStatus> {
  return invoke("set_usage_statistics_enabled", { enabled });
}

export async function recordUsageStatisticsActivity(
  language: string,
): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke("record_usage_statistics_activity", { language });
}
