import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../types/filesystem";
import type { FileNode } from "../../types";
import { emit, listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../store/appStore";

interface NativeSession {
  id: string;
  token: string;
  vault: string;
}
let active: NativeSession | null = null;
export const NATIVE_DRAG_STATE_EVENT = "mozi-sidebar-native-drag-state";
const SHARED_DRAG_EVENT = "mozi-sidebar-native-file-session";
const currentVault = () =>
  (useAppStore.getState().rootFolderPath ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

export function nativeDraggedNodeId(): string | null {
  // 同一知识库的窗口共享移动来源；其他知识库按系统文件导入处理。
  return active?.vault === currentVault() ? active.id : null;
}

export async function subscribeNativeFileDrag(): Promise<() => void> {
  if (!isTauriEnvironment()) return () => {};
  return listen<NativeSession & { ended?: boolean }>(
    SHARED_DRAG_EVENT,
    ({ payload }) => {
      if (
        !payload ||
        typeof payload.id !== "string" ||
        typeof payload.token !== "string" ||
        typeof payload.vault !== "string"
      )
        return;
      if (payload.ended) {
        window.setTimeout(() => {
          if (active?.token !== payload.token) return;
          active = null;
          window.dispatchEvent(new Event(NATIVE_DRAG_STATE_EVENT));
        }, 0);
      } else {
        active = payload;
        window.dispatchEvent(new Event(NATIVE_DRAG_STATE_EVENT));
      }
    },
  );
}

export function beginNativeFileDrag(
  node: FileNode,
  onFinish: () => void,
  onError: () => void,
): boolean {
  if (!isTauriEnvironment()) return false;
  const token = crypto.randomUUID();
  const session = { id: node.id, token, vault: currentVault() };
  active = session;
  window.dispatchEvent(new Event(NATIVE_DRAG_STATE_EVENT));
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    void emit(SHARED_DRAG_EVENT, { ...session, ended: true }).catch(() => {});
    // 让已排队的 WebView drop 先读取来源，再清理原生会话。
    window.setTimeout(() => {
      if (active?.token === token) {
        active = null;
        window.dispatchEvent(new Event(NATIVE_DRAG_STATE_EVENT));
      }
      onFinish();
    }, 0);
  };
  void emit(SHARED_DRAG_EVENT, session)
    .then(() => {
      const onEnd = new Channel<void>();
      onEnd.onmessage = finish;
      return invoke("sidebar_start_file_drag", { path: node.path, onEnd });
    })
    .catch(() => {
      finish();
      onError();
    });
  return true;
}
