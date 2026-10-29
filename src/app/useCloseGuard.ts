import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { isTauriEnvironment } from "../types/filesystem";
import { flushActiveEditorPendingChanges } from "../utils/editorSelectionBridge";
import { flushAllDirtyOpenTabs } from "../services/filesystem/flushActiveDocument";
import { writeDraftBackup } from "../utils/draftBackup";
import { t } from "../utils/i18n";
import {
  isUpdateInstallLocked,
  listenForUpdateSaveRequests,
  beginDocumentShutdown,
} from "../services/updateDocumentGuard";

type ForceSaveFn = (
  content?: string,
  options?: { trigger?: "auto" | "manual" | "system" },
) => Promise<boolean>;

export type CloseRequestSource = "window" | "exit";

function normalizeCloseSource(payload: unknown): CloseRequestSource {
  if (payload === "exit") return "exit";
  return "window";
}

function backupDirtyOpenTabs(): void {
  const state = useAppStore.getState();
  for (const tabId of state.openTabs) {
    if (!state.hasUnsavedChanges(tabId)) continue;
    const content = state.fileContents[tabId];
    if (content !== undefined) {
      writeDraftBackup(tabId, content);
    }
  }
}

async function invokeForceClose(source: CloseRequestSource): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  if (source === "exit") {
    await invoke("force_exit_app");
    return;
  }
  await invoke("force_close_window");
}

export async function completeAppClose(
  source: CloseRequestSource,
): Promise<void> {
  try {
    if (source === "exit") {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
      return;
    }

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
    return;
  } catch (error) {
    console.warn("Primary close path failed, forcing shutdown:", error);
  }

  try {
    await invokeForceClose(source);
  } catch (error) {
    console.error("Forced close failed:", error);
    // 单窗关闭失败不能退化为退出进程，否则会丢失其他窗口尚未保存的修改。
    if (source !== "exit") throw error;
    const { exit } = await import("@tauri-apps/plugin-process");
    await exit(0);
  }
}

/** 放弃全应用修改前逐窗备份，不能让确认框绕过其他窗口的保存保护。 */
export async function completeAppCloseAfterDiscard(
  source: CloseRequestSource,
): Promise<void> {
  if (source !== "exit") {
    await completeAppClose(source);
    return;
  }
  const release = await beginDocumentShutdown("exit", { backupOnly: true });
  try {
    await completeAppClose(source);
  } finally {
    await release();
  }
}

function requestCloseDespiteSaveFailure(source: CloseRequestSource): void {
  backupDirtyOpenTabs();
  const language = useAppStore.getState().settings.language;
  useAppStore
    .getState()
    .showNotification(t(language, "tab_closeBlockedUnsaved"), "error");
  useAppStore.getState().setPendingCloseDespiteSaveFailure(source);
}

/**
 * 拦截关窗 / Cmd+Q：先刷出编辑器待写入内容并尽量全部落盘。
 * 保存失败时弹出确认框，允许放弃更改后关闭，避免窗口被永久卡住。
 */
export function useCloseGuard(forceSave: ForceSaveFn): void {
  const isClosingRef = useRef(false);
  const forceSaveRef = useRef(forceSave);
  forceSaveRef.current = forceSave;

  useEffect(() => {
    if (!isTauriEnvironment()) {
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        flushActiveEditorPendingChanges();
        const state = useAppStore.getState();
        const hasDirty = state.openTabs.some((tabId) =>
          state.hasUnsavedChanges(tabId),
        );
        if (!hasDirty) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => {
        window.removeEventListener("beforeunload", onBeforeUnload);
      };
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let unlistenUpdates: (() => void) | null = null;

    const handleCloseRequested = async (source: CloseRequestSource) => {
      if (isClosingRef.current || isUpdateInstallLocked()) return;
      isClosingRef.current = true;

      try {
        flushActiveEditorPendingChanges();
        const state = useAppStore.getState();
        const dirtyTabIds = state.openTabs.filter((tabId) =>
          state.hasUnsavedChanges(tabId),
        );

        if (dirtyTabIds.length > 0) {
          const activeId = state.activeTabId;
          if (activeId && dirtyTabIds.includes(activeId)) {
            const saved = await forceSaveRef.current(undefined, {
              trigger: "system",
            });
            if (!saved) {
              requestCloseDespiteSaveFailure(source);
              return;
            }
          }
        }

        if (source === "exit") {
          const release = await beginDocumentShutdown("exit");
          try {
            await completeAppClose(source);
          } finally {
            await release();
          }
          return;
        }

        // 即使撤销后看似干净，也要等待在途写盘，避免旧保存覆盖撤销结果。
        const flushed = await flushAllDirtyOpenTabs();
        if (!flushed) {
          requestCloseDespiteSaveFailure(source);
          return;
        }

        await completeAppClose(source);
      } catch (error) {
        console.error("Failed to handle app close request:", error);
        requestCloseDespiteSaveFailure(source);
      } finally {
        isClosingRef.current = false;
      }
    };

    void (async () => {
      try {
        const stopUpdateListener = await listenForUpdateSaveRequests();
        if (cancelled) {
          stopUpdateListener();
          return;
        }
        unlistenUpdates = stopUpdateListener;
      } catch (error) {
        console.warn("Failed to listen for update save requests:", error);
      }
      if (cancelled) return;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlistenFn = await listen<unknown>(
          "app-close-requested",
          (event) => {
            void handleCloseRequested(normalizeCloseSource(event.payload));
          },
        );
        if (cancelled) {
          unlistenFn();
          return;
        }
        unlisten = unlistenFn;
      } catch (error) {
        console.warn("Failed to listen for app close requests:", error);
      }
    })();

    return () => {
      cancelled = true;
      unlistenUpdates?.();
      if (unlisten) {
        unlisten();
      }
    };
  }, []);
}
