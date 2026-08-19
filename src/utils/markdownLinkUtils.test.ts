import { describe, expect, it } from "vitest";
import {
  extractAttachmentTargets,
  flattenFiles,
  isMarkdownFile,
} from "./markdownLinkUtils";
import type { FileNode } from "../types";

describe("extractAttachmentTargets", () => {
  it("extracts angle-bracket markdown destinations with titles", () => {
    expect(
      extractAttachmentTargets(
        '![cover](<../resources/my file.png> "cover title")',
      ),
    ).toEqual(["../resources/my file.png"]);
  });

  it("extracts plain markdown destinations with titles", () => {
    expect(
      extractAttachmentTargets(
        '![cover](../resources/cover.png "cover title")',
      ),
    ).toEqual(["../resources/cover.png"]);
  });

  it("extracts markdown image destinations that contain spaces", () => {
    expect(
      extractAttachmentTargets(
        "![M 記](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1.png)",
      ),
    ).toEqual([
      "https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1.png",
    ]);
  });

  it("extracts wiki embed targets", () => {
    expect(extractAttachmentTargets("![[image.png]]")).toEqual(["image.png"]);
  });

  it("extracts wiki embed targets with alias", () => {
    expect(extractAttachmentTargets("![[image.png|alias]]")).toEqual([
      "image.png",
    ]);
  });

  it("extracts wiki embed targets with heading subpath", () => {
    expect(extractAttachmentTargets("![[note.md#Heading]]")).toEqual([
      "note.md#Heading",
    ]);
  });

  it("ignores empty wiki references", () => {
    expect(extractAttachmentTargets("[[]]")).toEqual([]);
  });

  it("ignores wiki references with only whitespace", () => {
    expect(extractAttachmentTargets("[[   ]]")).toEqual([]);
  });

  it("extracts HTML attachment targets", () => {
    expect(
      extractAttachmentTargets('<img src="image.png" alt="test">'),
    ).toEqual(["image.png"]);
  });

  it("extracts HTML audio/video/source targets", () => {
    expect(
      extractAttachmentTargets(
        '<audio src="song.mp3"></audio><video src="clip.mp4"></video><source src="track.ogg">',
      ),
    ).toEqual(["song.mp3", "clip.mp4", "track.ogg"]);
  });

  it("extracts HTML link href targets", () => {
    expect(extractAttachmentTargets('<a href="doc.pdf">Download</a>')).toEqual([
      "doc.pdf",
    ]);
  });

  it("ignores empty HTML targets", () => {
    expect(extractAttachmentTargets('<img src="" alt="empty">')).toEqual([]);
  });

  it("ignores HTML targets with only whitespace", () => {
    expect(extractAttachmentTargets('<img src="   " alt="spaces">')).toEqual(
      [],
    );
  });
});

describe("flattenFiles", () => {
  it("returns empty array for empty input", () => {
    expect(flattenFiles([])).toEqual([]);
  });

  it("flattens a single file node", () => {
    const node: FileNode = {
      id: "1",
      name: "a.md",
      type: "file",
      path: "/a.md",
    };
    expect(flattenFiles([node])).toEqual([node]);
  });

  it("excludes trashed files", () => {
    const node: FileNode = {
      id: "1",
      name: "a.md",
      type: "file",
      path: "/a.md",
      isTrash: true,
    };
    expect(flattenFiles([node])).toEqual([]);
  });

  it("flattens nested folders recursively", () => {
    const nodes: FileNode[] = [
      {
        id: "1",
        name: "folder",
        type: "folder",
        path: "/folder",
        children: [
          { id: "2", name: "a.md", type: "file", path: "/folder/a.md" },
          {
            id: "3",
            name: "subfolder",
            type: "folder",
            path: "/folder/subfolder",
            children: [
              {
                id: "4",
                name: "b.md",
                type: "file",
                path: "/folder/subfolder/b.md",
              },
            ],
          },
        ],
      },
    ];
    expect(flattenFiles(nodes)).toEqual([
      { id: "2", name: "a.md", type: "file", path: "/folder/a.md" },
      { id: "4", name: "b.md", type: "file", path: "/folder/subfolder/b.md" },
    ]);
  });

  it("filters out trashed files inside folders", () => {
    const nodes: FileNode[] = [
      {
        id: "1",
        name: "folder",
        type: "folder",
        path: "/folder",
        children: [
          { id: "2", name: "a.md", type: "file", path: "/folder/a.md" },
          {
            id: "3",
            name: "b.md",
            type: "file",
            path: "/folder/b.md",
            isTrash: true,
          },
        ],
      },
    ];
    expect(flattenFiles(nodes)).toEqual([
      { id: "2", name: "a.md", type: "file", path: "/folder/a.md" },
    ]);
  });

  it("handles folders with no children", () => {
    const nodes: FileNode[] = [
      {
        id: "1",
        name: "empty",
        type: "folder",
        path: "/empty",
        children: [],
      },
    ];
    expect(flattenFiles(nodes)).toEqual([]);
  });

  it("handles folders with undefined children", () => {
    const nodes: FileNode[] = [
      {
        id: "1",
        name: "empty",
        type: "folder",
        path: "/empty",
      },
    ];
    expect(flattenFiles(nodes)).toEqual([]);
  });
});

describe("isMarkdownFile", () => {
  it("returns true for .md files", () => {
    expect(
      isMarkdownFile({
        id: "1",
        name: "note.md",
        type: "file",
        path: "/note.md",
      }),
    ).toBe(true);
  });

  it("returns true for .markdown files", () => {
    expect(
      isMarkdownFile({
        id: "1",
        name: "note.markdown",
        type: "file",
        path: "/note.markdown",
      }),
    ).toBe(true);
  });

  it("returns true for .MD uppercase", () => {
    expect(
      isMarkdownFile({
        id: "1",
        name: "NOTE.MD",
        type: "file",
        path: "/NOTE.MD",
      }),
    ).toBe(true);
  });

  it("returns false for non-markdown files", () => {
    expect(
      isMarkdownFile({
        id: "1",
        name: "image.png",
        type: "file",
        path: "/image.png",
      }),
    ).toBe(false);
  });

  it("returns false for files without extension", () => {
    expect(
      isMarkdownFile({
        id: "1",
        name: "Makefile",
        type: "file",
        path: "/Makefile",
      }),
    ).toBe(false);
  });
});
