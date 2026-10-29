import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../store/appStore";
import { t } from "../utils/i18n";
import { flushActiveEditorPendingChanges } from "../utils/editorSelectionBridge";
import { writeDraftBackup } from "../utils/draftBackup";
import { findFileInTree } from "../utils/fileTree";
import { acquireDocumentWrite } from "./filesystem/documentWriteQueue";
import { flushAllDirtyOpenTabs } from "./filesystem/flushActiveDocument";

const REQUEST_EVENT = "update-save-request";
const RESULT_EVENT = "update-save-result";
const RELEASE_EVENT = "update-save-release";
const SAVE_TIMEOUT_MS = 15_000;
export type ShutdownReason = "update" | "exit";
let lockId: string | null = null;
let blockInteraction:
  | ((locked: boolean, reason?: ShutdownReason) => boolean)
  | undefined;

export function isUpdateInstallLocked(): boolean {
  return lockId !== null;
}

export function registerUpdateInstallBlocker(
  blocker: (locked: boolean, reason?: ShutdownReason) => boolean,
): () => void {
  blockInteraction = blocker;
  return () => {
    if (blockInteraction === blocker) blockInteraction = undefined;
  };
}

function lock(requestId: string, reason: ShutdownReason = "update"): boolean {
  if (lockId && lockId !== requestId) return false;
  lockId = requestId;
  try {
    if (blockInteraction?.(true, reason)) return true;
  } catch {
    /* 界面无法阻止编辑时，拒绝安装。 */
  }
  lockId = null;
  return false;
}

function unlock(requestId: string): void {
  if (lockId !== requestId) return;
  lockId = null;
  blockInteraction?.(false);
}

function saveError(): Error {
  return new Error(
    t(useAppStore.getState().settings.language, "tab_closeBlockedUnsaved"),
  );
}

/** 明确放弃原文件写盘时，仍须确认每个窗口的最新草稿都已备份成功。 */
async function backupDirtyWindowDocuments(): Promise<boolean> {
  flushActiveEditorPendingChanges();
  const initial = useAppStore.getState();
  let backedUp = true;
  for (const tabId of initial.openTabs) {
    const node = findFileInTree(initial.files, tabId);
    const path = node?.type === "file" ? node.path : tabId;
    // 旧保存可能清理草稿，必须先等其完成，再保留最新缓冲；此处不写原文件。
    const release = await acquireDocumentWrite(path);
    try {
      const state = useAppStore.getState();
      if (!state.hasUnsavedChanges(tabId)) continue;
      const content = state.fileContents[tabId];
      if (content === undefined || !writeDraftBackup(tabId, content))
        backedUp = false;
    } finally {
      release();
    }
  }
  return backedUp;
}

/** 每个窗口只回报保存结果，由发起关闭或更新的窗口统一决定是否退出。 */
export async function listenForUpdateSaveRequests(): Promise<() => void> {
  const label = getCurrentWindow().label;
  const unlistenRequest = await listen<{
    requestId: string;
    replyTo: string;
    reason: ShutdownReason;
    backupOnly?: boolean;
  }>(REQUEST_EVENT, (event) => {
    const { requestId, replyTo, reason, backupOnly } = event.payload;
    void (async () => {
      let saved = false;
      if (lock(requestId, reason)) {
        try {
          saved = backupOnly
            ? await backupDirtyWindowDocuments()
            : await flushAllDirtyOpenTabs();
        } catch {
          /* 保存异常按失败回报。 */
        }
      }
      await emitTo(replyTo, RESULT_EVENT, { requestId, label, saved });
    })().catch(() => {
      unlock(requestId);
    });
  });
  try {
    const unlistenRelease = await listen<{ requestId: string }>(
      RELEASE_EVENT,
      (event) => {
        unlock(event.payload.requestId);
      },
    );
    return () => {
      unlistenRequest();
      unlistenRelease();
    };
  } catch (error) {
    unlistenRequest();
    throw error;
  }
}

/** 安装前锁住所有窗口并等待各自写盘；失败或超时会释放全部窗口。 */
export async function beginDocumentShutdown(
  reason: ShutdownReason,
  options?: { backupOnly?: boolean },
): Promise<() => Promise<void>> {
  const requestId = crypto.randomUUID();
  const current = getCurrentWindow().label;
  if (!lock(requestId, reason)) throw saveError();
  const participants = new Set<string>();
  const saved = new Set<string>();
  let wake: (() => void) | undefined;
  let failed = false;
  let released = false;
  let unlisten: (() => void) | undefined;
  const release = async () => {
    if (released) return;
    released = true;
    unlisten?.();
    unlock(requestId);
    await invoke("set_update_install_lock", { requestId, locked: false }).catch(
      () => {},
    );
    await Promise.allSettled(
      [...participants].map((label) =>
        emitTo(label, RELEASE_EVENT, { requestId }),
      ),
    );
  };

  try {
    await invoke("set_update_install_lock", { requestId, locked: true });
    unlisten = await listen<{
      requestId: string;
      label: string;
      saved: boolean;
    }>(RESULT_EVENT, (event) => {
      if (
        event.payload.requestId !== requestId ||
        !participants.has(event.payload.label)
      )
        return;
      if (event.payload.saved) saved.add(event.payload.label);
      else failed = true;
      wake?.();
    });
    const deadline = Date.now() + SAVE_TIMEOUT_MS;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const localSaved = await Promise.race([
        options?.backupOnly
          ? backupDirtyWindowDocuments()
          : flushAllDirtyOpenTabs(),
        new Promise<never>((_, reject) => {
          saveTimer = setTimeout(() => reject(saveError()), SAVE_TIMEOUT_MS);
        }),
      ]);
      if (!localSaved) throw saveError();
    } finally {
      if (saveTimer) clearTimeout(saveTimer);
    }
    while (true) {
      const windows = await getAllWindows();
      const live = new Set(windows.map((window) => window.label));
      for (const label of live) {
        if (label === current || participants.has(label)) continue;
        participants.add(label);
        await emitTo(label, REQUEST_EVENT, {
          requestId,
          replyTo: current,
          reason,
          ...(options?.backupOnly ? { backupOnly: true } : {}),
        });
      }
      if (failed) throw saveError();
      // 已关闭的窗口不再需要回执；新开的窗口须加入同一保存屏障。
      if ([...live].every((label) => label === current || saved.has(label))) {
        const finalWindows = await getAllWindows();
        if (finalWindows.every((window) => live.has(window.label)))
          return release;
        if (Date.now() >= deadline) throw saveError();
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw saveError();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(remaining, 100));
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = undefined;
    }
  } catch (error) {
    await release();
    throw error;
  }
}

/** 更新在全窗保存后安装，普通退出复用同一写盘屏障。 */
export function beginUpdateInstall(): Promise<() => Promise<void>> {
  return beginDocumentShutdown("update");
}
