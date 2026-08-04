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

async function reloadTabFromDisk(
  tabId: string,
  readFile: (file: FileNode) => Promise<string>,
  showNotification: (message: string, type: "success" | "error") => void,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  options?: { notifyReload?: boolean },
): Promise<void> {
  const state = useAppStore.getState();
  if (state.hasUnsavedChanges(tabId)) {
    showNotification(t("notifications_fileChangedOnDisk"), "error");
    return;
  }

  const node = findFileInTree(state.files, tabId);
  if (!node || node.type !== "file") return;

  try {
    const latestContent = await readFile(node);
    const stateAfterRead = useAppStore.getState();

    if (stateAfterRead.hasUnsavedChanges(tabId)) {
      showNotification(t("notifications_fileChangedOnDisk"), "error");
      return;
    }

    const currentCached = stateAfterRead.fileContents[tabId];
    if (currentCached === latestContent) return;

    const stateBeforeUpdate = useAppStore.getState();
    if (stateBeforeUpdate.hasUnsavedChanges(tabId)) {
      showNotification(t("notifications_fileChangedOnDisk"), "error");
      return;
    }

    // Only reload the open document when content is already cached.
    if (stateBeforeUpdate.fileContents[tabId] === undefined) return;

    stateBeforeUpdate.setContentForFile(tabId, latestContent, true);
    stateBeforeUpdate.markAsSaved(tabId);
    if (options?.notifyReload !== false) {
      showNotification(t("notifications_fileReloaded"), "success");
    }
  } catch (error) {
    console.error("Failed to reload file from disk:", error);
    showNotification(t("notifications_reloadFileFailed"), "error");
  }
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

        await reloadTabFromDisk(watchedTabId, readFile, showNotification, t, {
          notifyReload: true,
        });
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
