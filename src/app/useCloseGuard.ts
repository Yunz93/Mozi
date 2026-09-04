import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { isTauriEnvironment } from "../types/filesystem";
import { flushActiveEditorPendingChanges } from "../utils/editorSelectionBridge";
import { flushAllDirtyOpenTabs } from "../services/filesystem/flushActiveDocument";
import { t } from "../utils/i18n";

type ForceSaveFn = (
  content?: string,
  options?: { trigger?: "auto" | "manual" | "system" },
) => Promise<boolean>;

type CloseRequestSource = "window" | "exit";

function normalizeCloseSource(payload: unknown): CloseRequestSource {
  if (payload === "exit") return "exit";
  return "window";
}

/**
 * 拦截关窗 / Cmd+Q：先刷出编辑器待写入内容并尽量全部落盘，失败则不关闭。
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

    const handleCloseRequested = async (source: CloseRequestSource) => {
      if (isClosingRef.current) return;
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
              const language = useAppStore.getState().settings.language;
              useAppStore
                .getState()
                .showNotification(
                  t(language, "tab_closeBlockedUnsaved"),
                  "error",
                );
              return;
            }
          }

          const flushed = await flushAllDirtyOpenTabs();
          if (!flushed) {
            const language = useAppStore.getState().settings.language;
            useAppStore
              .getState()
              .showNotification(
                t(language, "tab_closeBlockedUnsaved"),
                "error",
              );
            return;
          }
        }

        if (source === "exit") {
          const { exit } = await import("@tauri-apps/plugin-process");
          await exit(0);
          return;
        }

        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().destroy();
      } catch (error) {
        console.error("Failed to handle app close request:", error);
        const language = useAppStore.getState().settings.language;
        useAppStore
          .getState()
          .showNotification(t(language, "tab_closeBlockedUnsaved"), "error");
      } finally {
        isClosingRef.current = false;
      }
    };

    void (async () => {
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
      if (unlisten) {
        unlisten();
      }
    };
  }, []);
}
