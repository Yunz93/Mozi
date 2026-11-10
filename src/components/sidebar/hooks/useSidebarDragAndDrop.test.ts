// @vitest-environment happy-dom

import React from "react";
import { flushSync } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAG_DATA_TYPE } from "../dragPayload";
import { useSidebarDragAndDrop } from "./useSidebarDragAndDrop";

afterEach(cleanup);

function createRootDragEvent(
  types: string[],
  files: File[] = [],
  data: Record<string, string> = {},
): React.DragEvent<HTMLDivElement> {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types,
      files,
      items: [],
      dropEffect: "none",
      getData: (type: string) => data[type] ?? "",
    },
  } as unknown as React.DragEvent<HTMLDivElement>;
}

describe("useSidebarDragAndDrop", () => {
  it("keeps scrolling at the edge without more drag events and stops after drop", async () => {
    let frame: FrameRequestCallback | undefined;
    let nextId = 0;
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frame = callback;
        return ++nextId;
      });
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const element = document.createElement("div");
    element.scrollTop = 100;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 200,
      width: 200,
      height: 300,
      x: 0,
      y: 0,
      toJSON() {},
    });
    const ref = { current: element };
    const { result, unmount } = renderHook(() => useSidebarDragAndDrop(ref));
    const event = Object.assign(createRootDragEvent([DRAG_DATA_TYPE]), {
      clientX: 100,
      clientY: 295,
    });
    try {
      act(() => result.current.handleDragCapture?.(event));
      expect(request).toHaveBeenCalledOnce();
      act(() => frame!(0));
      const first = element.scrollTop;
      expect(first).toBeGreaterThan(100);
      act(() => frame!(16));
      expect(element.scrollTop).toBeGreaterThan(first);
      act(() => document.dispatchEvent(new Event("drop")));
      expect(cancel).toHaveBeenCalledWith(nextId);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(result.current.isDragging).toBe(false);
    } finally {
      unmount();
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it("accepts OS file drags on the root zone with a copy cursor", () => {
    const { result } = renderHook(() => useSidebarDragAndDrop());
    const event = createRootDragEvent(["Files", "text/plain"]);

    act(() => {
      result.current.handleRootDragOver(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer.dropEffect).toBe("copy");
    expect(result.current.isRootDragOver).toBe(true);
  });

  it("imports dropped files instead of treating OS text/plain as a move", () => {
    const { result } = renderHook(() => useSidebarDragAndDrop());
    const note = new File(["# hi"], "note.md", { type: "text/markdown" });
    const event = createRootDragEvent(["Files", "text/plain"], [note], {
      "text/plain": "/tmp/note.md",
    });
    const onMoveToRoot = vi.fn();
    const onImportDroppedFiles = vi.fn();

    act(() => {
      result.current.handleRootDrop(event, onMoveToRoot, onImportDroppedFiles);
    });

    expect(onImportDroppedFiles).toHaveBeenCalledWith([note]);
    expect(onMoveToRoot).not.toHaveBeenCalled();
  });

  it("still moves an in-tree node dropped on the root", () => {
    const { result } = renderHook(() => useSidebarDragAndDrop());
    const event = createRootDragEvent([DRAG_DATA_TYPE, "text/plain"], [], {
      [DRAG_DATA_TYPE]: "notes/todo.md",
      "text/plain": "notes/todo.md",
    });
    const onMoveToRoot = vi.fn();
    const onImportDroppedFiles = vi.fn();

    act(() => {
      result.current.handleRootDrop(event, onMoveToRoot, onImportDroppedFiles);
    });

    expect(onMoveToRoot).toHaveBeenCalledWith("notes/todo.md");
    expect(onImportDroppedFiles).not.toHaveBeenCalled();
  });
});

it("keeps the conditional root shortcut mounted until its drop handler prevents file navigation", () => {
  const move = vi.fn();
  function RootShortcut() {
    const drag = useSidebarDragAndDrop();
    return React.createElement(
      "aside",
      { "data-testid": "sidebar", onDragOverCapture: drag.handleDragCapture },
      drag.isDragging
        ? React.createElement(
            "div",
            {
              "data-testid": "root-shortcut",
              onDragOver: drag.handleRootDragOver,
              onDrop: (event: React.DragEvent<HTMLElement>) =>
                drag.handleRootDrop(event, move),
            },
            "Root",
          )
        : null,
    );
  }
  const view = render(React.createElement(RootShortcut));
  const dataTransfer = {
    types: [DRAG_DATA_TYPE],
    getData: () => "/vault/notes/note.md",
    dropEffect: "none",
  };
  fireEvent.dragOver(view.getByTestId("sidebar"), { dataTransfer });
  const shortcut = view.getByTestId("root-shortcut");
  // WebView 可在不同原生事件监听器之间提交状态；强制刷新以复现 capture 阶段移除目标。
  const flush = () => flushSync(() => {});
  document.addEventListener("drop", flush, true);
  try {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    fireEvent(shortcut, event);
    expect(move).toHaveBeenCalledExactlyOnceWith("/vault/notes/note.md");
    expect(event.defaultPrevented).toBe(true);
  } finally {
    document.removeEventListener("drop", flush, true);
  }
});
