import { useAppStore } from "../../store/appStore";
import { getFileSystem } from "../../types/filesystem";
import { flushActiveEditorPendingChanges } from "../../utils/editorSelectionBridge";
import { clearDraftBackup } from "../../utils/draftBackup";
import { findFileInTree } from "../../utils/fileTree";
import { isSavableDocumentPath } from "../../utils/markdownFormat";

/**
 * Persist the currently open document if it has unsaved changes.
 * Call this before replacing the open buffer (single-document model).
 */
export async function flushActiveDocumentIfDirty(): Promise<boolean> {
  flushActiveEditorPendingChanges();

  const state = useAppStore.getState();
  const tabId = state.activeTabId;
  if (!tabId || !state.hasUnsavedChanges(tabId)) {
    return true;
  }

  const tabContent = state.fileContents[tabId];
  const node = findFileInTree(state.files, tabId);
  const savePath = node?.type === "file" ? node.path : tabId;
  if (tabContent === undefined || !savePath) {
    return false;
  }

  if (!isSavableDocumentPath(savePath)) {
    state.markAsSaved(tabId, tabContent);
    return true;
  }

  try {
    const fs = await getFileSystem();
    await fs.writeFile(savePath, tabContent);
    state.markAsSaved(tabId, tabContent);
    clearDraftBackup(tabId);
    void import("../vault/linkIndexEvents").then(({ notifyVaultFileSaved }) => {
      notifyVaultFileSaved(savePath, tabContent);
    });
    return true;
  } catch (error) {
    console.error(`Failed to flush active document ${tabId}:`, error);
    return false;
  }
}

/**
 * 尽量把所有脏 tab 写盘。树外节点回退用 tab id（绝对路径）作为保存路径。
 */
export async function flushAllDirtyOpenTabs(): Promise<boolean> {
  flushActiveEditorPendingChanges();

  const state = useAppStore.getState();
  const dirtyTabIds = state.openTabs.filter((tabId) =>
    state.hasUnsavedChanges(tabId),
  );
  if (dirtyTabIds.length === 0) return true;

  try {
    const fs = await getFileSystem();
    for (const tabId of dirtyTabIds) {
      const content = state.fileContents[tabId];
      if (content === undefined) continue;
      const node = findFileInTree(state.files, tabId);
      const savePath = node?.type === "file" ? node.path : tabId;
      if (!isSavableDocumentPath(savePath)) {
        state.markAsSaved(tabId, content);
        continue;
      }
      await fs.writeFile(savePath, content);
      state.markAsSaved(tabId, content);
      clearDraftBackup(tabId);
      void import("../vault/linkIndexEvents").then(
        ({ notifyVaultFileSaved }) => {
          notifyVaultFileSaved(savePath, content);
        },
      );
    }
    return true;
  } catch (error) {
    console.error("Failed to flush dirty tabs before close:", error);
    return false;
  }
}
