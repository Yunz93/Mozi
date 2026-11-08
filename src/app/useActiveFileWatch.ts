import { reloadDocumentSession } from "../services/documents/reloadDocumentSession";
import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { findFileInTree } from "./appShellUtils";
import type { FileNode } from "../types";
import type { FileWatchEvent } from "../types/filesystem";
import type { TranslationKey } from "../utils/i18n";
import {
  isExcalidrawFile,
  isMarkdownFile,
  isPreviewOnlyFile,
} from "../utils/fileTypes";

interface UseActiveFileWatchOptions {
  activeTabId: string | null;
  currentFilePath: string | null;
  openTabs: string[];
  files: FileNode[];
  readFile: (file: FileNode) => Promise<string>;
  setCurrentFilePath: (path: string | null) => void;
  showNotification: (message: string, type: "success" | "error") => void;
  closeTab: (fileId: string) => void;
  refreshFileTree: () => Promise<void>;
  watchFile: (
    path: string,
    callback: (event: FileWatchEvent | null) => void,
  ) => Promise<(() => void) | null>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

function shouldWatchTabContent(node: FileNode | undefined): boolean {
  if (!node || node.type !== "file") return false;
  return (
    isMarkdownFile(node.name) ||
    isExcalidrawFile(node.name) ||
    isPreviewOnlyFile(node.name)
  );
}

export function useActiveFileWatch(options: UseActiveFileWatchOptions): void {
  const {
    activeTabId,
    currentFilePath,
    openTabs,
    files,
    readFile,
    setCurrentFilePath,
    showNotification,
    closeTab,
    refreshFileTree,
    watchFile,
    t,
  } = options;

  useEffect(() => {
    const nextPath = activeTabId
      ? (findFileInTree(files, activeTabId)?.path ?? null)
      : null;
    if (currentFilePath !== nextPath) {
      setCurrentFilePath(nextPath);
    }
  }, [activeTabId, files, currentFilePath, setCurrentFilePath]);

  // Single-document model: watch only the open file.
  const watchedTabId = openTabs[0] ?? activeTabId;
  const unwatchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false;

    const stopWatching = () => {
      if (unwatchRef.current) {
        unwatchRef.current();
        unwatchRef.current = null;
      }
    };

    const setupWatcher = async () => {
      stopWatching();
      if (!watchedTabId) return;

      const node = findFileInTree(files, watchedTabId);
      if (!shouldWatchTabContent(node) || !node) {
        return;
      }

      const watcher = await watchFile(node.path, async (event) => {
        if (disposed) return;
        if (event?.type === "deleted") {
          const state = useAppStore.getState();
          if (state.hasUnsavedChanges(watchedTabId)) {
            showNotification(
              t("notifications_fileDeletedOnDiskUnsaved"),
              "error",
            );
            void refreshFileTree();
            return;
          }
          closeTab(watchedTabId);
          void refreshFileTree();
          showNotification(t("notifications_fileDeletedOnDisk"), "error");
          return;
        }
        if (event?.type === "error") {
          showNotification(t("notifications_watchFileFailed"), "error");
          return;
        }
        if (event?.type !== "modified") return;

        await reloadDocumentSession(
          watchedTabId,
          readFile,
          showNotification,
          t,
          {
            notifyReload: true,
          },
        );
      });

      if (disposed) {
        watcher?.();
        return;
      }

      if (watcher) {
        unwatchRef.current = watcher;
      }
    };

    void setupWatcher();

    return () => {
      disposed = true;
      stopWatching();
    };
  }, [
    watchedTabId,
    files,
    closeTab,
    readFile,
    refreshFileTree,
    showNotification,
    watchFile,
    t,
  ]);
}
