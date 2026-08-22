// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../store/uiStore";
import { useAppStore } from "../../store/appStore";
import { FileTreeItem } from "./FileTree";
import { DRAG_DATA_TYPE } from "./dragPayload";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
  });
});

describe("FileTreeItem external file drop", () => {
  it("imports files dropped onto a folder", () => {
    const onImportDroppedFiles = vi.fn();
    const onMoveNode = vi.fn();
    const { getByTitle } = render(
      <FileTreeItem
        node={{
          id: "/vault/Notes",
          name: "Notes",
          type: "folder",
          path: "/vault/Notes",
          children: [],
        }}
        level={0}
        activeId={null}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
        onMoveNode={onMoveNode}
        onImportDroppedFiles={onImportDroppedFiles}
      />,
    );

    const note = new File(["# hi"], "hello.md", { type: "text/markdown" });
    fireEvent.drop(getByTitle("Notes"), {
      dataTransfer: {
        types: ["Files", "text/plain"],
        files: [note],
        items: [],
        getData: () => "/tmp/hello.md",
        dropEffect: "none",
      },
    });

    expect(onImportDroppedFiles).toHaveBeenCalledWith("/vault/Notes", [note]);
    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it("imports files dropped onto a file into the parent folder", () => {
    const onImportDroppedFiles = vi.fn();
    const { getByTitle } = render(
      <FileTreeItem
        node={{
          id: "/vault/Notes/todo.md",
          name: "todo.md",
          type: "file",
          path: "/vault/Notes/todo.md",
        }}
        level={0}
        activeId={null}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
        onMoveNode={vi.fn()}
        onImportDroppedFiles={onImportDroppedFiles}
      />,
    );

    const image = new File(["img"], "shot.png", { type: "image/png" });
    fireEvent.drop(getByTitle("todo"), {
      dataTransfer: {
        types: ["Files"],
        files: [image],
        items: [],
        getData: () => "",
        dropEffect: "none",
      },
    });

    expect(onImportDroppedFiles).toHaveBeenCalledWith("/vault/Notes", [image]);
  });

  it("keeps in-tree moves when no Files payload is present", () => {
    const onImportDroppedFiles = vi.fn();
    const onMoveNode = vi.fn();
    const { getByTitle } = render(
      <FileTreeItem
        node={{
          id: "/vault/Notes",
          name: "Notes",
          type: "folder",
          path: "/vault/Notes",
          children: [],
        }}
        level={0}
        activeId={null}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
        onMoveNode={onMoveNode}
        onImportDroppedFiles={onImportDroppedFiles}
      />,
    );

    fireEvent.drop(getByTitle("Notes"), {
      dataTransfer: {
        types: [DRAG_DATA_TYPE, "text/plain"],
        files: [],
        items: [],
        getData: (type: string) =>
          type === DRAG_DATA_TYPE ? "/vault/other.md" : "",
        dropEffect: "none",
      },
    });

    expect(onMoveNode).toHaveBeenCalledWith("/vault/other.md", "/vault/Notes");
    expect(onImportDroppedFiles).not.toHaveBeenCalled();
  });
});
