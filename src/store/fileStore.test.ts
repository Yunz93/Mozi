import { afterEach, describe, expect, it } from "vitest";
import type { FileNode } from "../types";
import { useAppStore } from "./appStore";

function fileNode(
  path: string,
  name: string,
  extras: Partial<FileNode> = {},
): FileNode {
  return {
    id: path,
    name,
    path,
    type: "file",
    isTrash: false,
    ...extras,
  };
}

afterEach(() => {
  useAppStore.setState({
    files: [],
    currentFilePath: null,
    rootFolderPath: "/vault",
  });
});

describe("fileStore.addFile", () => {
  it("does not duplicate a root drawing already present from a watcher refresh", () => {
    const drawing = fileNode("/vault/Robby.excalidraw", "Robby.excalidraw");
    useAppStore.setState({
      rootFolderPath: "/vault",
      files: [drawing],
    });

    useAppStore.getState().addFile(drawing);

    expect(useAppStore.getState().files).toEqual([drawing]);
  });

  it("does not duplicate a nested file already present under its parent", () => {
    const drawing = fileNode(
      "/vault/notes/Robby.excalidraw",
      "Robby.excalidraw",
    );
    const folder: FileNode = {
      id: "/vault/notes",
      name: "notes",
      path: "/vault/notes",
      type: "folder",
      isTrash: false,
      children: [drawing],
    };
    useAppStore.setState({
      rootFolderPath: "/vault",
      files: [folder],
    });

    useAppStore.getState().addFile(drawing);

    expect(useAppStore.getState().files[0]?.children).toEqual([drawing]);
  });

  it("still inserts a new root file when missing", () => {
    const drawing = fileNode("/vault/Robby.excalidraw", "Robby.excalidraw");
    useAppStore.setState({
      rootFolderPath: "/vault",
      files: [],
    });

    useAppStore.getState().addFile(drawing);

    expect(useAppStore.getState().files).toEqual([drawing]);
  });
});
