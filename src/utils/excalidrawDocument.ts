/**
 * Helpers for `.excalidraw` scene files (JSON) and Obsidian `.excalidraw.md`.
 * Keep parse/create free of the heavy `@excalidraw/excalidraw` runtime so
 * file-type routing and unit tests stay lightweight.
 *
 * Obsidian Excalidraw plugin format (zsviczian/obsidian-excalidraw-plugin):
 * - YAML frontmatter with `excalidraw-plugin:`
 * - Optional markdown "back of the note"
 * - `# Excalidraw Data` with `## Text Elements` / `## Drawing`
 * - Drawing JSON in a ```json or ```compressed-json fence (LZ-String, 256-char chunks)
 */

import LZString from "lz-string";

export const EXCALIDRAW_SOURCE = "https://github.com/Yunz93/Mozi";

/** Standalone `.excalidraw` / `.excalidraw.json`, or Obsidian `.excalidraw.md`. */
export const EXCALIDRAW_FILE_REGEX = /\.excalidraw(?:\.json|\.md)?$/i;

const OBSIDIAN_COMPRESSED_FENCE = "compressed-json";
const LZ_CHUNK_SIZE = 256;

export interface ExcalidrawDocument {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function isExcalidrawFileName(name: string): boolean {
  return EXCALIDRAW_FILE_REGEX.test(name.trim());
}

/**
 * Filename `.excalidraw*` **or** an Obsidian markdown drawing (`.md` with
 * `excalidraw-plugin` frontmatter / `# Excalidraw Data`).
 */
export function isExcalidrawWorkspaceFile(
  name: string,
  content?: string | null,
): boolean {
  if (isExcalidrawFileName(name)) return true;
  return typeof content === "string" && isObsidianExcalidrawMarkdown(content);
}

export function createEmptyExcalidrawDocument(): string {
  const doc: ExcalidrawDocument = {
    type: "excalidraw",
    version: 2,
    source: EXCALIDRAW_SOURCE,
    elements: [],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    },
    files: {},
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function emptyDocument(): ExcalidrawDocument {
  return {
    type: "excalidraw",
    version: 2,
    source: EXCALIDRAW_SOURCE,
    elements: [],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    },
    files: {},
  };
}

function documentFromParsedJson(parsed: unknown): ExcalidrawDocument | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const elements = Array.isArray(record.elements) ? record.elements : [];
  const appState =
    record.appState &&
    typeof record.appState === "object" &&
    !Array.isArray(record.appState)
      ? (record.appState as Record<string, unknown>)
      : { viewBackgroundColor: "#ffffff", gridSize: null };
  const files =
    record.files &&
    typeof record.files === "object" &&
    !Array.isArray(record.files)
      ? (record.files as Record<string, unknown>)
      : {};

  return {
    type: "excalidraw",
    version: typeof record.version === "number" ? record.version : 2,
    source:
      typeof record.source === "string" && record.source.trim()
        ? record.source
        : EXCALIDRAW_SOURCE,
    elements: normalizeExcalidrawTextElements(elements),
    appState,
    files,
  };
}

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strippedTextLength(value: string): number {
  return value.replace(/\r\n/g, "\n").replace(/\n/g, "").length;
}

/**
 * Obsidian's wysiwyg source of truth is `rawText`; vanilla Excalidraw edits
 * `originalText`. If `originalText` is missing or shorter, the in-shape editor
 * clips CJK/ASCII labels down to the last glyph.
 */
export function normalizeExcalidrawTextElements(
  elements: unknown[],
): unknown[] {
  return elements.map((element) => {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      return element;
    }
    const record = element as Record<string, unknown>;
    if (record.type !== "text") return element;

    const text = asNonEmptyString(record.text);
    const originalText = asNonEmptyString(record.originalText);
    const rawText = asNonEmptyString(record.rawText);
    const candidates = [rawText, originalText, text].filter(
      (value) => value.length > 0,
    );
    if (candidates.length === 0) return element;

    const nextOriginal = candidates.reduce((best, candidate) =>
      strippedTextLength(candidate) > strippedTextLength(best)
        ? candidate
        : best,
    );
    const nextText = text || nextOriginal;
    if (nextOriginal === originalText && nextText === text) return element;

    return {
      ...record,
      text: nextText,
      originalText: nextOriginal,
    };
  });
}

function looksLikeExcalidrawScene(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const record = parsed as { elements?: unknown; type?: unknown };
  return Array.isArray(record.elements) || record.type === "excalidraw";
}

function parseSceneJson(json: string): ExcalidrawDocument | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!looksLikeExcalidrawScene(parsed)) return null;
    return documentFromParsedJson(parsed);
  } catch {
    return null;
  }
}

function minifyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json.trim();
  }
}

/** Match Obsidian: LZ-String base64, wrapped at 256 chars with blank lines. */
export function compressObsidianExcalidrawJson(json: string): string {
  const compressed = LZString.compressToBase64(minifyJson(json));
  if (!compressed) return "";
  let result = "";
  for (let i = 0; i < compressed.length; i += LZ_CHUNK_SIZE) {
    result += `${compressed.slice(i, i + LZ_CHUNK_SIZE)}\n\n`;
  }
  return result.trim();
}

/** Strip newlines then LZ-String decompressFromBase64 (Obsidian sceneDataUtils). */
export function decompressObsidianExcalidrawJson(
  compressed: string,
): string | null {
  let cleaned = "";
  for (let i = 0; i < compressed.length; i++) {
    const char = compressed[i];
    if (char !== "\n" && char !== "\r") {
      cleaned += char;
    }
  }
  if (!cleaned) return null;
  const json = LZString.decompressFromBase64(cleaned);
  return json && json.trim() ? json : null;
}

