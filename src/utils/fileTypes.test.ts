import { describe, expect, it } from "vitest";
import {
  getRenameDialogDefaultValue,
  isExcalidrawFile,
  isExcalidrawWorkspaceFile,
  isMarkdownFile,
  isOpenableFile,
  isSavableDocumentFile,
  resolveRenamedFileName,
  shouldReadInitialFileContent,
} from "./fileTypes";

describe("rename name helpers", () => {
  it("strips markdown extensions for the rename dialog", () => {
    expect(getRenameDialogDefaultValue("note.md")).toBe("note");
    expect(getRenameDialogDefaultValue("note.markdown")).toBe("note");
    expect(getRenameDialogDefaultValue("page.html")).toBe("page.html");
    expect(getRenameDialogDefaultValue("image.png")).toBe("image.png");
    expect(getRenameDialogDefaultValue("board.excalidraw")).toBe("board");
    expect(getRenameDialogDefaultValue("board.excalidraw.json")).toBe("board");
    expect(getRenameDialogDefaultValue("board.excalidraw.md")).toBe("board");
  });

  it("preserves markdown extensions when resolving rename input", () => {
    expect(resolveRenamedFileName("note.md", "renamed")).toBe("renamed.md");
    expect(resolveRenamedFileName("note.markdown", "renamed")).toBe(
      "renamed.markdown",
    );
    expect(resolveRenamedFileName("note.md", "renamed.markdown")).toBe(
      "renamed.markdown",
    );
  });

  it("preserves excalidraw extensions when resolving rename input", () => {
    expect(resolveRenamedFileName("board.excalidraw", "sketch")).toBe(
      "sketch.excalidraw",
    );
    expect(resolveRenamedFileName("board.excalidraw.json", "sketch")).toBe(
      "sketch.excalidraw.json",
    );
    expect(resolveRenamedFileName("board.excalidraw.md", "sketch")).toBe(
      "sketch.excalidraw.md",
    );
  });

  it("does not force .md onto non-markdown files", () => {
    expect(resolveRenamedFileName("page.html", "page.html")).toBe("page.html");
    expect(resolveRenamedFileName("page.html", "about")).toBe("about.html");
    expect(resolveRenamedFileName("image.PNG", "cover")).toBe("cover.PNG");
    expect(resolveRenamedFileName("doc.pdf", "doc.pdf")).toBe("doc.pdf");
  });
});

describe("excalidraw file predicates", () => {
  it("recognizes savable/openable drawings", () => {
    expect(isExcalidrawFile("a.excalidraw")).toBe(true);
    expect(isSavableDocumentFile("a.excalidraw")).toBe(true);
    expect(shouldReadInitialFileContent("a.excalidraw")).toBe(true);
    expect(
      isOpenableFile({
        id: "/a.excalidraw",
        name: "a.excalidraw",
        type: "file",
        path: "/a.excalidraw",
      }),
    ).toBe(true);
  });

  it("treats Obsidian .excalidraw.md as drawings, not markdown notes", () => {
    expect(isExcalidrawFile("a.excalidraw.md")).toBe(true);
    expect(isMarkdownFile("a.excalidraw.md")).toBe(false);
    expect(isSavableDocumentFile("a.excalidraw.md")).toBe(true);
    expect(shouldReadInitialFileContent("a.excalidraw.md")).toBe(true);
    expect(
      isOpenableFile({
        id: "/a.excalidraw.md",
        name: "a.excalidraw.md",
        type: "file",
        path: "/a.excalidraw.md",
      }),
    ).toBe(true);
  });

  it("treats Logseq-style .md drawings as workspace Excalidraw files", () => {
    const drawing = `---
excalidraw-plugin: parsed
---

# Excalidraw Data

## Drawing
\`\`\`json
{"type":"excalidraw","elements":[]}
\`\`\`
`;
    expect(isExcalidrawWorkspaceFile("board.md", drawing)).toBe(true);
    expect(isExcalidrawWorkspaceFile("board.md", "# note\n")).toBe(false);
    expect(isMarkdownFile("board.md")).toBe(true);
  });
});
