// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type React from "react";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  end: null as (() => void) | null,
  emit: vi.fn(),
  listener: null as
    | ((event: {
        payload: { id: string; token: string; vault: string; ended?: boolean };
      }) => void)
    | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
  Channel: class {
    cleanupCallback() {}
    set onmessage(callback: () => void) {
      bridge.end = callback;
    }
  },
}));
vi.mock("../../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: bridge.emit,
  listen: async (_: string, listener: typeof bridge.listener) => {
    bridge.listener = listener;
    return () => {};
  },
}));
import { beginNativeFileDrag, nativeDraggedNodeId } from "./nativeFileDrag";
import { useSidebarDragAndDrop } from "./hooks/useSidebarDragAndDrop";
import { FileTreeItem } from "./FileTree";
import { defaultSettings, useAppStore } from "../../store/appStore";

const node = {
  id: "/vault/note.md",
  path: "/vault/note.md",
  name: "note.md",
  type: "file" as const,
};
beforeEach(() => {
  vi.useFakeTimers();
  bridge.invoke.mockReset().mockResolvedValue(undefined);
  bridge.emit.mockReset().mockResolvedValue(undefined);
  bridge.end = null;
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
    rootFolderPath: "/vault",
  });
});
afterEach(async () => {
  await act(async () => {
    bridge.end?.();
    await vi.runAllTimersAsync();
  });
  cleanup();
  vi.useRealTimers();
});

it("starts a native file-reference drag and cancels the browser path-text drag", async () => {
  const { getByTitle } = render(
    <FileTreeItem
      node={node}
      level={0}
      activeId={null}
      onSelect={vi.fn()}
      onContextMenu={vi.fn()}
      onMoveNode={vi.fn()}
    />,
  );
  const setData = vi.fn();
  const browserContinues = fireEvent.dragStart(getByTitle("note"), {
    dataTransfer: { setData },
  });
  expect(browserContinues).toBe(false);
  expect(setData).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.resolve();
  });
  expect(bridge.invoke).toHaveBeenCalledWith("sidebar_start_file_drag", {
    path: node.path,
    onEnd: expect.any(Object),
  });
  expect(nativeDraggedNodeId()).toBe(node.id);
});

it("moves its native file inside the sidebar instead of importing a second copy, then clears the source", async () => {
  const { result } = renderHook(() => useSidebarDragAndDrop());
  const finish = vi.fn();
  act(() => {
    beginNativeFileDrag(node, finish, vi.fn());
  });
  await act(async () => {
    await Promise.resolve();
  });
  const file = new File(["# Note"], "note.md");
  const event = {
    preventDefault: vi.fn(),
    dataTransfer: {
      types: ["Files"],
      files: [file],
      items: [],
      getData: () => "",
      dropEffect: "none",
    },
  } as unknown as React.DragEvent<HTMLDivElement>;
  const move = vi.fn();
  const copy = vi.fn();
  act(() => result.current.handleRootDragOver(event));
  expect(event.dataTransfer.dropEffect).toBe("copy");
  act(() => result.current.handleRootDrop(event, move, copy));
  expect(move).toHaveBeenCalledExactlyOnceWith(node.id);
  expect(copy).not.toHaveBeenCalled();
  act(() => {
    bridge.end?.();
    vi.runAllTimers();
  });
  expect(nativeDraggedNodeId()).toBeNull();
  expect(finish).toHaveBeenCalledOnce();
  act(() => result.current.handleRootDrop(event, move, copy));
  expect(copy).toHaveBeenCalledExactlyOnceWith([file]);
  expect(move).toHaveBeenCalledOnce();
});

it("reports a failed native start and releases the source for subsequent external drags", async () => {
  bridge.invoke.mockRejectedValueOnce(new Error("file disappeared"));
  const failed = vi.fn();
  const finish = vi.fn();
  beginNativeFileDrag(node, finish, failed);
  await act(async () => {
    await Promise.resolve();
  });
  act(() => vi.runAllTimers());
  expect(failed).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledOnce();
  expect(nativeDraggedNodeId()).toBeNull();
});

it("shares native move origins across windows in the same vault and imports from a different vault", async () => {
  const { result } = renderHook(() => useSidebarDragAndDrop());
  await act(async () => {
    await Promise.resolve();
  });
  const session = { id: node.id, token: "shared-session", vault: "/vault" };
  act(() => bridge.listener?.({ payload: session }));
  expect(nativeDraggedNodeId()).toBe(node.id);
  const file = new File(["# Note"], "note.md");
  const event = {
    preventDefault: vi.fn(),
    dataTransfer: {
      types: ["Files"],
      files: [file],
      items: [],
      getData: () => "",
      dropEffect: "none",
    },
  } as unknown as React.DragEvent<HTMLDivElement>;
  const move = vi.fn();
  const copy = vi.fn();
  act(() => result.current.handleRootDrop(event, move, copy));
  expect(move).toHaveBeenCalledExactlyOnceWith(node.id);
  expect(copy).not.toHaveBeenCalled();
  act(() => bridge.listener?.({ payload: { ...session, ended: true } }));
  act(() => vi.runAllTimers());
  expect(nativeDraggedNodeId()).toBeNull();
  act(() =>
    bridge.listener?.({
      payload: { ...session, token: "other-session", vault: "/other" },
    }),
  );
  act(() => result.current.handleRootDrop(event, move, copy));
  expect(copy).toHaveBeenCalledExactlyOnceWith([file]);
  act(() =>
    bridge.listener?.({
      payload: {
        ...session,
        token: "other-session",
        vault: "/other",
        ended: true,
      },
    }),
  );
  act(() => vi.runAllTimers());
});
