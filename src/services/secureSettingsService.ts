import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";
import { useAppStore } from "../store/appStore";
import { isTauriEnvironment } from "../types/filesystem";
import {
  SENSITIVE_SETTING_KEYS,
  type SensitiveSettingKey,
} from "./sensitiveSettingKeys";

const SETTINGS_STORAGE_KEY = "markdown-press-settings";

export { SENSITIVE_SETTING_KEYS, type SensitiveSettingKey };
export type SensitiveSettings = Pick<AppSettings, SensitiveSettingKey>;

interface SecureSettingsPayload {
  blogGithubToken?: string | null;
  wechatAppSecret?: string | null;
  geminiApiKey?: string | null;
  codexApiKey?: string | null;
  deepseekApiKey?: string | null;
  imageHostingGithubToken?: string | null;
  imageHostingS3SecretAccessKey?: string | null;
  imageHostingOssAccessKeySecret?: string | null;
  imageHostingQiniuSecretKey?: string | null;
  embeddingApiKey?: string | null;
}

const secureWriteQueue = new Map<SensitiveSettingKey, Promise<void>>();
let secureHydrationPromise: Promise<Partial<SensitiveSettings>> | null = null;
let secureSettingsCache: Partial<SensitiveSettings> | null = null;
let hasLoadedSecureSettingsFromBackend = false;

function normalizeSecretValue(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

async function ensureSecureSettingsBackendReady(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  if (!isTauriEnvironment()) {
    return false;
  }

  return true;
}

async function invokeSecureSettingsCommand<T>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  const ready = await ensureSecureSettingsBackendReady();
  if (!ready) {
    throw new Error("Secure settings backend is unavailable.");
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Secure settings request failed: ${message}`);
  }
}

function scrubSensitiveSettingsInObject(target: unknown): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }

  let changed = false;
  const record = target as Record<string, unknown>;

  if (record.settings && typeof record.settings === "object") {
    changed = scrubSensitiveSettingsInObject(record.settings) || changed;
  }

  if (record.state && typeof record.state === "object") {
    changed = scrubSensitiveSettingsInObject(record.state) || changed;
  }

  SENSITIVE_SETTING_KEYS.forEach((key) => {
    if (key in record) {
      delete record[key];
      changed = true;
    }
  });

  return changed;
}

export function scrubSensitiveSettingsFromLocalStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!scrubSensitiveSettingsInObject(parsed)) {
      return;
    }
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
  } catch (error) {
    console.warn(
      "Failed to scrub sensitive settings from localStorage:",
      error,
    );
  }
}

export async function loadSecureSettings(): Promise<
  Partial<SensitiveSettings>
> {
  scrubSensitiveSettingsFromLocalStorage();

  if (hasLoadedSecureSettingsFromBackend && secureSettingsCache) {
    return { ...secureSettingsCache };
  }

  try {
    const payload = await invokeSecureSettingsCommand<SecureSettingsPayload>(
      "get_secure_settings",
    );
    secureSettingsCache = {
      blogGithubToken: normalizeSecretValue(payload.blogGithubToken),
      wechatAppSecret: normalizeSecretValue(payload.wechatAppSecret),
      geminiApiKey: normalizeSecretValue(payload.geminiApiKey),
      codexApiKey: normalizeSecretValue(payload.codexApiKey),
      deepseekApiKey: normalizeSecretValue(payload.deepseekApiKey),
      imageHostingGithubToken: normalizeSecretValue(
        payload.imageHostingGithubToken,
      ),
      imageHostingS3SecretAccessKey: normalizeSecretValue(
        payload.imageHostingS3SecretAccessKey,
      ),
      imageHostingOssAccessKeySecret: normalizeSecretValue(
        payload.imageHostingOssAccessKeySecret,
      ),
      imageHostingQiniuSecretKey: normalizeSecretValue(
        payload.imageHostingQiniuSecretKey,
      ),
      embeddingApiKey: normalizeSecretValue(payload.embeddingApiKey),
    };
    hasLoadedSecureSettingsFromBackend = true;
    return { ...secureSettingsCache };
  } catch (error) {
    console.warn("Failed to load secure settings:", error);
    return {};
  }
}

export async function persistSecureSetting(
  key: SensitiveSettingKey,
  value: string,
): Promise<void> {
  scrubSensitiveSettingsFromLocalStorage();

  const previousWrite = secureWriteQueue.get(key) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch((e) => console.warn("Previous secure write failed:", e))
    .then(async () => {
      const trimmed = value.trim();
      await invokeSecureSettingsCommand("set_secure_secret", {
        key,
        value: trimmed ? trimmed : null,
      });
      secureSettingsCache = {
        ...(secureSettingsCache ?? {}),
        [key]: trimmed,
      };
    });

  secureWriteQueue.set(key, nextWrite);

  try {
    await nextWrite;
  } finally {
    if (secureWriteQueue.get(key) === nextWrite) {
      secureWriteQueue.delete(key);
    }
  }
}

export async function migrateLegacySensitiveSettings(
  settings: AppSettings,
): Promise<Partial<SensitiveSettings>> {
  const secureBackendReady = await ensureSecureSettingsBackendReady();
  const loaded = secureBackendReady ? await loadSecureSettings() : {};
  const next: Partial<SensitiveSettings> = { ...loaded };

  for (const key of SENSITIVE_SETTING_KEYS) {
    const legacyValue = typeof settings[key] === "string" ? settings[key] : "";
    const secureValue = typeof loaded[key] === "string" ? loaded[key] : "";

    if (!secureValue && legacyValue.trim() && secureBackendReady) {
      await persistSecureSetting(key, legacyValue);
      next[key] = legacyValue;
      continue;
    }

    next[key] = secureValue || legacyValue || "";
  }

  scrubSensitiveSettingsFromLocalStorage();
  return next;
}

export async function hydrateSensitiveSettingsIntoStore(
  settings: AppSettings = useAppStore.getState().settings,
): Promise<AppSettings> {
  const backendReady = await ensureSecureSettingsBackendReady();

  if (hasLoadedSecureSettingsFromBackend) {
    return useAppStore.getState().settings;
  }

  if (!secureHydrationPromise) {
    secureHydrationPromise = migrateLegacySensitiveSettings(settings)
      .then((secureSettings) => {
        secureSettingsCache = { ...secureSettings };
        useAppStore.getState().updateSettings(secureSettings);
        return secureSettings;
      })
      .finally(() => {
        secureHydrationPromise = null;
      });
  }

  await secureHydrationPromise;

  if (!hasLoadedSecureSettingsFromBackend && backendReady) {
    const loaded = await loadSecureSettings();
    if (hasLoadedSecureSettingsFromBackend) {
      useAppStore.getState().updateSettings(loaded);
    }
  }

  return useAppStore.getState().settings;
}
