/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../types/filesystem", () => ({ isTauriEnvironment: () => true }));

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  localStorage.clear();
});

async function fixture() {
  const { defaultSettings } = await import("../store/appStore");
  const settings = {
    ...defaultSettings,
    imageHosting: {
      ...defaultSettings.imageHosting,
      custom: {
        ...defaultSettings.imageHosting.custom,
        headers: '{"Authorization":"Bearer legacy"}',
      },
    },
  };
  const persisted = JSON.stringify({ state: { settings } });
  localStorage.setItem("markdown-press-settings", persisted);
  localStorage.setItem("markdown-press-settings.bak", persisted);
  return settings;
}

describe("custom image hosting secret migration", () => {
  it("loads custom authentication headers from the secure backend", async () => {
    invoke.mockResolvedValue({
      imageHostingCustomHeaders: '{"Authorization":"Bearer secure"}',
    });
    const { loadSecureSettings } = await import("./secureSettingsService");
    expect(await loadSecureSettings()).toHaveProperty(
      "imageHostingCustomHeaders",
      '{"Authorization":"Bearer secure"}',
    );
  });

  it("migrates legacy headers before scrubbing the settings and backup", async () => {
    const settings = await fixture();
    invoke.mockImplementation(async (command: string) =>
      command === "get_secure_settings" ? {} : undefined,
    );
    const { migrateLegacySensitiveSettings } =
      await import("./secureSettingsService");
    const migrated = await migrateLegacySensitiveSettings(settings);
    expect(invoke).toHaveBeenCalledWith("set_secure_secret", {
      key: "imageHostingCustomHeaders",
      value: settings.imageHosting.custom.headers,
    });
    expect(migrated).toHaveProperty(
      "imageHostingCustomHeaders",
      settings.imageHosting.custom.headers,
    );
    for (const key of [
      "markdown-press-settings",
      "markdown-press-settings.bak",
    ]) {
      expect(
        JSON.parse(localStorage.getItem(key)!).state.settings.imageHosting
          .custom.headers,
      ).toBeUndefined();
    }
  });

  it("retains the only legacy copy when secure migration fails", async () => {
    const settings = await fixture();
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_secure_settings") return {};
      throw new Error("secure storage unavailable");
    });
    const { migrateLegacySensitiveSettings } =
      await import("./secureSettingsService");
    await expect(migrateLegacySensitiveSettings(settings)).rejects.toThrow(
      "secure storage unavailable",
    );
    for (const key of [
      "markdown-press-settings",
      "markdown-press-settings.bak",
    ]) {
      expect(localStorage.getItem(key)).toContain("Bearer legacy");
    }
  });

  it("retries a failed migration instead of trusting the already loaded secure cache", async () => {
    const settings = await fixture();
    const { useAppStore } = await import("../store/appStore");
    useAppStore.setState({ settings });
    let rejectWrite = true;
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_secure_settings") return {};
      if (rejectWrite) throw new Error("disk unavailable");
    });
    const { hydrateSensitiveSettingsIntoStore } =
      await import("./secureSettingsService");
    await expect(hydrateSensitiveSettingsIntoStore()).rejects.toThrow(
      "disk unavailable",
    );
    expect(useAppStore.getState().settings.imageHosting.custom.headers).toBe(
      settings.imageHosting.custom.headers,
    );
    rejectWrite = false;
    await hydrateSensitiveSettingsIntoStore();
    expect(useAppStore.getState().settings.imageHostingCustomHeaders).toBe(
      settings.imageHosting.custom.headers,
    );
    expect(
      useAppStore.getState().settings.imageHosting.custom.headers,
    ).toBeUndefined();
  });
});
