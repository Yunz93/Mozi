import { ViewMode } from "../types";

/**
 * Supported session modes: source edit, split, and reading preview.
 * LIVE remains in the enum for persisted values but is normalized to EDITOR
 * (Live Preview stays in the codebase, gated off the UI toggle).
 */
export type SessionViewMode =
  | ViewMode.EDITOR
  | ViewMode.SPLIT
  | ViewMode.PREVIEW;

/** Map LIVE / unknown onto a supported session mode. */
export function normalizeSessionViewMode(mode: ViewMode): SessionViewMode {
  if (mode === ViewMode.PREVIEW) return ViewMode.PREVIEW;
  if (mode === ViewMode.SPLIT) return ViewMode.SPLIT;
  // EDITOR and legacy LIVE → source editor
  return ViewMode.EDITOR;
}

/** Solo editing surfaces (editor pane only; no HTML preview pane). */
export function isEditorSoloMode(mode: ViewMode): boolean {
  return normalizeSessionViewMode(mode) === ViewMode.EDITOR;
}

/** Any mode where the CodeMirror editor pane is visible. */
export function isEditorVisibleMode(mode: ViewMode): boolean {
  const normalized = normalizeSessionViewMode(mode);
  return normalized === ViewMode.EDITOR || normalized === ViewMode.SPLIT;
}

/** Any mode where the HTML preview pane is visible. */
export function isPreviewVisibleMode(mode: ViewMode): boolean {
  const normalized = normalizeSessionViewMode(mode);
  return normalized === ViewMode.PREVIEW || normalized === ViewMode.SPLIT;
}

/** @deprecated Use SessionViewMode; kept for store field typing. */
export type NonSplitViewMode = ViewMode.EDITOR | ViewMode.PREVIEW;

export function isNonSplitViewMode(mode: ViewMode): mode is NonSplitViewMode {
  return mode === ViewMode.EDITOR || mode === ViewMode.PREVIEW;
}

/** Anchor used when leaving a temporary preview-only file. */
export function resolveLastNonSplitViewMode(mode: ViewMode): NonSplitViewMode {
  const normalized = normalizeSessionViewMode(mode);
  if (normalized === ViewMode.PREVIEW) return ViewMode.PREVIEW;
  return ViewMode.EDITOR;
}

/**
 * Toggle cycle: Editor → Split → Reading → Editor.
 */
export function getNextViewMode(viewMode: ViewMode): ViewMode {
  const normalized = normalizeSessionViewMode(viewMode);
  if (normalized === ViewMode.EDITOR) return ViewMode.SPLIT;
  if (normalized === ViewMode.SPLIT) return ViewMode.PREVIEW;
  return ViewMode.EDITOR;
}
