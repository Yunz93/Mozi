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
  if (tabContent === undefined || !node || node.type !== "file") {
    return false;
  }

  if (!isSavableDocumentPath(node.path)) {
    state.markAsSaved(tabId, tabContent);
    return true;
  }

  try {
    const fs = await getFileSystem();
    await fs.writeFile(node.path, tabContent);
    state.markAsSaved(tabId, tabContent);
    clearDraftBackup(tabId);
    void import("../vault/linkIndexEvents").then(({ notifyVaultFileSaved }) => {
      notifyVaultFileSaved(node.path, tabContent);
    });
    return true;
  } catch (error) {
    console.error(`Failed to flush active document ${tabId}:`, error);
    return false;
  }
}
