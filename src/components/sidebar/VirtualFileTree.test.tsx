// @vitest-environment happy-dom
import { useRef, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileNode } from "../../types";
import { VirtualFileTree } from "./VirtualFileTree";
import { DRAG_DATA_TYPE } from "./dragPayload";

const onSelect = vi.fn();
const onMoveNode = vi.fn();
const onImportDroppedFiles = vi.fn();
const file = (name: string): FileNode => ({
  id: `/vault/${name}.md`,
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  type: "file",
});
const many = Array.from({ length: 10000 }, (_, i) =>
  file(`note-${String(i).padStart(5, "0")}`),
);
let rowHeight = 36;
const observers = new Set<() => void>();

function Harness(props: Partial<ComponentProps<typeof VirtualFileTree>>) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      data-testid="scroll"
      ref={ref}
      style={{ height: 300, overflowY: "auto" }}
    >
      <VirtualFileTree
        nodes={many}
        scrollElementRef={ref}
        activeId={null}
        onSelect={onSelect}
        onContextMenu={vi.fn()}
        onMoveNode={onMoveNode}
        onImportDroppedFiles={onImportDroppedFiles}
        {...props}
      />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rowHeight = 36;
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-file-tree-item") ? rowHeight : 300;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {
        observers.add(callback);
      }
      observe() {}
      disconnect() {
        observers.delete(this.callback);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  observers.clear();
});

it("bounds the DOM for 10,000 notes and opens a row reached by scrolling", () => {
  const view = render(<Harness />);
  expect(
    view.container.querySelectorAll("[data-file-tree-item]").length,
  ).toBeLessThan(30);
  expect(view.queryByTitle("note-09999")).toBeNull();
  fireEvent.scroll(view.getByTestId("scroll"), {
    target: { scrollTop: 9999 * 38 },
  });
  fireEvent.click(view.getByTitle("note-09999"));
  expect(onSelect).toHaveBeenCalledWith(many[9999]);
  expect(
    view.container.querySelectorAll("[data-file-tree-item]").length,
  ).toBeLessThan(30);
});

it("locates an offscreen active note and adapts to UI row-height changes", () => {
  const view = render(<Harness />);
  view.rerender(<Harness activeId={many[9999].id} locateRequestKey={1} />);
  expect(view.getByTitle("note-09999").getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(view.getByTestId("scroll").scrollTop).toBeGreaterThan(370000);
  act(() => {
    rowHeight = 48;
    for (const notify of [...observers]) notify();
  });
  view.rerender(<Harness activeId={many[9999].id} locateRequestKey={2} />);
  expect(view.getByTestId("scroll").scrollTop).toBeGreaterThan(490000);
  expect(view.getByTitle("note-09999")).toBeTruthy();
});

it("keeps folder expansion when a row leaves the viewport and locates nested notes", () => {
  const child = file("folder/child");
  const folder: FileNode = {
    id: "/vault/folder",
    path: "/vault/folder",
    name: "folder",
    type: "folder",
    children: [child],
  };
  const nodes = [folder, ...many];
  const view = render(<Harness nodes={nodes} />);
  fireEvent.click(view.getByTitle("folder"));
  expect(view.getByTitle("folder/child")).toBeTruthy();
  fireEvent.scroll(view.getByTestId("scroll"), {
    target: { scrollTop: 200000 },
  });
  expect(view.queryByTitle("folder")).toBeNull();
  fireEvent.scroll(view.getByTestId("scroll"), { target: { scrollTop: 0 } });
  expect(view.getByTitle("folder/child")).toBeTruthy();
  fireEvent.click(view.getByTitle("folder"));
  expect(view.queryByTitle("folder/child")).toBeNull();
  view.rerender(
    <Harness
      nodes={nodes}
      activeId={child.id}
      locateRequestKey={1}
      expandedPathIds={new Set([folder.id])}
    />,
  );
  expect(view.getByTitle("folder/child")).toBeTruthy();
});

it("preserves external imports, internal drops, and hover expansion", () => {
  vi.useFakeTimers();
  const folder: FileNode = {
    id: "/vault/folder",
    path: "/vault/folder",
    name: "folder",
    type: "folder",
    children: [file("child")],
  };
  const view = render(<Harness nodes={[folder, ...many]} />);
  const dataTransfer = {
    types: [DRAG_DATA_TYPE],
    getData: () => "/vault/source.md",
    dropEffect: "none",
  };
  fireEvent.dragOver(view.getByTitle("folder"), { dataTransfer });
  act(() => {
    vi.advanceTimersByTime(420);
  });
  expect(view.getByTitle("child")).toBeTruthy();
  fireEvent.drop(view.getByTitle("folder"), { dataTransfer });
  expect(onMoveNode).toHaveBeenCalledWith("/vault/source.md", folder.id);
  const note = new File(["note"], "import.md");
  fireEvent.drop(view.getByTitle("folder"), {
    dataTransfer: {
      types: ["Files"],
      files: [note],
      items: [],
      getData: () => "",
    },
  });
  expect(onImportDroppedFiles).toHaveBeenCalledWith(folder.path, [note]);
});

it("filters trash and preserves root order, child sorting, and force expansion", () => {
  const a = file("A");
  const b = file("B");
  const trash = { ...file("trash"), isTrash: true };
  const folder: FileNode = {
    id: "folder",
    path: "/vault/folder",
    name: "folder",
    type: "folder",
    children: [b, trash, a],
  };
  const view = render(<Harness nodes={[folder, file("Z")]} forceExpanded />);
  expect(
    [...view.container.querySelectorAll(".workspace-tree-row")].map((row) =>
      row.getAttribute("title"),
    ),
  ).toEqual(["folder", "A", "B", "Z"]);
});
