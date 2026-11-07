import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../store/appStore";
import { isTauriEnvironment } from "../types/filesystem";
import { getActiveEditorView } from "../utils/editorSelectionBridge";
import { isEditorImeComposing } from "../components/editor/behavior/imeGuard";
import { useI18n } from "../hooks/useI18n";

const NO_OVERLAYS: Readonly<Record<string, boolean>> = {};

export function useFocusMode(
  enabled: boolean,
  // 新增弹层入口时登记其打开状态，让用户请求的界面能退出专注并立即显示。
  overlays: Readonly<Record<string, boolean>> = NO_OVERLAYS,
): void {
  const transition = useRef<Promise<void>>(Promise.resolve());
  const previousOverlays = useRef(overlays);
  const { t } = useI18n();
  useEffect(() => {
    const opened = Object.keys(overlays).some(
      (key) => overlays[key] && !previousOverlays.current[key],
    );
    previousOverlays.current = overlays;
    if (enabled && opened)
      useAppStore.getState().updateSettings({ focusMode: false });
  }, [enabled, overlays]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let exitedNatively = false;
    let unlisten: (() => void) | undefined;
    let restore: (() => Promise<void>) | undefined;
    const exit = () =>
      useAppStore.getState().updateSettings({ focusMode: false });
    const handleKeyDown = (event: KeyboardEvent) => {
      const view = getActiveEditorView();
      if (
        !["Escape", "F8"].includes(event.key) ||
        event.isComposing ||
        (view && isEditorImeComposing(view))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      exit();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    useAppStore.getState().setSettingsOpen(false);
    getActiveEditorView()?.focus();

    if (isTauriEnvironment()) {
      const appWindow = getCurrentWindow();
      // 串行恢复与进入，避免连续切换把新的专注会话退回普通窗口。
      transition.current = transition.current
        .then(async () => {
          if (cancelled) return;
          const alreadyFullscreen = await appWindow.isFullscreen();
          if (cancelled) return;
          restore = async () => {
            if (!alreadyFullscreen && !exitedNatively)
              await appWindow.setFullscreen(false);
          };
          if (!alreadyFullscreen) await appWindow.setFullscreen(true);
          if (cancelled) return;
          unlisten = await appWindow.onResized(async () => {
            if (cancelled || (await appWindow.isFullscreen())) return;
            if (cancelled) return;
            exitedNatively = true;
            exit();
          });
          if (cancelled) unlisten();
        })
        .catch((error) => {
          console.error("Failed to enter focus mode", error);
          if (!cancelled) {
            exit();
            useAppStore
              .getState()
              .showNotification(t("focusMode_fullscreenFailed"), "error");
          }
        });
    }
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKeyDown, true);
      unlisten?.();
      transition.current = transition.current
        .then(async () => {
          unlisten?.();
          await restore?.();
        })
        .catch((error) =>
          console.error("Failed to restore focus mode window", error),
        );
    };
  }, [enabled, t]);
}
