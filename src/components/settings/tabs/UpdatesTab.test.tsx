/** @vitest-environment happy-dom */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../../store/appStore";
import type { AvailableUpdate } from "../../../services/updaterService";

const {
  mockCheckForAppUpdate,
  mockDownloadAndInstallUpdate,
  mockGetInstalledAppVersion,
} = vi.hoisted(() => ({
  mockCheckForAppUpdate: vi.fn(),
  mockDownloadAndInstallUpdate: vi.fn(),
  mockGetInstalledAppVersion: vi.fn(),
}));

vi.mock("../../../types/filesystem", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../types/filesystem")>();
  return {
    ...actual,
    isTauriEnvironment: () => true,
  };
});

vi.mock("../../../utils/platform", () => ({
  isWindowsPlatform: () => true,
}));

vi.mock("../../../services/updaterService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/updaterService")>();
  return {
    ...actual,
    checkForAppUpdate: mockCheckForAppUpdate,
    downloadAndInstallUpdate: mockDownloadAndInstallUpdate,
    getInstalledAppVersion: mockGetInstalledAppVersion,
    areUpdaterArtifactsEnabled: () => true,
  };
});

vi.mock("../../../hooks/useI18n", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: (key: string, params?: Record<string, string | number>) => {
      const templates: Record<string, string> = {
        settings_aboutTitle: "关于",
        settings_aboutAuthor: "作者",
        settings_aboutAuthorValue: "Yunz",
        settings_aboutMessage: "寄语",
        settings_aboutMessageValue: "写给使用者",
        settings_aboutJointCertification: "联合认证",
        settings_aboutJointCertificationHint: "hint",
        settings_updatesSectionTitle: "应用更新",
        settings_updatesCurrentVersionLabel: "当前版本",
        settings_updatesLastCheckLabel: "上次检查",
        settings_updatesNeverChecked: "尚未检查更新",
        settings_updatesCurrentVersion: "当前版本：",
        settings_updatesAutoCheck: "启动后自动检查更新",
        settings_updatesAutoCheckDesc: "desc",
        settings_updatesCheckNow: "立即检查",
        settings_updatesChecking: "正在检查更新...",
        settings_updatesAvailableStatus: "发现新版本 {version}。",
        settings_updatesPreparingInstall: "正在准备安装 {version}...",
        settings_updatesDownloading: "正在下载安装包...",
        settings_updatesInstalling: "正在安装更新...",
        settings_updatesInstallNow: "下载安装更新",
        settings_updatesSkipVersion: "忽略这个版本",
        settings_updatesAvailableVersion: "可更新到 {version}",
        settings_updatesProgressPercent: "下载进度 {percent}%",
        settings_updatesProgressBytes: "{downloaded} / {total}",
        settings_updatesProgressDownloaded: "已下载 {downloaded}",
        settings_updatesProgressLabel: "更新进度",
        settings_updatesReleaseNotes: "发布说明",
        settings_updatesGuide1: "guide1",
        settings_updatesGuide2: "guide2",
        notifications_updateAvailable: "发现新版本 {version}",
        common_loading: "加载中",
      };
      return (templates[key] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
        String(params?.[name] ?? `{${name}}`),
      );
    },
  }),
}));

vi.mock("../../../store/appStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../store/appStore")>();
  return {
    ...actual,
    useAppStore: (
      selector: (state: { showNotification: () => void }) => unknown,
    ) => selector({ showNotification: vi.fn() }),
  };
});

import { UpdatesTab } from "./UpdatesTab";

function createUpdate(): AvailableUpdate {
  return {
    version: "0.9.1",
    currentVersion: "0.9.0",
    date: "2026-08-21",
    body: "修复更新进度",
    close: vi.fn(async () => {}),
  } as unknown as AvailableUpdate;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockGetInstalledAppVersion.mockResolvedValue("0.9.0");
  mockCheckForAppUpdate.mockResolvedValue(createUpdate());
});

describe("UpdatesTab download progress", () => {
  it("shows determinate download progress next to the install action", async () => {
    let sendEvent:
      | ((event: {
          event: "Started" | "Progress" | "Finished";
          data?: { contentLength?: number; chunkLength?: number };
        }) => void)
      | undefined;
    let finishInstall: () => void = () => {};

    mockDownloadAndInstallUpdate.mockImplementation(
      async (_update, onEvent: typeof sendEvent) => {
        sendEvent = onEvent;
        await new Promise<void>((resolve) => {
          finishInstall = resolve;
        });
      },
    );

    render(
      <UpdatesTab settings={defaultSettings} onUpdateSettings={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "立即检查" }));
    const installButton = await screen.findByRole("button", {
      name: "下载安装更新",
    });
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "更新进度" })).toBeTruthy();
    });
    expect(
      screen.getByRole("status", { name: "更新进度" }).textContent,
    ).toContain("正在准备安装 0.9.1...");

    sendEvent?.({ event: "Started", data: { contentLength: 1000 } });
    sendEvent?.({ event: "Progress", data: { chunkLength: 400 } });

    await waitFor(() => {
      expect(screen.getByText("下载进度 40%")).toBeTruthy();
    });
    expect(screen.getByText("400 B / 1000 B")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "40",
    );

    finishInstall();
  });
});
