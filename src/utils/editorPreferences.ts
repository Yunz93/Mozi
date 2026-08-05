import { ViewMode } from "../types";

export const DEFAULT_TAB_SIZE = 4;

const DEFAULT_CLOSE_BRACKETS = ["(", "[", "{", "'", '"'] as const;
const MARKDOWN_CLOSE_BRACKETS = ["*", "_", "`", "~"] as const;

export function normalizeTabSize(value: unknown): 2 | 4 {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (numeric === 2) return 2;
  if (numeric === 4) return 4;
  return DEFAULT_TAB_SIZE;
}

export function normalizeDefaultViewMode(value: unknown): ViewMode {
  if (value === ViewMode.PREVIEW || value === "PREVIEW") {
    return ViewMode.PREVIEW;
  }
  if (value === ViewMode.LIVE || value === "LIVE") {
    return ViewMode.LIVE;
  }
  // Legacy EDITOR / SPLIT map onto Live edit.
  if (
    value === ViewMode.EDITOR ||
    value === "EDITOR" ||
    value === ViewMode.SPLIT ||
    value === "SPLIT"
  ) {
    return ViewMode.LIVE;
  }
  return ViewMode.LIVE;
}

/** Indent string used by Tab / list nesting for the current settings. */
export function buildIndentUnitString(
  tabSize: unknown,
  useTabs: boolean,
): string {
  if (useTabs) return "\t";
  return " ".repeat(normalizeTabSize(tabSize));
}

/**
 * Characters that should auto-close, based on bracket / Markdown pairing toggles.
 * Returns an empty array when both toggles are off.
 */
export function buildCloseBracketChars(
  autoPairBrackets: boolean,
  autoPairMarkdown: boolean,
): string[] {
  const brackets: string[] = [];
  if (autoPairBrackets) {
    brackets.push(...DEFAULT_CLOSE_BRACKETS);
  }
  if (autoPairMarkdown) {
    brackets.push(...MARKDOWN_CLOSE_BRACKETS);
  }
  return brackets;
}
