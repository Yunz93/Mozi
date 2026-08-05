import { describe, expect, it } from "vitest";
import {
  createEmptyExcalidrawDocument,
  extractExcalidrawJsonFromObsidianMd,
  isExcalidrawFileName,
  isObsidianExcalidrawMarkdown,
  parseExcalidrawDocument,
  resolveExcalidrawFileName,
  serializeExcalidrawContent,
} from "./excalidrawDocument";

describe("isExcalidrawFileName", () => {
  it("matches .excalidraw, .excalidraw.json, and Obsidian .excalidraw.md", () => {
    expect(isExcalidrawFileName("sketch.excalidraw")).toBe(true);
    expect(isExcalidrawFileName("sketch.EXCALIDRAW")).toBe(true);
    expect(isExcalidrawFileName("sketch.excalidraw.json")).toBe(true);
    expect(isExcalidrawFileName("sketch.excalidraw.md")).toBe(true);
  });

  it("rejects unrelated names", () => {
    expect(isExcalidrawFileName("note.md")).toBe(false);
    expect(isExcalidrawFileName("drawing.json")).toBe(false);
    expect(isExcalidrawFileName("sketch.excalidraw.txt")).toBe(false);
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

  it("parses Obsidian .excalidraw.md wrappers", () => {
    const scene = {
      type: "excalidraw",
      version: 2,
      elements: [{ id: "r1", type: "rectangle" }],
      appState: { viewBackgroundColor: "#fff" },
      files: {},
    };
    const wrapped = `---
excalidraw-plugin: parsed
tags:
  - excalidraw
excalidraw-default-mode: view
---
# 灵波具身智能产品架构

# Excalidraw Data

## Text Elements
ARCHITECTURE · KAMI DIAGRAM ^T0000001

## Drawing
\`\`\`json
${JSON.stringify(scene, null, 2)}
\`\`\`
`;
    expect(isObsidianExcalidrawMarkdown(wrapped)).toBe(true);
    const doc = parseExcalidrawDocument(wrapped);
    expect(doc?.elements).toHaveLength(1);
    expect((doc?.elements[0] as { id: string }).id).toBe("r1");
  });
});

describe("serializeExcalidrawContent", () => {
  it("preserves Obsidian markdown wrappers when saving", () => {
    const previous = `---
excalidraw-plugin: parsed
---
# Title

## Drawing
\`\`\`json
{"type":"excalidraw","elements":[]}
\`\`\`
`;
    const nextJson = JSON.stringify(
      {
        type: "excalidraw",
        version: 2,
        elements: [{ id: "n1", type: "ellipse" }],
        appState: {},
        files: {},
      },
      null,
      2,
    );
    const saved = serializeExcalidrawContent(nextJson, previous);
    expect(saved).toContain("excalidraw-plugin: parsed");
    expect(saved).toContain("# Title");
    expect(extractExcalidrawJsonFromObsidianMd(saved)).toContain("n1");
    const parsed = parseExcalidrawDocument(saved);
    expect((parsed?.elements[0] as { id: string }).id).toBe("n1");
  });

  it("writes plain JSON for standalone .excalidraw files", () => {
    const json = '{\n  "type": "excalidraw",\n  "elements": []\n}';
    expect(serializeExcalidrawContent(json, json)).toBe(`${json}\n`);
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
    expect(resolveExcalidrawFileName("board.excalidraw.md")).toBe(
      "board.excalidraw.md",
    );
  });
});
