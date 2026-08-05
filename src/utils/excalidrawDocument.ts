/**
 * Helpers for `.excalidraw` scene files (JSON).
 * Keep parse/create free of the heavy `@excalidraw/excalidraw` runtime so
 * file-type routing and unit tests stay lightweight.
 */

export const EXCALIDRAW_SOURCE = "https://github.com/Yunz93/markdown-press";

export const EXCALIDRAW_FILE_REGEX = /\.excalidraw(?:\.json)?$/i;

export interface ExcalidrawDocument {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function isExcalidrawFileName(name: string): boolean {
  return EXCALIDRAW_FILE_REGEX.test(name);
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

export function parseExcalidrawDocument(
  content: string,
): ExcalidrawDocument | null {
  const trimmed = content.trim();
  if (!trimmed) {
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

  try {
    const parsed: unknown = JSON.parse(trimmed);
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
  } catch {
    return null;
  }
}

export function resolveExcalidrawFileName(inputName: string): string {
  const trimmed = inputName.trim() || `drawing-${Date.now()}`;
  if (EXCALIDRAW_FILE_REGEX.test(trimmed)) return trimmed;
  return `${trimmed.replace(/\.json$/i, "")}.excalidraw`;
}
