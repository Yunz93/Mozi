// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { DRAG_DATA_TYPE } from "../dragPayload";
import { useSidebarDragAndDrop } from "./useSidebarDragAndDrop";

function createRootDragEvent(
  types: string[],
  files: File[] = [],
  data: Record<string, string> = {},
): React.DragEvent<HTMLDivElement> {
  return {
    preventDefault: vi.fn(),
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
  it("keeps scrolling at the edge without more drag events and stops after drop", () => {
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
