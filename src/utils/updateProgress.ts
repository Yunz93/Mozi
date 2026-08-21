export type UpdateInstallPhase =
  | "idle"
  | "preparing"
  | "downloading"
  | "installing";

export interface UpdateDownloadProgress {
  phase: UpdateInstallPhase;
  downloadedBytes: number;
  downloadSize: number | null;
}

export const INITIAL_UPDATE_DOWNLOAD_PROGRESS: UpdateDownloadProgress = {
  phase: "idle",
  downloadedBytes: 0,
  downloadSize: null,
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function startUpdateDownload(): UpdateDownloadProgress {
  return {
    phase: "preparing",
    downloadedBytes: 0,
    downloadSize: null,
  };
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  const formatted =
    unitIndex === 0
      ? String(Math.round(value))
      : Number(value.toFixed(digits)).toString();
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}

export function computeDownloadPercent(
  downloadedBytes: number,
  downloadSize: number | null,
): number | null {
  if (!downloadSize || downloadSize <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((downloadedBytes / downloadSize) * 100)),
  );
}

export function applyUpdateDownloadEvent(
  previous: UpdateDownloadProgress,
  event: {
    event: "Started" | "Progress" | "Finished";
    data?: { contentLength?: number | null; chunkLength?: number };
  },
): UpdateDownloadProgress {
  switch (event.event) {
    case "Started": {
      const contentLength = event.data?.contentLength;
      return {
        phase: "downloading",
        downloadedBytes: 0,
        downloadSize:
          typeof contentLength === "number" && contentLength > 0
            ? contentLength
            : null,
      };
    }
    case "Progress":
      return {
        ...previous,
        phase: "downloading",
        downloadedBytes:
          previous.downloadedBytes + Math.max(0, event.data?.chunkLength ?? 0),
      };
    case "Finished":
      return {
        phase: "installing",
        downloadedBytes: previous.downloadSize ?? previous.downloadedBytes,
        downloadSize: previous.downloadSize,
      };
  }
}

export function getUpdateProgressBarPercent(
  progress: UpdateDownloadProgress,
): number | null {
  if (progress.phase === "idle") {
    return null;
  }

  const percent = computeDownloadPercent(
    progress.downloadedBytes,
    progress.downloadSize,
  );
  if (progress.phase === "installing" && progress.downloadSize != null) {
    return 100;
  }

  return percent;
}