export function isCompressedObsidianDrawing(content: string): boolean {
  return /```compressed-json\b/i.test(content);
}

/**
 * Obsidian Excalidraw plugin stores drawings inside Markdown with YAML +
 * `# Excalidraw Data`. Do not treat a lone `## Drawing` heading as a drawing.
 */
export function isObsidianExcalidrawMarkdown(content: string): boolean {
  if (!content.trim()) return false;
  const head = content.slice(0, 2000);
  if (/excalidraw-plugin\s*:/i.test(head)) return true;
  if (isCompressedObsidianDrawing(content)) return true;
  return (
    /^#{1,3}\s*Excalidraw Data\b/im.test(content) &&
    /^#{1,3}\s*Drawing\b/im.test(content)
  );
}

function extractFencedBlock(content: string, language: string): string | null {
  const drawingRe = new RegExp(
    `#{1,3}\\s*Drawing\\b[\\s\\S]*?\`\`\`${language}\\s*\\n([\\s\\S]*?)\`\`\``,
    "i",
  );
  const drawingMatch = content.match(drawingRe);
  if (drawingMatch?.[1]?.trim()) {
    return drawingMatch[1].trim();
  }

  const anyRe = new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\`\`\``, "i");
  const anyMatch = content.match(anyRe);
  return anyMatch?.[1]?.trim() || null;
}

/**
 * Pull the scene JSON out of an Obsidian `.excalidraw.md` wrapper.
 * Supports uncompressed ```json and Obsidian's default ```compressed-json.
 */
export function extractExcalidrawJsonFromObsidianMd(
  content: string,
): string | null {
  const compressedBody = extractFencedBlock(content, OBSIDIAN_COMPRESSED_FENCE);
  if (compressedBody) {
    const decompressed = decompressObsidianExcalidrawJson(compressedBody);
    if (decompressed && parseSceneJson(decompressed)) {
      return decompressed;
    }
  }

  const drawingJson = extractFencedBlock(content, "json");
  if (drawingJson && parseSceneJson(drawingJson)) {
    return drawingJson;
  }

  const jsonBlocks = [...content.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)];
  for (const match of jsonBlocks) {
    const candidate = match[1]?.trim() ?? "";
    if (!candidate) continue;
    if (parseSceneJson(candidate)) return candidate;
  }

  return null;
}

function replaceFencedBlock(
  content: string,
  language: string,
  nextBody: string,
): string | null {
  const drawingRe = new RegExp(
    `(#{1,3}\\s*Drawing\\b[\\s\\S]*?\`\`\`${language}\\s*\\n)([\\s\\S]*?)(\`\`\`)`,
    "i",
  );
  if (drawingRe.test(content)) {
    return content.replace(drawingRe, `$1${nextBody}\n$3`);
  }

  const anyRe = new RegExp(
    `(\`\`\`${language}\\s*\\n)([\\s\\S]*?)(\`\`\`)`,
    "i",
  );
  if (anyRe.test(content)) {
    return content.replace(anyRe, `$1${nextBody}\n$3`);
  }

  return null;
}

export function replaceExcalidrawJsonInObsidianMd(
  content: string,
  nextJson: string,
): string {
  if (isCompressedObsidianDrawing(content)) {
    const compressed = compressObsidianExcalidrawJson(nextJson);
    const replaced = replaceFencedBlock(
      content,
      OBSIDIAN_COMPRESSED_FENCE,
      compressed,
    );
    if (replaced) return replaced;
  }

  const jsonReplaced = replaceFencedBlock(content, "json", nextJson.trim());
  if (jsonReplaced) return jsonReplaced;

  const anyJsonRe = /(```\s*\n)([\s\S]*?)(```)/i;
  if (anyJsonRe.test(content) && extractExcalidrawJsonFromObsidianMd(content)) {
    return content.replace(anyJsonRe, `$1${nextJson.trim()}\n$3`);
  }

  return `${content.trimEnd()}\n\n## Drawing\n\`\`\`json\n${nextJson.trim()}\n\`\`\`\n`;
}

/**
 * Serialize a scene back to disk content. When `previousContent` is an Obsidian
 * markdown wrapper, preserve frontmatter / text sections and only replace the
 * Drawing fence (re-compressing when the original used ```compressed-json).
 */
export function serializeExcalidrawContent(
  nextJson: string,
  previousContent: string,
): string {
  const trimmedJson = nextJson.trim();
  if (previousContent && isObsidianExcalidrawMarkdown(previousContent)) {
    return replaceExcalidrawJsonInObsidianMd(previousContent, trimmedJson);
  }
  return trimmedJson.endsWith("\n") ? trimmedJson : `${trimmedJson}\n`;
}

export function parseExcalidrawDocument(
  content: string,
): ExcalidrawDocument | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return emptyDocument();
  }

  if (isObsidianExcalidrawMarkdown(trimmed)) {
    const obsidianJson = extractExcalidrawJsonFromObsidianMd(trimmed);
    if (!obsidianJson) return null;
    return parseSceneJson(obsidianJson);
  }

  const direct = parseSceneJson(trimmed);
  if (direct) return direct;

  // Markdown wrapper without the usual markers
  const fallback = extractExcalidrawJsonFromObsidianMd(trimmed);
  if (!fallback) return null;
  return parseSceneJson(fallback);
}

export function resolveExcalidrawFileName(inputName: string): string {
  const trimmed = inputName.trim() || `drawing-${Date.now()}`;
  if (EXCALIDRAW_FILE_REGEX.test(trimmed)) return trimmed;
  return `${trimmed.replace(/\.json$/i, "")}.excalidraw`;
}
