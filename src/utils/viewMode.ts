import { ViewMode } from "../types";

/**
 * Supported session modes: Live edit and Reading preview.
 * EDITOR / SPLIT remain in the enum for persisted legacy values and are
 * normalized onto LIVE.
 */
export type SessionViewMode = ViewMode.LIVE | ViewMode.PREVIEW;

/** Map EDITOR / SPLIT / unknown onto a supported session mode. */
export function normalizeSessionViewMode(mode: ViewMode): SessionViewMode {
  if (mode === ViewMode.PREVIEW) return ViewMode.PREVIEW;
  // LIVE, EDITOR, legacy SPLIT → Live edit
  return ViewMode.LIVE;
}

/** Solo editing surfaces (editor pane only; no HTML preview pane). */
export function isEditorSoloMode(mode: ViewMode): boolean {
  return normalizeSessionViewMode(mode) === ViewMode.LIVE;
}

/** Any mode where the CodeMirror editor pane is visible. */
export function isEditorVisibleMode(mode: ViewMode): boolean {
  return normalizeSessionViewMode(mode) === ViewMode.LIVE;
}

/** Any mode where the HTML preview pane is visible. */
export function isPreviewVisibleMode(mode: ViewMode): boolean {
  return normalizeSessionViewMode(mode) === ViewMode.PREVIEW;
}

/** @deprecated Use SessionViewMode; kept for store field typing. */
export type NonSplitViewMode = SessionViewMode;

export function isNonSplitViewMode(mode: ViewMode): mode is NonSplitViewMode {
  return mode === ViewMode.LIVE || mode === ViewMode.PREVIEW;
}

/** Anchor used when leaving a temporary preview-only file. */
export function resolveLastNonSplitViewMode(mode: ViewMode): NonSplitViewMode {
  return normalizeSessionViewMode(mode);
}

/**
 * Toggle cycle: Live → Reading → Live.
 */
export function getNextViewMode(viewMode: ViewMode): ViewMode {
  const normalized = normalizeSessionViewMode(viewMode);
  if (normalized === ViewMode.LIVE) return ViewMode.PREVIEW;
  return ViewMode.LIVE;
}
