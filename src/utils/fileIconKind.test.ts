import { describe, expect, it } from "vitest";
import { getFileIconKind, getFileTypeBadge } from "./fileIconKind";

describe("getFileIconKind", () => {
  it("classifies markdown and related", () => {
    expect(getFileIconKind("note.md")).toBe("markdown");
    expect(getFileIconKind("page.MDX")).toBe("markdown");
    expect(getFileIconKind("long.markdown")).toBe("markdown");
  });

  it("classifies images and pdf", () => {
    expect(getFileIconKind("a.PNG")).toBe("image");
    expect(getFileIconKind("x.webp")).toBe("image");
    expect(getFileIconKind("doc.pdf")).toBe("pdf");
  });

  it("classifies excalidraw drawings", () => {
    expect(getFileIconKind("board.excalidraw")).toBe("excalidraw");
    expect(getFileIconKind("board.excalidraw.json")).toBe("excalidraw");
  });

  it("classifies archives and media", () => {
    expect(getFileIconKind("b.zip")).toBe("archive");
    expect(getFileIconKind("c.mp3")).toBe("audio");
    expect(getFileIconKind("d.mp4")).toBe("video");
  });

  it("defaults for unknown or no extension", () => {
    expect(getFileIconKind("Makefile")).toBe("file");
    expect(getFileIconKind(".env")).toBe("file");
    expect(getFileIconKind("readme")).toBe("file");
  });

  it("classifies code files", () => {
    expect(getFileIconKind("script.js")).toBe("code");
    expect(getFileIconKind("app.py")).toBe("code");
    expect(getFileIconKind("main.rs")).toBe("code");
  });

  it("returns file for trailing dot", () => {
    expect(getFileIconKind("readme.")).toBe("file");
  });

  it("returns file for dot-only filenames like .gitignore", () => {
    expect(getFileIconKind(".gitignore")).toBe("file");
  });

  it("returns file for empty extension after dot", () => {
    expect(getFileIconKind("file.")).toBe("file");
  });

  it("returns file for filename starting with dot and having extension", () => {
    expect(getFileIconKind(".env.local")).toBe("file");
  });

  it("returns file for unknown extension", () => {
    expect(getFileIconKind("data.xyz")).toBe("file");
    expect(getFileIconKind("archive.7zip")).toBe("file");
  });

  it("classifies text files", () => {
    expect(getFileIconKind("log.txt")).toBe("text");
    expect(getFileIconKind("data.csv")).toBe("text");
    expect(getFileIconKind("notes.rtf")).toBe("text");
  });

  it("classifies spreadsheets and presentations", () => {
    expect(getFileIconKind("budget.xlsx")).toBe("spreadsheet");
    expect(getFileIconKind("slides.pptx")).toBe("presentation");
  });
});

describe("getFileTypeBadge", () => {
  it("uses MD for markdown variants", () => {
    expect(getFileTypeBadge("note.md")).toBe("MD");
    expect(getFileTypeBadge("page.markdown")).toBe("MD");
    expect(getFileTypeBadge("x.mdx")).toBe("MD");
  });

  it("uses DRAW for excalidraw", () => {
    expect(getFileTypeBadge("board.excalidraw")).toBe("DRAW");
    expect(getFileTypeBadge("board.excalidraw.json")).toBe("DRAW");
  });

  it("uppercases common extensions", () => {
    expect(getFileTypeBadge("photo.png")).toBe("PNG");
    expect(getFileTypeBadge("doc.PDF")).toBe("PDF");
    expect(getFileTypeBadge("archive.zip")).toBe("ZIP");
  });

  it("returns null without a usable extension", () => {
    expect(getFileTypeBadge("Makefile")).toBeNull();
    expect(getFileTypeBadge(".gitignore")).toBeNull();
    expect(getFileTypeBadge("readme.")).toBeNull();
  });
});
