// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { FileNode } from "../../types";
import { resolveTreeDropFolderPath } from "./FileTree";

function fileNode(path: string, type: FileNode["type"]): FileNode {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return { id: path, name, type, path };
}

describe("resolveTreeDropFolderPath", () => {
  it("uses a folder node as the destination", () => {
    expect(resolveTreeDropFolderPath(fileNode("/vault/Notes", "folder"))).toBe(
      "/vault/Notes",
    );
  });

  it("uses the parent folder when dropping onto a file", () => {
    expect(
      resolveTreeDropFolderPath(fileNode("/vault/Notes/todo.md", "file")),
    ).toBe("/vault/Notes");
  });
});
