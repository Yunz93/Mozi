import { useCallback, useEffect, useState } from "react";
import { isTauriEnvironment } from "../types/filesystem";
import { takeBootOpenFileQuery } from "../utils/bootOpenFile";

interface UseExternalFileOpenOptions {
  settingsHydrated: boolean;
  /**
   * Runtime OS / second-instance file opens (not the boot query).
   * Primary window may redirect these into a new window.
   */
  onRuntimePaths: (paths: string[]) => Promise<void> | void;
}

export interface ExternalFileOpenState {
  hasCheckedExternalFiles: boolean;
  /** Paths from `?openFile=` / `take_opened_files` to open after startup. */
  pendingBootPaths: string[];
  /**
   * When true, restore the last knowledge base before opening boot paths.
   * OS / system launches leave this false; in-app "Open in New Window" sets it.
   */
  bootOpenWithVault: boolean;
  clearPendingBootPaths: () => void;
}

function normalizeOpenedFilePayload(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

export function useExternalFileOpen({
  settingsHydrated,
  onRuntimePaths,
}: UseExternalFileOpenOptions): ExternalFileOpenState {
  const [hasCheckedExternalFiles, setHasCheckedExternalFiles] = useState(false);
  const [pendingBootPaths, setPendingBootPaths] = useState<string[]>([]);
  const [bootOpenWithVault, setBootOpenWithVault] = useState(false);

  const clearPendingBootPaths = useCallback(() => {
    setPendingBootPaths([]);
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;

    if (!isTauriEnvironment()) {
      setHasCheckedExternalFiles(true);
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const [{ listen }, { invoke }] = await Promise.all([
          import("@tauri-apps/api/event"),
          import("@tauri-apps/api/core"),
        ]);

        unlisten = await listen("opened-files", (event) => {
          const paths = uniquePaths(normalizeOpenedFilePayload(event.payload));
          if (paths.length === 0) return;
          void onRuntimePaths(paths);
        });

        const bootQuery = takeBootOpenFileQuery();
        const initialPaths = normalizeOpenedFilePayload(
          await invoke("take_opened_files"),
        );
        const bootPaths = uniquePaths([...bootQuery.paths, ...initialPaths]);

        if (!cancelled) {
          setPendingBootPaths(bootPaths);
          // OS cold-start / second-instance paths never restore the vault.
          // Only an explicit `withVault=1` query (in-app new window) does.
          setBootOpenWithVault(bootQuery.withVault && bootPaths.length > 0);
        }
      } catch (error) {
        console.warn(
          "Failed to initialize external file open handling:",
          error,
        );
      } finally {
        if (!cancelled) {
          setHasCheckedExternalFiles(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [settingsHydrated, onRuntimePaths]);

  return {
    hasCheckedExternalFiles,
    pendingBootPaths,
    bootOpenWithVault,
    clearPendingBootPaths,
  };
}
