import { describe, expect, it } from "vitest";
import type { FileNode } from "../types";
import {
  buildFileTreeSignature,
  collectRemovedOpenTabIds,
  detectOpenTabPathRemaps,
  preserveOpenTabNodes,
} from "./fileTree";

const folder: FileNode = {
  id: "/vault/docs",
  name: "docs",
  path: "/vault/docs",
  type: "folder",
  children: [
    {
      id: "/vault/docs/guide.md",
      name: "guide.md",
      path: "/vault/docs/guide.md",
      type: "file",
    },
  ],
};

const note: FileNode = {
  id: "/vault/note.md",
  name: "note.md",
  path: "/vault/note.md",
  type: "file",
};

const renamedNote: FileNode = {
  id: "/vault/renamed.md",
  name: "renamed.md",
  path: "/vault/renamed.md",
  type: "file",
};

describe("buildFileTreeSignature", () => {
  it("changes when a file is removed from the tree", () => {
    const before = buildFileTreeSignature([folder, note]);
    const after = buildFileTreeSignature([folder]);

    expect(before).not.toBe(after);
  });
});

describe("collectRemovedOpenTabIds", () => {
  it("returns open tabs whose files disappeared from the next tree", () => {
    const removed = collectRemovedOpenTabIds(
      [folder, note],
      [],
      [note.id, folder.id, "/vault/docs/guide.md"],
    );

    expect(removed).toEqual([note.id, "/vault/docs/guide.md"]);
  });
});

describe("detectOpenTabPathRemaps", () => {
  it("does not remap a 1:1 pair when basename or extension differs", () => {
    const remaps = detectOpenTabPathRemaps([note], [renamedNote], [note.id]);

    expect(remaps).toEqual({});
  });

  it("remaps a 1:1 pair when basename and extension match ignoring case", () => {
    const moved: FileNode = {
      id: "/vault/docs/note.md",
      name: "note.md",
      path: "/vault/docs/note.md",
      type: "file",
    };
    const remaps = detectOpenTabPathRemaps([note], [moved], [note.id]);

    expect(remaps).toEqual({ [note.id]: moved.path });
  });
});

describe("preserveOpenTabNodes", () => {
  it("re-appends open tabs that disappeared from the refreshed tree", () => {
    const preserved = preserveOpenTabNodes([folder], [note.id], [folder, note]);

    expect(preserved).toEqual([folder, note]);
  });
});
