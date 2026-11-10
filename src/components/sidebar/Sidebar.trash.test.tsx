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
it("keeps the sidebar on its normal file tree without exposing deleted files or a Trash section", () => {
  const props = sidebarProps();
  const view = render(
    <Sidebar
      {...props}
      files={[
        {
          id: "/vault/笔记.md",
          path: "/vault/笔记.md",
          name: "笔记.md",
          type: "file",
        },
        {
          id: "/vault/.trash/123__已删除/已删除.md",
          path: "/vault/.trash/123__已删除/已删除.md",
          name: "已删除.md",
          type: "file",
          isTrash: true,
        },
      ]}
    />,
  );
  expect(view.container.textContent).toContain("笔记");
  expect(view.container.textContent).not.toContain("已删除");
  expect(screen.queryByRole("button", { name: /^回收站/ })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
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
    expect(view.container.querySelector("[data-root-drop-zone]")).toBeNull();
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperties(over, {
      clientX: { value: 100 },
      clientY: { value: 295 },
      dataTransfer: { value: { types: ["Files"], dropEffect: "none" } },
    });
    fireEvent(row, over);
    expect(request).toHaveBeenCalledOnce();
    expect(view.container.querySelector("[data-root-drop-zone]")).toBeTruthy();
    fireEvent.dragLeave(row, { relatedTarget: document.body });
    expect(cancel).toHaveBeenCalledWith(71);
    expect(view.container.querySelector("[data-root-drop-zone]")).toBeNull();
  } finally {
    view.unmount();
    request.mockRestore();
    cancel.mockRestore();
  }
});

it("restores from the standalone dialog and requires confirmation before permanent deletion", async () => {
  const { TrashDialog } = await import("./TrashDialog");
  const file = {
    id: "deleted",
    path: "/vault/.trash/123__note/note.md",
    name: "note.md",
    type: "file" as const,
    isTrash: true,
  };
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    files: [file],
    trashFolder: ".trash",
    onRestore: vi.fn(),
    onDeleteForever: vi.fn(),
    onEmptyTrash: vi.fn(),
  };
  render(<TrashDialog {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "还原 note.md" }));
  await vi.waitFor(() => expect(props.onRestore).toHaveBeenCalledWith(file));
  await vi.waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "永久删除 note.md",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "永久删除 note.md" }));
  expect(props.onDeleteForever).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(props.onDeleteForever).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "永久删除 note.md" }));
  fireEvent.click(screen.getByRole("button", { name: /^永久删除$/ }));
  await vi.waitFor(() =>
    expect(props.onDeleteForever).toHaveBeenCalledWith(file),
  );
});

it("keeps empty-trash confirmation in the same dialog and refreshes the empty state", async () => {
  const { TrashDialog } = await import("./TrashDialog");
  const file = {
    id: "deleted",
    path: "/vault/.trash/123__note/note.md",
    name: "note.md",
    type: "file" as const,
    isTrash: true,
  };
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    files: [file],
    trashFolder: ".trash",
    onRestore: vi.fn(),
    onDeleteForever: vi.fn(),
    onEmptyTrash: vi.fn(),
  };
  const view = render(<TrashDialog {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
  expect(props.onEmptyTrash).not.toHaveBeenCalled();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "取消" }),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(props.onClose).not.toHaveBeenCalled();
  expect(screen.getByText("note.md")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
  fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
  await vi.waitFor(() =>
    expect(props.onEmptyTrash).toHaveBeenCalledWith([file]),
  );
  view.rerender(<TrashDialog {...props} files={[]} />);
  await vi.waitFor(() => expect(screen.getByText("回收站为空")).toBeTruthy());
  expect(
    (screen.getByRole("button", { name: "清空回收站" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
