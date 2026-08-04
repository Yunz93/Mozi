import { describe, expect, it } from "vitest";
import {
  createEmptyExcalidrawDocument,
  isExcalidrawFileName,
  parseExcalidrawDocument,
  resolveExcalidrawFileName,
} from "./excalidrawDocument";

describe("isExcalidrawFileName", () => {
  it("matches .excalidraw and .excalidraw.json", () => {
    expect(isExcalidrawFileName("sketch.excalidraw")).toBe(true);
    expect(isExcalidrawFileName("sketch.EXCALIDRAW")).toBe(true);
    expect(isExcalidrawFileName("sketch.excalidraw.json")).toBe(true);
  });

  it("rejects markdown-wrapped and unrelated names", () => {
    expect(isExcalidrawFileName("sketch.excalidraw.md")).toBe(false);
    expect(isExcalidrawFileName("note.md")).toBe(false);
    expect(isExcalidrawFileName("drawing.json")).toBe(false);
  });
});

describe("createEmptyExcalidrawDocument", () => {
  it("produces a parseable empty scene", () => {
    const raw = createEmptyExcalidrawDocument();
    const doc = parseExcalidrawDocument(raw);
    expect(doc).not.toBeNull();
    expect(doc?.type).toBe("excalidraw");
    expect(doc?.elements).toEqual([]);
    expect(doc?.files).toEqual({});
  });
});

describe("parseExcalidrawDocument", () => {
  it("treats empty content as an empty scene", () => {
    expect(parseExcalidrawDocument("")).toMatchObject({
      type: "excalidraw",
      elements: [],
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseExcalidrawDocument("{not-json")).toBeNull();
    expect(parseExcalidrawDocument("[]")).toBeNull();
  });

  it("fills defaults for partial scenes", () => {
    const doc = parseExcalidrawDocument(
      JSON.stringify({ elements: [{ id: "a", type: "rectangle" }] }),
    );
    expect(doc?.elements).toHaveLength(1);
    expect(doc?.appState.viewBackgroundColor).toBe("#ffffff");
    expect(doc?.files).toEqual({});
  });
});

describe("resolveExcalidrawFileName", () => {
  it("appends .excalidraw when missing", () => {
    expect(resolveExcalidrawFileName("board")).toBe("board.excalidraw");
    expect(resolveExcalidrawFileName("board.excalidraw")).toBe(
      "board.excalidraw",
    );
    expect(resolveExcalidrawFileName("board.excalidraw.json")).toBe(
      "board.excalidraw.json",
    );
  });
});
