import { describe, expect, it } from "vitest";
import {
  compressObsidianExcalidrawJson,
  createEmptyExcalidrawDocument,
  extractExcalidrawJsonFromObsidianMd,
  isCompressedObsidianDrawing,
  isExcalidrawFileName,
  isExcalidrawWorkspaceFile,
  isObsidianExcalidrawMarkdown,
  parseExcalidrawDocument,
  resolveExcalidrawFileName,
  serializeExcalidrawContent,
} from "./excalidrawDocument";

const SAMPLE_SCENE = {
  type: "excalidraw" as const,
  version: 2,
  elements: [{ id: "r1", type: "rectangle" }],
  appState: { viewBackgroundColor: "#fff" },
  files: {},
};

function wrapObsidianDrawing(options: { compressed?: boolean }): string {
  const json = JSON.stringify(SAMPLE_SCENE);
  const fence = options.compressed
    ? `\`\`\`compressed-json\n${compressObsidianExcalidrawJson(json)}\n\`\`\``
    : `\`\`\`json\n${JSON.stringify(SAMPLE_SCENE, null, 2)}\n\`\`\``;
  return `---
excalidraw-plugin: parsed
tags:
  - excalidraw
---
# Back of the note

# Excalidraw Data

## Text Elements
ARCHITECTURE · KAMI DIAGRAM ^T0000001

## Drawing
${fence}
%%
`;
}

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

describe("isExcalidrawWorkspaceFile", () => {
  it("treats .excalidraw.md by filename even without reading content", () => {
    expect(isExcalidrawWorkspaceFile("board.excalidraw.md")).toBe(true);
  });

  it("treats Logseq-style .md drawings by Obsidian frontmatter", () => {
    const wrapped = wrapObsidianDrawing({ compressed: true });
    expect(isExcalidrawWorkspaceFile("board.md", wrapped)).toBe(true);
    expect(isExcalidrawWorkspaceFile("board.md", "# just a note\n")).toBe(
      false,
    );
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
    const wrapped = wrapObsidianDrawing({ compressed: false });
    expect(isObsidianExcalidrawMarkdown(wrapped)).toBe(true);
    const doc = parseExcalidrawDocument(wrapped);
    expect(doc?.elements).toHaveLength(1);
    expect((doc?.elements[0] as { id: string }).id).toBe("r1");
  });

  it("parses Obsidian compressed-json drawings (default plugin format)", () => {
    const wrapped = wrapObsidianDrawing({ compressed: true });
    expect(isCompressedObsidianDrawing(wrapped)).toBe(true);
    expect(isObsidianExcalidrawMarkdown(wrapped)).toBe(true);
    const doc = parseExcalidrawDocument(wrapped);
    expect(doc?.elements).toHaveLength(1);
    expect((doc?.elements[0] as { id: string }).id).toBe("r1");
  });

  it("strips Obsidian 256-character line wraps before LZ-String decode", () => {
    const elements = Array.from({ length: 80 }, (_, i) => ({
      id: `el-${i}`,
      type: "rectangle",
      x: i,
      y: i,
    }));
    const scene = {
      type: "excalidraw",
      version: 2,
      elements,
      appState: {},
      files: {},
    };
    const compressed = compressObsidianExcalidrawJson(JSON.stringify(scene));
    expect(compressed).toContain("\n\n");
    const wrapped = `---
excalidraw-plugin: parsed
---
# Excalidraw Data

## Drawing
\`\`\`compressed-json
${compressed}
\`\`\`
`;
    const doc = parseExcalidrawDocument(wrapped);
    expect(doc?.elements).toHaveLength(80);
  });

  it("does not treat a regular note with a Drawing heading as Excalidraw", () => {
    const note = `# Sketch ideas\n\n## Drawing\nJust a heading about drawing.\n`;
    expect(isObsidianExcalidrawMarkdown(note)).toBe(false);
    expect(parseExcalidrawDocument(note)).toBeNull();
  });
});

describe("serializeExcalidrawContent", () => {
  it("preserves Obsidian markdown wrappers when saving", () => {
    const previous = wrapObsidianDrawing({ compressed: false });
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
    expect(saved).toContain("# Back of the note");
    expect(saved).toContain("```json");
    expect(extractExcalidrawJsonFromObsidianMd(saved)).toContain("n1");
    const parsed = parseExcalidrawDocument(saved);
    expect((parsed?.elements[0] as { id: string }).id).toBe("n1");
  });

  it("round-trips compressed-json so Obsidian can still open the file", () => {
    const previous = wrapObsidianDrawing({ compressed: true });
    const nextJson = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [{ id: "n1", type: "ellipse" }],
      appState: {},
      files: {},
    });
    const saved = serializeExcalidrawContent(nextJson, previous);
    expect(saved).toContain("excalidraw-plugin: parsed");
    expect(saved).toContain("```compressed-json");
    expect(saved).not.toContain('"type": "excalidraw"');
    expect(isCompressedObsidianDrawing(saved)).toBe(true);
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
