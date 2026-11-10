import { useEffect, useRef } from "react";
import type { AppSettings } from "../types";
import type { TranslationKey } from "../utils/i18n";
import {
  areUpdaterArtifactsEnabled,
  checkForAppUpdate,
  isInAppUpdaterSupported,
  isMacOSUpdaterSupported,
} from "../services/updaterService";

interface UseAppUpdaterOptions {
  language: AppSettings["language"];
  settingsHydrated: boolean;
  autoCheckForUpdates: boolean;
  acceptBetaUpdates: boolean;
  skippedUpdateVersion: string;
  updateSettings: (patch: Partial<AppSettings>) => void;
  showNotification: (msg: string, type?: "success" | "error" | "info") => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function useAppUpdater(options: UseAppUpdaterOptions): void {
  const {
    language,
    settingsHydrated,
    autoCheckForUpdates,
    acceptBetaUpdates,
    skippedUpdateVersion,
    updateSettings,
    showNotification,
    t,
  } = options;
  const checkedChannelRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (
      !settingsHydrated ||
      !autoCheckForUpdates ||
      !isInAppUpdaterSupported() ||
      (!isMacOSUpdaterSupported() && !areUpdaterArtifactsEnabled())
    ) {
      return;
    }

    if (checkedChannelRef.current === acceptBetaUpdates) {
      return;
    }

    let cancelled = false;
    const win = window;

    const runCheck = () => {
      if (cancelled) {
        return;
      }

      checkedChannelRef.current = acceptBetaUpdates;
      void checkForAppUpdate(acceptBetaUpdates)
        .then((update) => {
          if (cancelled) {
            void update?.close().catch(() => {});
            return;
          }

          updateSettings({ lastUpdateCheckAt: new Date().toISOString() });

          if (update && update.version !== skippedUpdateVersion) {
            showNotification(
              t("notifications_updateAvailable", { version: update.version }),
              "info",
            );
          }
          void update?.close().catch(() => {});
        })
        .catch((error) => {
          console.warn(
            `[${language}] Failed to auto-check for updates:`,
            error,
          );
        });
    };

    if ("requestIdleCallback" in win) {
      const idleId = win.requestIdleCallback(runCheck, { timeout: 2500 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback(idleId);
      };
    }

    const timerId = window.setTimeout(runCheck, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    autoCheckForUpdates,
    acceptBetaUpdates,
    language,
    settingsHydrated,
    showNotification,
    skippedUpdateVersion,
    t,
    updateSettings,
  ]);
}
