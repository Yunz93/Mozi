import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({
  platform: "macos",
  flush: vi.fn(),
  invoke: vi.fn(),
  relaunch: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  check: vi.fn(),
  begin: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("../utils/platform", () => ({
  isWindowsPlatform: () => mocks.platform === "windows",
  isMacOSPlatform: () => mocks.platform === "macos",
  isLinuxPlatform: () => mocks.platform === "linux",
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
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("./updaterCapabilities", () => ({
  areUpdaterArtifactsEnabled: () => true,
}));

import {
  downloadAndInstallUpdate,
  checkForAppUpdate,
  type AvailableUpdate,
} from "./updaterService";

function update(): AvailableUpdate {
  return {
    version: "1.2.0",
    currentVersion: "1.1.0",
    tag: "v1.2.0",
    kind:
      mocks.platform === "macos"
        ? "macos-script"
        : mocks.platform === "linux"
          ? "linux-tauri"
          : "windows-tauri",
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
  mocks.check.mockReset().mockResolvedValue(null);
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

  it.each(["macos", "windows", "linux"])(
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

  it.each(["windows", "linux"])(
    "saves edits made during %s download before installation and relaunch",
    async (platform) => {
      mocks.platform = platform;
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
      expect(order).toEqual([
        "save",
        "download",
        "save",
        "install",
        "relaunch",
      ]);
    },
  );

  it.each(["windows", "linux"])(
    "keeps %s running when edits made during download cannot be saved",
    async (platform) => {
      mocks.platform = platform;
      mocks.flush.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
        "保存失败",
      );
      expect(mocks.download).toHaveBeenCalledTimes(1);
      expect(mocks.install).not.toHaveBeenCalled();
      expect(mocks.relaunch).not.toHaveBeenCalled();
    },
  );
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

  it.each(["windows", "linux"])(
    "unlocks all windows when the %s installer fails",
    async (platform) => {
      mocks.platform = platform;
      mocks.install.mockRejectedValueOnce(new Error("installer failed"));
      await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
        "installer failed",
      );
      expect(mocks.release).toHaveBeenCalledTimes(1);
      expect(mocks.relaunch).not.toHaveBeenCalled();
    },
  );

  it.each(["windows", "linux"])(
    "maps a signed update to the %s installer",
    async (platform) => {
      mocks.platform = platform;
      const close = vi.fn();
      mocks.check.mockResolvedValue({
        version: "2.3.2",
        currentVersion: "2.3.1",
        close,
      });
      const available = await checkForAppUpdate();
      expect(available?.kind).toBe(`${platform}-tauri`);
      expect(mocks.check).toHaveBeenCalledWith({ timeout: 30_000 });
      await available?.close();
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("keeps Linux running after cancelled authorization and permits a later retry", async () => {
    mocks.platform = "linux";
    mocks.install.mockRejectedValueOnce(new Error("authorization cancelled"));
    await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
      "authorization cancelled",
    );
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    await downloadAndInstallUpdate(update());
    expect(mocks.install).toHaveBeenCalledTimes(2);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it("does not lock or install after a failed Linux download", async () => {
    mocks.platform = "linux";
    mocks.download.mockRejectedValueOnce(new Error("download failed"));
    await expect(downloadAndInstallUpdate(update())).rejects.toThrow(
      "download failed",
    );
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it.each(["windows", "linux"])(
    "rejects an installer for another platform on %s",
    async (platform) => {
      mocks.platform = platform;
      const incompatible = {
        ...update(),
        kind: platform === "linux" ? "windows-tauri" : "linux-tauri",
      } as AvailableUpdate;
      await expect(downloadAndInstallUpdate(incompatible)).rejects.toThrow(
        "does not match",
      );
      expect(mocks.flush).not.toHaveBeenCalled();
      expect(mocks.install).not.toHaveBeenCalled();
    },
  );
});
