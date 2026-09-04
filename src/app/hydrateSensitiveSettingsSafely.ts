import { hydrateSensitiveSettingsIntoStore } from "../services/secureSettingsService";

/** 启动预热敏感设置：失败只打日志，不阻断后续流程。 */
export async function hydrateSensitiveSettingsSafely(): Promise<boolean> {
  try {
    await hydrateSensitiveSettingsIntoStore();
    return true;
  } catch (error) {
    console.warn("Failed to warm secure settings:", error);
    return false;
  }
}
