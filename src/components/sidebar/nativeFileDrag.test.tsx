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
  end: null as ((canceled?: boolean) => void) | null,
  emit: vi.fn(),
  listener: null as
    | ((event: {
        payload: {
          id: string;
          token: string;
          vault: string;
          ended?: boolean;
          canceled?: boolean;
        };
      }) => void)
    | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
  Channel: class {
    cleanupCallback() {}
    set onmessage(callback: (canceled?: boolean) => void) {
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
    stopPropagation: vi.fn(),
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
    stopPropagation: vi.fn(),
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

function NativeDropZone({
  move,
  copy,
}: {
  move: (id: string) => void;
  copy: (files: File[]) => void;
}) {
  const drag = useSidebarDragAndDrop();
  return (
    <div
      data-testid="drop-zone"
      data-dragging={drag.isDragging}
      onDragOver={drag.handleRootDragOver}
      onDrop={(event) => drag.handleRootDrop(event, move, copy)}
    />
  );
}

const nativeTransfer = () => ({
  types: ["Files"],
  files: [new File(["note"], "note.md")],
  items: [],
  getData: () => "",
  dropEffect: "none",
});

it("keeps a witnessed native origin when the end callback arrives before the root drop", async () => {
  const move = vi.fn(),
    copy = vi.fn();
  const { getByTestId } = render(<NativeDropZone move={move} copy={copy} />);
  await act(async () => {
    beginNativeFileDrag(node, vi.fn(), vi.fn());
    await Promise.resolve();
  });
  const zone = getByTestId("drop-zone"),
    dataTransfer = nativeTransfer();
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.dragOver(zone, { dataTransfer });
  act(() => {
    bridge.end?.(false);
    vi.runAllTimers();
  });
  expect(nativeDraggedNodeId()).toBeNull();
  expect(zone.getAttribute("data-dragging")).toBe("true");
  fireEvent.drop(zone, { dataTransfer });
  expect(zone.getAttribute("data-dragging")).toBe("false");
  expect(move).toHaveBeenCalledExactlyOnceWith(node.id);
  expect(copy).not.toHaveBeenCalled();
});

it("keeps a witnessed native origin for folder drops after native session cleanup", async () => {
  const move = vi.fn(),
    copy = vi.fn();
  const { result } = renderHook(() => useSidebarDragAndDrop());
  expect(result.current).toBeDefined();
  const { getByTitle } = render(
    <FileTreeItem
      node={{
        id: "/vault/folder",
        path: "/vault/folder",
        name: "folder",
        type: "folder",
      }}
      level={0}
      activeId={null}
      onSelect={vi.fn()}
      onContextMenu={vi.fn()}
      onMoveNode={move}
      onImportDroppedFiles={copy}
    />,
  );
  await act(async () => {
    beginNativeFileDrag(node, vi.fn(), vi.fn());
    await Promise.resolve();
  });
  const target = getByTitle("folder"),
    dataTransfer = nativeTransfer();
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  act(() => {
    bridge.end?.(false);
    vi.runAllTimers();
  });
  fireEvent.drop(target, { dataTransfer });
  expect(move).toHaveBeenCalledExactlyOnceWith(node.id, "/vault/folder");
  expect(copy).not.toHaveBeenCalled();
});

it("does not reuse a cancelled source for the next external drag", async () => {
  const move = vi.fn(),
    copy = vi.fn();
  const { getByTestId } = render(<NativeDropZone move={move} copy={copy} />);
  await act(async () => {
    beginNativeFileDrag(node, vi.fn(), vi.fn());
    await Promise.resolve();
  });
  const zone = getByTestId("drop-zone"),
    dataTransfer = nativeTransfer();
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.dragOver(zone, { dataTransfer });
  act(() => {
    bridge.end?.(true);
    vi.runAllTimers();
  });
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.drop(zone, { dataTransfer });
  expect(move).not.toHaveBeenCalled();
  expect(copy).toHaveBeenCalledExactlyOnceWith(dataTransfer.files);
});

it("clears the witnessed source when the drag leaves the window before an external import", async () => {
  const move = vi.fn(),
    copy = vi.fn();
  const { getByTestId } = render(<NativeDropZone move={move} copy={copy} />);
  await act(async () => {
    beginNativeFileDrag(node, vi.fn(), vi.fn());
    await Promise.resolve();
  });
  const zone = getByTestId("drop-zone"),
    dataTransfer = nativeTransfer();
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.dragOver(zone, { dataTransfer });
  fireEvent.dragLeave(zone, { dataTransfer });
  act(() => {
    bridge.end?.(false);
    vi.runAllTimers();
  });
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.drop(zone, { dataTransfer });
  expect(move).not.toHaveBeenCalled();
  expect(copy).toHaveBeenCalledExactlyOnceWith(dataTransfer.files);
});

it("does not move a captured source into another vault", async () => {
  const move = vi.fn(),
    copy = vi.fn();
  const { getByTestId } = render(<NativeDropZone move={move} copy={copy} />);
  await act(async () => {
    beginNativeFileDrag(node, vi.fn(), vi.fn());
    await Promise.resolve();
  });
  const zone = getByTestId("drop-zone"),
    dataTransfer = nativeTransfer();
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.dragOver(zone, { dataTransfer });
  act(() => {
    bridge.end?.(false);
    vi.runAllTimers();
    useAppStore.setState({ rootFolderPath: "/other" });
  });
  fireEvent.drop(zone, { dataTransfer });
  expect(move).not.toHaveBeenCalled();
  expect(copy).toHaveBeenCalledExactlyOnceWith(dataTransfer.files);
});

it("prevents a root drop from bubbling into another import handler", async () => {
  const move = vi.fn(),
    copy = vi.fn(),
    outer = vi.fn();
  const { getByTestId } = render(
    <div onDrop={outer}>
      <NativeDropZone move={move} copy={copy} />
    </div>,
  );
  fireEvent.drop(getByTestId("drop-zone"), { dataTransfer: nativeTransfer() });
  expect(copy).toHaveBeenCalledOnce();
  expect(outer).not.toHaveBeenCalled();
});

it("still accepts a file-URL dragover on the root shortcut after native completion", async () => {
  const move = vi.fn(),
    copy = vi.fn();
  const { getByTestId } = render(<NativeDropZone move={move} copy={copy} />);
  await act(async () => {
    beginNativeFileDrag(node, vi.fn(), vi.fn());
    await Promise.resolve();
  });
  const zone = getByTestId("drop-zone");
  fireEvent.dragEnter(zone, { dataTransfer: nativeTransfer() });
  fireEvent.dragOver(zone, { dataTransfer: nativeTransfer() });
  act(() => {
    bridge.end?.(false);
    vi.runAllTimers();
  });
  const dataTransfer = {
    types: ["text/uri-list"],
    files: [],
    items: [],
    getData: () => "file:///vault/note.md",
    dropEffect: "none",
  };
  const over = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(over, "dataTransfer", { value: dataTransfer });
  fireEvent(zone, over);
  expect(over.defaultPrevented).toBe(true);
  fireEvent.drop(zone, { dataTransfer });
  expect(move).toHaveBeenCalledExactlyOnceWith(node.id);
  expect(copy).not.toHaveBeenCalled();
});
