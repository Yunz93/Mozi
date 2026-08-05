/**
 * Helpers for `.excalidraw` scene files (JSON) and Obsidian `.excalidraw.md`.
 * Keep parse/create free of the heavy `@excalidraw/excalidraw` runtime so
 * file-type routing and unit tests stay lightweight.
 */

export const EXCALIDRAW_SOURCE = "https://github.com/Yunz93/markdown-press";

/** Standalone `.excalidraw` / `.excalidraw.json`, or Obsidian `.excalidraw.md`. */
export const EXCALIDRAW_FILE_REGEX = /\.excalidraw(?:\.json|\.md)?$/i;

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
    elements,
    appState,
    files,
  };
}

/** Obsidian Excalidraw plugin stores drawings inside Markdown with YAML + `# Excalidraw Data`. */
export function isObsidianExcalidrawMarkdown(content: string): boolean {
  const head = content.slice(0, 800);
  return (
    /excalidraw-plugin\s*:/i.test(head) ||
    /^#{1,3}\s*Excalidraw Data\b/im.test(content) ||
    /^##\s*Drawing\b/im.test(content)
  );
}

/**
 * Pull the scene JSON out of an Obsidian `.excalidraw.md` wrapper.
 * Prefer the fenced block under `## Drawing`; fall back to any ```json that looks like a scene.
 */
export function extractExcalidrawJsonFromObsidianMd(
  content: string,
): string | null {
  const drawingSection = content.match(
    /##\s*Drawing\b[\s\S]*?```(?:json)?\s*\n([\s\S]*?)```/i,
  );
  if (drawingSection?.[1]?.trim()) {
    return drawingSection[1].trim();
  }

  const jsonBlocks = [...content.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)];
  for (const match of jsonBlocks) {
    const candidate = match[1]?.trim() ?? "";
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (Array.isArray((parsed as { elements?: unknown }).elements) ||
          (parsed as { type?: unknown }).type === "excalidraw")
      ) {
        return candidate;
      }
    } catch {
      // try next fence
    }
  }

  return null;
}

export function replaceExcalidrawJsonInObsidianMd(
  content: string,
  nextJson: string,
): string {
  const drawingRe = /(##\s*Drawing\b[\s\S]*?```(?:json)?\s*\n)([\s\S]*?)(```)/i;
  if (drawingRe.test(content)) {
    return content.replace(drawingRe, `$1${nextJson}\n$3`);
  }

  const anyJsonRe = /(```(?:json)?\s*\n)([\s\S]*?)(```)/i;
  if (anyJsonRe.test(content)) {
    return content.replace(anyJsonRe, `$1${nextJson}\n$3`);
  }

  return `${content.trimEnd()}\n\n## Drawing\n\`\`\`json\n${nextJson}\n\`\`\`\n`;
}

/**
 * Serialize a scene back to disk content. When `previousContent` is an Obsidian
 * markdown wrapper, preserve frontmatter / text sections and only replace the
 * Drawing JSON fence.
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
    try {
      return documentFromParsedJson(JSON.parse(obsidianJson) as unknown);
    } catch {
      return null;
    }
  }

  try {
    return documentFromParsedJson(JSON.parse(trimmed) as unknown);
  } catch {
    // Markdown wrapper without the usual markers
    const fallback = extractExcalidrawJsonFromObsidianMd(trimmed);
    if (!fallback) return null;
    try {
      return documentFromParsedJson(JSON.parse(fallback) as unknown);
    } catch {
      return null;
    }
  }
}

export function resolveExcalidrawFileName(inputName: string): string {
  const trimmed = inputName.trim() || `drawing-${Date.now()}`;
  if (EXCALIDRAW_FILE_REGEX.test(trimmed)) return trimmed;
  return `${trimmed.replace(/\.json$/i, "")}.excalidraw`;
}
