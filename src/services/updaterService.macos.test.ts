import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: () => true,
}));

vi.mock("../utils/platform", () => ({
  isWindowsPlatform: () => false,
  isMacOSPlatform: () => true,
}));

vi.mock("@tauri-apps/api/core", () => {
  class Channel<T> {
    onmessage: (event: T) => void = () => {};
  }
  return { invoke: mockInvoke, Channel };
});

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "0.9.0",
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

import {
  checkForAppUpdate,
  downloadAndInstallUpdate,
  isMacOSUpdaterSupported,
} from "./updaterService";

describe("macOS script updater", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("is enabled on macOS desktop builds", () => {
    expect(isMacOSUpdaterSupported()).toBe(true);
  });

  it("maps a newer GitHub Release onto the shared update card", async () => {
    mockInvoke.mockResolvedValue({
      version: "0.9.1",
      currentVersion: "0.9.0",
      date: "2026-08-21T00:00:00Z",
      body: "macOS script update",
      tag: "v0.9.1",
    });

    const update = await checkForAppUpdate();
    expect(mockInvoke).toHaveBeenCalledWith("check_macos_update");
    expect(update).toMatchObject({
      version: "0.9.1",
      currentVersion: "0.9.0",
      kind: "macos-script",
      tag: "v0.9.1",
      body: "macOS script update",
    });
  });

  it("installs through the signed macOS updater command", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await downloadAndInstallUpdate({
      version: "0.9.1",
      currentVersion: "0.9.0",
      kind: "macos-script",
      tag: "v0.9.1",
      close: async () => {},
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "install_macos_update",
      expect.objectContaining({
        tag: "v0.9.1",
        onEvent: expect.any(Object),
      }),
    );
  });
});
