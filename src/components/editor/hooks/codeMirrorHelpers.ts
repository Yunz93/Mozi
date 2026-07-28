/**
 * Pure helpers for the CodeMirror editor hook and its extension factory.
 * Kept free of React/hook state so they can be unit-tested and shared between
 * useCodeMirror and createEditorExtensions without circular imports.
 */

import { EditorState } from "@codemirror/state";
import { EditorView, type Rect } from "@codemirror/view";
import { LARGE_FILE_THRESHOLDS } from "../../../utils/performance";

/**
 * Compute the minimal { from, to, insert } change that turns `currentContent`
 * into `nextContent`, by trimming the common prefix and suffix. Keeps external
 * content syncs from replacing the whole document (which would reset history
 * and scroll).
 */
export function getDocumentReplacementRange(
  currentContent: string,
  nextContent: string,
) {
  let prefixLength = 0;
  const maxPrefixLength = Math.min(currentContent.length, nextContent.length);
  while (
    prefixLength < maxPrefixLength &&
    currentContent.charCodeAt(prefixLength) ===
      nextContent.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }

  let currentSuffixLength = currentContent.length;
  let nextSuffixLength = nextContent.length;
  while (
    currentSuffixLength > prefixLength &&
    nextSuffixLength > prefixLength &&
    currentContent.charCodeAt(currentSuffixLength - 1) ===
      nextContent.charCodeAt(nextSuffixLength - 1)
  ) {
    currentSuffixLength -= 1;
    nextSuffixLength -= 1;
  }

  return {
    from: prefixLength,
    to: currentSuffixLength,
    insert: nextContent.slice(prefixLength, nextSuffixLength),
  };
}

export function isLargeEditorState(state: EditorState): boolean {
  return (
    state.doc.lines > LARGE_FILE_THRESHOLDS.LINE_COUNT ||
    state.doc.length > LARGE_FILE_THRESHOLDS.CHAR_COUNT
  );
}

export function getEditorTooltipSpace(view: Pick<EditorView, "dom">): Rect {
  const rect = view.dom.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
}
