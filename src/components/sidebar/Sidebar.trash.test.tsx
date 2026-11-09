// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { defaultSettings, useAppStore } from "../../store/appStore";

beforeEach(() =>
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
    fileContents: {},
  }),
);
afterEach(cleanup);
function sidebarProps() {
  return {
    files: [],
    activeFileId: null,
    onFileSelect: vi.fn(),
    onCreateFile: vi.fn(),
    onCreateDrawing: vi.fn(),
    onNewFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReveal: vi.fn(),
    onMoveToTrash: vi.fn(),
    onRestoreFromTrash: vi.fn(),
    onDeleteForever: vi.fn(),
    onEmptyTrash: vi.fn(),
    onMoveNode: vi.fn(),
    onMoveToRoot: vi.fn(),
    onSwitchKnowledgeBase: vi.fn(),
    onOpenSettings: vi.fn(),
    isOpen: true,
    width: 280,
    onWidthChange: vi.fn(),
    onClose: vi.fn(),
    currentKnowledgeBasePath: "/vault",
  };
}
it("keeps Trash out of the sidebar until More requests it, and can close and reopen it", () => {
  const props = sidebarProps();
  const view = render(<Sidebar {...props} trashOpenRequestKey={0} />);
  expect(screen.queryByRole("button", { name: /^回收站/ })).toBeNull();
  view.rerender(<Sidebar {...props} trashOpenRequestKey={1} />);
  const close = screen.getByRole("button", { name: /^回收站/ });
  fireEvent.click(close);
  expect(screen.queryByRole("button", { name: /^回收站/ })).toBeNull();
  view.rerender(<Sidebar {...props} trashOpenRequestKey={2} />);
  expect(screen.getByRole("button", { name: /^回收站/ })).toBeTruthy();
});

it("imports external drops over the footer without browser navigation or duplicate tree imports", () => {
  const onImportDroppedFiles = vi.fn();
  const view = render(
    <Sidebar {...sidebarProps()} onImportDroppedFiles={onImportDroppedFiles} />,
  );
  const file = new File(["fixture"], "large.pdf");
  const drop = (element: Element) => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["Files"], files: [file], items: [], getData: () => "" },
    });
    fireEvent(element, event);
    expect(event.defaultPrevented).toBe(true);
  };
  drop(view.container.querySelector(".workspace-sidebar-footer")!);
  expect(onImportDroppedFiles).toHaveBeenCalledExactlyOnceWith("/vault", [
    file,
  ]);
  drop(view.container.querySelector(".scrollbar-hide")!);
  expect(onImportDroppedFiles).toHaveBeenCalledTimes(2);
});

it("stops edge scrolling when a file row stops dragleave from bubbling outside the sidebar", () => {
  const request = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(71);
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {});
  const node = {
    id: "/vault/note.md",
    path: "/vault/note.md",
    name: "note.md",
    type: "file" as const,
  };
  const view = render(<Sidebar {...sidebarProps()} files={[node]} />);
  try {
    const scroller =
      view.container.querySelector<HTMLDivElement>(".scrollbar-hide")!;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      left: 0,
      right: 200,
      x: 0,
      y: 0,
      width: 200,
      height: 300,
      toJSON() {},
    });
    const row = screen.getByTitle("note");
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperties(over, {
      clientX: { value: 100 },
      clientY: { value: 295 },
      dataTransfer: { value: { types: ["Files"], dropEffect: "none" } },
    });
    fireEvent(row, over);
    expect(request).toHaveBeenCalledOnce();
    fireEvent.dragLeave(row, { relatedTarget: document.body });
    expect(cancel).toHaveBeenCalledWith(71);
  } finally {
    view.unmount();
    request.mockRestore();
    cancel.mockRestore();
  }
});
