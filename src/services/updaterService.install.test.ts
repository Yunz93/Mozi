import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({
  platform: "macos",
  flush: vi.fn(),
  invoke: vi.fn(),
  relaunch: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  begin: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("../utils/platform", () => ({
  isWindowsPlatform: () => mocks.platform === "windows",
  isMacOSPlatform: () => mocks.platform === "macos",
}));
vi.mock("./updateDocumentGuard", () => ({ beginUpdateInstall: mocks.begin }));
vi.mock("./filesystem/flushActiveDocument", () => ({
  flushAllDirtyOpenTabs: mocks.flush,
}));
vi.mock("../store/appStore", () => ({
  useAppStore: { getState: () => ({ settings: { language: "zh-CN" } }) },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("./updaterCapabilities", () => ({
  areUpdaterArtifactsEnabled: () => true,
}));

import {
  downloadAndInstallUpdate,
  type AvailableUpdate,
} from "./updaterService";

function update(): AvailableUpdate {
  return {
    version: "1.2.0",
    currentVersion: "1.1.0",
    tag: "v1.2.0",
    kind: mocks.platform === "macos" ? "macos-script" : "windows-tauri",
    close: async () => {},
    tauriUpdate: {
      download: mocks.download,
      install: mocks.install,
      downloadAndInstall: vi.fn(async () => {}),
    } as unknown as Update,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = "macos";
  mocks.flush.mockReset().mockResolvedValue(true);
  mocks.invoke.mockReset().mockResolvedValue("download-id");
  mocks.release.mockReset().mockResolvedValue(undefined);
  mocks.begin.mockReset().mockImplementation(async () => {
    if (!(await mocks.flush())) throw new Error("保存失败");
    return mocks.release;
  });
  mocks.download.mockReset().mockResolvedValue(undefined);
  mocks.install.mockReset().mockResolvedValue(undefined);
});

describe("update document preservation", () => {
  it("waits for saved documents before starting a macOS update", async () => {
    let finish!: (saved: boolean) => void;
    mocks.flush.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const running = downloadAndInstallUpdate(update());
    await Promise.resolve();
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
    finish(true);
    await running;
    expect(mocks.invoke).toHaveBeenCalledWith(
      "prepare_macos_update",
      expect.any(Object),
    );
  });

  it.each(["macos", "windows"])(
    "blocks %s installation when saving fails",
    async (platform) => {
      mocks.platform = platform;
      mocks.flush.mockResolvedValue(false);
      await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
        "保存失败",
      );
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.install).not.toHaveBeenCalled();
      expect(mocks.relaunch).not.toHaveBeenCalled();
    },
  );

  it("saves edits made during Windows download before installation and relaunch", async () => {
    mocks.platform = "windows";
    const order: string[] = [];
    mocks.flush.mockImplementation(async () => {
      order.push("save");
      return true;
    });
    mocks.download.mockImplementation(async () => {
      order.push("download");
    });
    mocks.install.mockImplementation(async () => {
      order.push("install");
    });
    mocks.relaunch.mockImplementation(async () => {
      order.push("relaunch");
    });
    await downloadAndInstallUpdate(update());
    expect(order).toEqual(["save", "download", "save", "install", "relaunch"]);
  });

  it("keeps Windows running when edits made during download cannot be saved", async () => {
    mocks.platform = "windows";
    mocks.flush.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
      "保存失败",
    );
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
  it("does not replace the macOS app when another window fails to save", async () => {
    mocks.begin.mockRejectedValueOnce(new Error("保存失败"));
    await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
      "保存失败",
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "prepare_macos_update",
      expect.any(Object),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "install_macos_update",
      expect.anything(),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("discard_macos_update", {
      downloadId: "download-id",
    });
  });

  it("unlocks all windows when the Windows installer fails", async () => {
    mocks.platform = "windows";
    mocks.install.mockRejectedValueOnce(new Error("installer failed"));
    await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
      "installer failed",
    );
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});
