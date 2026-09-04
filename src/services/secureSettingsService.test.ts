import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: () => false,
}));

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { loadSecureSettings } from "./secureSettingsService";

describe("secureSettingsService browser mode", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it("does not wait for Tauri when running in the browser", async () => {
    const started = Date.now();
    const result = await loadSecureSettings();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});
