import { afterEach, describe, expect, it, vi } from "vitest";

const hydrate = vi.fn();

vi.mock("../services/secureSettingsService", () => ({
  hydrateSensitiveSettingsIntoStore: (...args: unknown[]) => hydrate(...args),
}));

describe("hydrateSensitiveSettingsSafely", () => {
  afterEach(() => {
    hydrate.mockReset();
  });

  it("hydrate 失败时不抛出、后续流程可继续", async () => {
    hydrate.mockRejectedValue(new Error("keychain unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { hydrateSensitiveSettingsSafely } =
      await import("./hydrateSensitiveSettingsSafely");

    await expect(hydrateSensitiveSettingsSafely()).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("hydrate 成功时返回 true", async () => {
    hydrate.mockResolvedValue({});
    const { hydrateSensitiveSettingsSafely } =
      await import("./hydrateSensitiveSettingsSafely");
    await expect(hydrateSensitiveSettingsSafely()).resolves.toBe(true);
  });
});
