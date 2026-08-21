/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateProgressPanel } from "./UpdateProgressPanel";
import type { UpdateDownloadProgress } from "../../utils/updateProgress";

vi.mock("../../hooks/useI18n", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "settings_updatesPreparingInstall") {
        return `正在准备安装 ${params?.version ?? ""}...`;
      }
      if (key === "settings_updatesDownloading") {
        return "正在下载安装包...";
      }
      if (key === "settings_updatesInstalling") {
        return "正在安装更新...";
      }
      if (key === "settings_updatesProgressPercent") {
        return `下载进度 ${params?.percent}%`;
      }
      if (key === "settings_updatesProgressBytes") {
        return `${params?.downloaded} / ${params?.total}`;
      }
      if (key === "settings_updatesProgressDownloaded") {
        return `已下载 ${params?.downloaded}`;
      }
      if (key === "settings_updatesProgressLabel") {
        return "更新进度";
      }
      return key;
    },
  }),
}));

afterEach(() => {
  cleanup();
});

function renderProgress(progress: UpdateDownloadProgress, version = "0.9.1") {
  return render(<UpdateProgressPanel progress={progress} version={version} />);
}

describe("UpdateProgressPanel", () => {
  it("does not render while idle", () => {
    const { container } = renderProgress({
      phase: "idle",
      downloadedBytes: 0,
      downloadSize: null,
    });
    expect(container.firstChild).toBeNull();
  });

  it("shows an indeterminate bar while preparing", () => {
    renderProgress({
      phase: "preparing",
      downloadedBytes: 0,
      downloadSize: null,
    });

    expect(screen.getByRole("status", { name: "更新进度" })).toBeTruthy();
    expect(screen.getByText("正在准备安装 0.9.1...")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
    expect(bar.querySelector(".animate-progress-indeterminate")).toBeTruthy();
  });

  it("shows percent and byte totals while downloading", () => {
    renderProgress({
      phase: "downloading",
      downloadedBytes: 5 * 1024 * 1024,
      downloadSize: 10 * 1024 * 1024,
    });

    expect(screen.getByText("正在下载安装包...")).toBeTruthy();
    expect(screen.getByText("下载进度 50%")).toBeTruthy();
    expect(screen.getByText("5 MB / 10 MB")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "50",
    );
  });

  it("shows downloaded bytes without a percent when size is unknown", () => {
    renderProgress({
      phase: "downloading",
      downloadedBytes: 2048,
      downloadSize: null,
    });

    expect(screen.getByText("已下载 2 KB")).toBeTruthy();
    expect(screen.queryByText(/下载进度/)).toBeNull();
    expect(
      screen
        .getByRole("progressbar")
        .querySelector(".animate-progress-indeterminate"),
    ).toBeTruthy();
  });

  it("fills the bar while installing after a sized download", () => {
    renderProgress({
      phase: "installing",
      downloadedBytes: 4096,
      downloadSize: 4096,
    });

    expect(screen.getByText("正在安装更新...")).toBeTruthy();
    expect(screen.getByText("下载进度 100%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });
});
