import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauriEnvironment } from "../types/filesystem";
import { isMacOSPlatform, isWindowsPlatform } from "../utils/platform";
import { areUpdaterArtifactsEnabled } from "./updaterCapabilities";

export const RELEASES_PAGE_URL = "https://github.com/Yunz93/Mozi/releases";
export {
  areUpdaterArtifactsEnabled,
  UPDATER_ARTIFACTS_ENABLED,
} from "./updaterCapabilities";
const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

export type UpdateDownloadEvent = DownloadEvent;

export type AvailableUpdateKind = "windows-tauri" | "macos-script";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  kind: AvailableUpdateKind;
  tag?: string;
  close: () => Promise<void>;
  tauriUpdate?: Update;
}

interface MacosUpdateInfo {
  version: string;
  currentVersion: string;
  date?: string | null;
  body?: string | null;
  tag: string;
}

export function isDesktopApp(): boolean {
  return isTauriEnvironment();
}

export function isWindowsUpdaterSupported(): boolean {
  return isDesktopApp() && isWindowsPlatform();
}

export function isMacOSUpdaterSupported(): boolean {
  return isDesktopApp() && isMacOSPlatform();
}

export function isInAppUpdaterSupported(): boolean {
  return isWindowsUpdaterSupported() || isMacOSUpdaterSupported();
}

export async function getInstalledAppVersion(): Promise<string | null> {
  if (!isDesktopApp()) {
    return null;
  }

  return getVersion();
}

function fromTauriUpdate(update: Update): AvailableUpdate {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
    kind: "windows-tauri",
    close: () => update.close(),
    tauriUpdate: update,
  };
}

function fromMacosUpdate(info: MacosUpdateInfo): AvailableUpdate {
  return {
    version: info.version,
    currentVersion: info.currentVersion,
    date: info.date ?? undefined,
    body: info.body ?? undefined,
    kind: "macos-script",
    tag: info.tag,
    close: async () => {},
  };
}

async function checkMacOSUpdate(): Promise<AvailableUpdate | null> {
  const info = await invoke<MacosUpdateInfo | null>("check_macos_update");
  return info ? fromMacosUpdate(info) : null;
}

async function installMacOSUpdate(
  tag: string,
  onEvent?: (event: UpdateDownloadEvent) => void,
): Promise<void> {
  const channel = new Channel<UpdateDownloadEvent>();
  channel.onmessage = (event) => {
    onEvent?.(event);
  };
  await invoke("install_macos_update", { tag, onEvent: channel });
}

export async function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (isMacOSUpdaterSupported()) {
    return checkMacOSUpdate();
  }

  if (!isWindowsUpdaterSupported()) {
    return null;
  }

  // When createUpdaterArtifacts is off, skip the network check so polls do not 404 on missing latest.json.
  if (!areUpdaterArtifactsEnabled()) {
    return null;
  }

  const update = await check({ timeout: CHECK_TIMEOUT_MS });
  return update ? fromTauriUpdate(update) : null;
}

export async function downloadAndInstallUpdate(
  update: AvailableUpdate,
  onEvent?: (event: UpdateDownloadEvent) => void,
): Promise<void> {
  if (update.kind === "macos-script") {
    if (!isMacOSUpdaterSupported()) {
      throw new Error("macOS in-app updates are only available on macOS.");
    }
    const tag = update.tag || `v${update.version}`;
    await installMacOSUpdate(tag, onEvent);
    return;
  }

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
  if (!update.tauriUpdate) {
    throw new Error("Windows updater handle is missing.");
  }

  await update.tauriUpdate.downloadAndInstall(onEvent, {
    timeout: DOWNLOAD_TIMEOUT_MS,
  });
  await relaunch();
}
