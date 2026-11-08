import { useAppStore } from "../../store/appStore";
import type { FileNode } from "../../types";
import type { TranslationKey } from "../../utils/i18n";
import { findFileInTree } from "../../utils/fileTree";
import { flushActiveEditorPendingChanges } from "../../utils/editorSelectionBridge";
import {
  captureDocumentSession,
  matchesDocumentSession,
} from "./sessionSnapshot";

export async function reloadDocumentSession(
  tabId: string,
  readFile: (file: FileNode) => Promise<string>,
  showNotification: (message: string, type: "success" | "error") => void,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  options?: { notifyReload?: boolean },
): Promise<void> {
  flushActiveEditorPendingChanges();
  const state = useAppStore.getState();
  const source = captureDocumentSession(state);
  if (!source || source.documentId !== tabId) return;
  if (state.hasUnsavedChanges(tabId)) {
    showNotification(t("notifications_fileChangedOnDisk"), "error");
    return;
  }

  const node = findFileInTree(state.files, tabId);
  if (!node || node.type !== "file") return;

  try {
    const latestContent = await readFile(node);
    flushActiveEditorPendingChanges();
    const stateAfterRead = useAppStore.getState();
    if (!matchesDocumentSession(stateAfterRead, source)) return;

    if (stateAfterRead.hasUnsavedChanges(tabId)) {
      showNotification(t("notifications_fileChangedOnDisk"), "error");
      return;
    }

    if (!matchesDocumentSession(stateAfterRead, source, true)) return;
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
