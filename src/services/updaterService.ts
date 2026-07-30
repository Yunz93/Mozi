import { getVersion } from "@tauri-apps/api/app";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauriEnvironment } from "../types/filesystem";
import { isWindowsPlatform } from "../utils/platform";
import { areUpdaterArtifactsEnabled } from "./updaterCapabilities";

export const RELEASES_PAGE_URL =
  "https://github.com/Yunz93/markdown-press/releases";
export {
  areUpdaterArtifactsEnabled,
  UPDATER_ARTIFACTS_ENABLED,
} from "./updaterCapabilities";
const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

export type AvailableUpdate = Update;
export type UpdateDownloadEvent = DownloadEvent;

export function isDesktopApp(): boolean {
  return isTauriEnvironment();
}

export function isWindowsUpdaterSupported(): boolean {
  return isDesktopApp() && isWindowsPlatform();
}

export async function getInstalledAppVersion(): Promise<string | null> {
  if (!isDesktopApp()) {
    return null;
  }

  return getVersion();
}

export async function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (!isWindowsUpdaterSupported()) {
    return null;
  }

  // When createUpdaterArtifacts is off, skip the network check so polls do not 404 on missing latest.json.
  if (!areUpdaterArtifactsEnabled()) {
    return null;
  }

  return check({ timeout: CHECK_TIMEOUT_MS });
}

export async function downloadAndInstallUpdate(
  update: AvailableUpdate,
  onEvent?: (event: UpdateDownloadEvent) => void,
): Promise<void> {
  if (!isWindowsUpdaterSupported()) {
    throw new Error(
      "In-app updates are currently supported on Windows desktop builds only.",
    );
  }
  if (!areUpdaterArtifactsEnabled()) {
    throw new Error(
      "In-app updater artifacts are disabled for this release build. Use GitHub Releases instead.",
    );
  }

  await update.downloadAndInstall(onEvent, { timeout: DOWNLOAD_TIMEOUT_MS });
  await relaunch();
}
