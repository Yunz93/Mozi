import { useAppStore } from "../../store/appStore";
import { getFileSystem } from "../../types/filesystem";
import { flushActiveEditorPendingChanges } from "../../utils/editorSelectionBridge";
import { clearDraftBackup } from "../../utils/draftBackup";
import { findFileInTree } from "../../utils/fileTree";
import { isSavableDocumentPath } from "../../utils/markdownFormat";
import { acquireDocumentWrite } from "./documentWriteQueue";

/** 脏状态检查也须等待旧写盘，否则撤销到干净状态时可能放行尚未完成的旧保存。 */
export async function flushDocumentIfDirty(tabId: string): Promise<boolean> {
  const initial = useAppStore.getState();
  const node = findFileInTree(initial.files, tabId);
  const savePath = node?.type === "file" ? node.path : tabId;
  const release = await acquireDocumentWrite(savePath);
  try {
    while (true) {
      flushActiveEditorPendingChanges();
      const state = useAppStore.getState();
      if (!state.openTabs.includes(tabId)) return false;
      if (!state.hasUnsavedChanges(tabId)) return true;
      const content = state.fileContents[tabId];
      if (content === undefined || !savePath) return false;
      if (!isSavableDocumentPath(savePath)) {
        state.markAsSaved(tabId, content);
        return true;
      }
      const fs = await getFileSystem();
      await fs.writeFile(savePath, content);
      state.markAsSaved(tabId, content);
      clearDraftBackup(tabId);
      void import("../vault/linkIndexEvents").then(
        ({ notifyVaultFileSaved }) => {
          notifyVaultFileSaved(savePath, content);
        },
      );
    }
  } catch (error) {
    console.error(`Failed to flush document ${tabId}:`, error);
    return false;
  } finally {
    release();
  }
}

/** 替换单文档缓冲前，等待所有在途保存及最新编辑落盘。 */
export async function flushActiveDocumentIfDirty(): Promise<boolean> {
  flushActiveEditorPendingChanges();
  const tabId = useAppStore.getState().activeTabId;
  return tabId ? flushDocumentIfDirty(tabId) : true;
}

/** 关闭前逐个保存打开的文档，包括尚在写盘但当前看似干净的文档。 */
export async function flushAllDirtyOpenTabs(): Promise<boolean> {
  flushActiveEditorPendingChanges();
  for (const tabId of useAppStore.getState().openTabs) {
    if (!(await flushDocumentIfDirty(tabId))) return false;
  }
  return true;
}
