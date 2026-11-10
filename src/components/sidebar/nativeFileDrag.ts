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
const CANCELED_EVENT = "mozi-sidebar-native-drag-canceled";
const dropOrigins = new WeakMap<Event, NativeSession>();
const SHARED_DRAG_EVENT = "mozi-sidebar-native-file-session";
const currentVault = () =>
  (useAppStore.getState().rootFolderPath ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

export function nativeDraggedNodeId(
  event?: Event | { nativeEvent?: Event },
): string | null {
  // 同一知识库的窗口共享移动来源；其他知识库按系统文件导入处理。
  const nativeEvent =
    event &&
    ((event as { nativeEvent?: Event }).nativeEvent ?? (event as Event));
  const source = (nativeEvent && dropOrigins.get(nativeEvent)) || active;
  return source?.vault === currentVault() ? source.id : null;
}

export async function subscribeNativeFileDrag(): Promise<() => void> {
  if (!isTauriEnvironment()) return () => {};
  let observed: NativeSession | null = null;
  let depth = 0;
  const reset = () => {
    observed = null;
    depth = 0;
  };
  const cancel = (token: string) => {
    if (observed?.token === token) reset();
  };
  const canceled = (event: Event) => {
    const token = (event as CustomEvent<{ token: string }>).detail?.token;
    if (typeof token === "string") cancel(token);
  };
  const enter = () => {
    if (depth === 0) observed = null;
    depth += 1;
    if (active) observed = active;
  };
  const over = (event: Event) => {
    if (active) observed = active;
    // 最后一次 dragover 也可能晚于原生结束回调，仍须接管该次拖放而非让 WebView 打开文件。
    if (observed) dropOrigins.set(event, observed);
  };
  const leave = () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) observed = null;
  };
  const drop = (event: Event) => {
    // 在 React 处理之前把已见证的来源绑定到这一次 drop，原生结束回调不能抢先抹掉它。
    const source = active ?? observed;
    if (source) dropOrigins.set(event, source);
    reset();
  };
  const unsubscribe = await listen<
    NativeSession & { ended?: boolean; canceled?: boolean }
  >(SHARED_DRAG_EVENT, ({ payload }) => {
    if (
      !payload ||
      typeof payload.id !== "string" ||
      typeof payload.token !== "string" ||
      typeof payload.vault !== "string"
    )
      return;
    if (payload.ended) {
      if (payload.canceled) cancel(payload.token);
      window.setTimeout(() => {
        if (active?.token !== payload.token) return;
        active = null;
        window.dispatchEvent(
          new CustomEvent(NATIVE_DRAG_STATE_EVENT, {
            detail: { canceled: payload.canceled === true },
          }),
        );
      }, 0);
    } else {
      active = payload;
      window.dispatchEvent(new Event(NATIVE_DRAG_STATE_EVENT));
    }
  });
  document.addEventListener("dragenter", enter, true);
  document.addEventListener("dragover", over, true);
  document.addEventListener("dragleave", leave, true);
  document.addEventListener("drop", drop, true);
  window.addEventListener("blur", reset);
  window.addEventListener(CANCELED_EVENT, canceled);
  return () => {
    unsubscribe();
    document.removeEventListener("dragenter", enter, true);
    document.removeEventListener("dragover", over, true);
    document.removeEventListener("dragleave", leave, true);
    document.removeEventListener("drop", drop, true);
    window.removeEventListener("blur", reset);
    window.removeEventListener(CANCELED_EVENT, canceled);
    reset();
  };
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
  const finish = (canceled = false) => {
    if (finished) return;
    finished = true;
    if (canceled)
      window.dispatchEvent(
        new CustomEvent(CANCELED_EVENT, { detail: { token } }),
      );
    void emit(SHARED_DRAG_EVENT, { ...session, ended: true, canceled }).catch(
      () => {},
    );
    // 清理可见拖拽状态；晚到的 drop 使用捕获阶段绑定的来源。
    window.setTimeout(() => {
      if (active?.token === token) {
        active = null;
        window.dispatchEvent(
          new CustomEvent(NATIVE_DRAG_STATE_EVENT, { detail: { canceled } }),
        );
      }
      onFinish();
    }, 0);
  };
  void emit(SHARED_DRAG_EVENT, session)
    .then(() => {
      const onEnd = new Channel<boolean>();
      onEnd.onmessage = finish;
      return invoke("sidebar_start_file_drag", { path: node.path, onEnd });
    })
    .catch(() => {
      finish(true);
      onError();
    });
  return true;
}
