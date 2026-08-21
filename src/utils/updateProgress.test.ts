import { describe, expect, it } from "vitest";
import {
  INITIAL_UPDATE_DOWNLOAD_PROGRESS,
  applyUpdateDownloadEvent,
  computeDownloadPercent,
  formatByteSize,
  getUpdateProgressBarPercent,
  startUpdateDownload,
} from "./updateProgress";

describe("formatByteSize", () => {
  it("formats zero and invalid values as 0 B", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(-12)).toBe("0 B");
    expect(formatByteSize(Number.NaN)).toBe("0 B");
  });

  it("keeps bytes under 1 KB as whole numbers", () => {
    expect(formatByteSize(512)).toBe("512 B");
  });

  it("formats KB, MB, and GB with compact decimals", () => {
    expect(formatByteSize(1024)).toBe("1 KB");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(10 * 1024)).toBe("10 KB");
    expect(formatByteSize(38.9 * 1024 * 1024)).toBe("38.9 MB");
    expect(formatByteSize(2 * 1024 * 1024 * 1024)).toBe("2 GB");
  });
});

describe("computeDownloadPercent", () => {
  it("returns null when total size is unknown", () => {
    expect(computeDownloadPercent(1200, null)).toBeNull();
    expect(computeDownloadPercent(1200, 0)).toBeNull();
  });

  it("clamps percent between 0 and 100", () => {
    expect(computeDownloadPercent(0, 1000)).toBe(0);
    expect(computeDownloadPercent(420, 1000)).toBe(42);
    expect(computeDownloadPercent(1500, 1000)).toBe(100);
  });
});

describe("applyUpdateDownloadEvent", () => {
  it("starts downloading from a content-length event", () => {
    const next = applyUpdateDownloadEvent(startUpdateDownload(), {
      event: "Started",
      data: { contentLength: 2048 },
    });

    expect(next).toEqual({
      phase: "downloading",
      downloadedBytes: 0,
      downloadSize: 2048,
    });
  });

  it("keeps an indeterminate download when content-length is missing", () => {
    const next = applyUpdateDownloadEvent(startUpdateDownload(), {
      event: "Started",
      data: { contentLength: 0 },
    });

    expect(next.downloadSize).toBeNull();
    expect(getUpdateProgressBarPercent(next)).toBeNull();
  });

  it("accumulates progress chunks and fills the bar on finish", () => {
    let progress = applyUpdateDownloadEvent(startUpdateDownload(), {
      event: "Started",
      data: { contentLength: 1000 },
    });
    progress = applyUpdateDownloadEvent(progress, {
      event: "Progress",
      data: { chunkLength: 250 },
    });
    progress = applyUpdateDownloadEvent(progress, {
      event: "Progress",
      data: { chunkLength: 250 },
    });

    expect(progress.downloadedBytes).toBe(500);
    expect(getUpdateProgressBarPercent(progress)).toBe(50);

    progress = applyUpdateDownloadEvent(progress, { event: "Finished" });
    expect(progress.phase).toBe("installing");
    expect(progress.downloadedBytes).toBe(1000);
    expect(getUpdateProgressBarPercent(progress)).toBe(100);
  });

  it("stays indeterminate through install when size was never known", () => {
    let progress = applyUpdateDownloadEvent(startUpdateDownload(), {
      event: "Started",
    });
    progress = applyUpdateDownloadEvent(progress, {
      event: "Progress",
      data: { chunkLength: 4096 },
    });
    progress = applyUpdateDownloadEvent(progress, { event: "Finished" });

    expect(progress.phase).toBe("installing");
    expect(progress.downloadedBytes).toBe(4096);
    expect(getUpdateProgressBarPercent(progress)).toBeNull();
  });
});

describe("startUpdateDownload", () => {
  it("resets bytes into a preparing phase", () => {
    expect(startUpdateDownload()).toEqual({
      phase: "preparing",
      downloadedBytes: 0,
      downloadSize: null,
    });
    expect(INITIAL_UPDATE_DOWNLOAD_PROGRESS.phase).toBe("idle");
  });
});
