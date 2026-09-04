import { useEffect } from "react";
import type { AppSettings } from "../types";
import { ensureDynamicFontFaces } from "../utils/fontSettings";
import { hydrateSensitiveSettingsSafely } from "./hydrateSensitiveSettingsSafely";

interface UseAppBootstrapOptions {
  settings: AppSettings;
  settingsHydrated: boolean;
  currentFilePath: string | null;
  /** Standalone OS file sessions must not overwrite vault last-opened history. */
  rootFolderPath?: string | null;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

export function useAppBootstrap(options: UseAppBootstrapOptions): void {
  const {
    settings,
    settingsHydrated,
    currentFilePath,
    rootFolderPath,
    updateSettings,
  } = options;

  useEffect(() => {
    if (!settingsHydrated || typeof window === "undefined") return;

    let cancelled = false;
    const win = window;

    const warmSecureSettings = () => {
      if (cancelled) return;
      void hydrateSensitiveSettingsSafely();
    };

    if ("requestIdleCallback" in win) {
      const idleId = win.requestIdleCallback(warmSecureSettings, {
        timeout: 1500,
      });
      return () => {
        cancelled = true;
        win.cancelIdleCallback(idleId);
      };
    }

    const timerId = setTimeout(warmSecureSettings, 300);
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [settingsHydrated]);

  useEffect(() => {
    ensureDynamicFontFaces(settings)
      .then(() => {
        if (typeof document !== "undefined") {
          document.documentElement.style.setProperty(
            "--font-loaded-timestamp",
            Date.now().toString(),
          );
        }
      })
      .catch((error) => {
        console.error("Failed to ensure dynamic font faces:", error);
      });
  }, [settings]);

  useEffect(() => {
    if (!settingsHydrated || typeof document === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      document.documentElement.removeAttribute("data-app-booting");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [settingsHydrated]);

  useEffect(() => {
    if (!settingsHydrated || !currentFilePath) return;
    // OS single-file launches have no vault — don't pollute lastOpenedFilePath.
    if (!rootFolderPath?.trim()) return;
    if (settings.lastOpenedFilePath === currentFilePath) return;

    updateSettings({ lastOpenedFilePath: currentFilePath });
  }, [
    settingsHydrated,
    currentFilePath,
    rootFolderPath,
    settings.lastOpenedFilePath,
    updateSettings,
  ]);
}
