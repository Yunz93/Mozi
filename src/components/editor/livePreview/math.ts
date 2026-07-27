/**
 * Live Preview KaTeX widgets for `$inline$` and `$$display$$` math.
 * Math is not in the Lezer markdown tree — scan with a small state machine.
 */

import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { renderKatexHtml } from "../../../utils/markdown-extensions";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import {
  collectWikiLinkRanges,
  defineLivePreviewBlockDecorationField,
  hasSkipAncestor,
  mergeCoverageRanges,
  rangesOverlap,
  selectionTouchesRange,
  scheduleLivePreviewMeasure,
  bindLivePreviewWidgetCaret,
  bindLivePreviewWidgetResizeMeasure,
  type BlockDecorationBuild,
  type CoverageRange,
} from "./shared";

export interface MathRange {
  from: number;
  to: number;
  content: string;
  displayMode: boolean;
}

/**
 * Find math spans in `text`. Indices are relative to `text` (caller offsets).
 * Skips escaped dollars and requires non-empty content.
 */
export function findMathRangesInText(text: string): MathRange[] {
  const ranges: MathRange[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }

    if (text[i] === "$" && text[i + 1] === "$") {
      const close = text.indexOf("$$", i + 2);
      if (close < 0) {
        // Unclosed display fence — skip the opener and keep scanning so later
        // valid $inline$ / $$display$$ ranges are not silently dropped.
        i += 2;
        continue;
      }
      const content = text.slice(i + 2, close);
      if (content.trim()) {
        ranges.push({
          from: i,
          to: close + 2,
          content,
          displayMode: true,
        });
      }
      i = close + 2;
      continue;
    }

    if (text[i] === "$") {
      let j = i + 1;
      let found = -1;
      while (j < text.length) {
        if (text[j] === "\\" && j + 1 < text.length) {
          j += 2;
          continue;
        }
        if (text[j] === "\n") break;
        if (text[j] === "$") {
          found = j;
          break;
        }
        j += 1;
      }
      if (found > i + 1) {
        const content = text.slice(i + 1, found);
        if (content.trim()) {
          ranges.push({
            from: i,
            to: found + 1,
            content,
            displayMode: false,
          });
        }
        i = found + 1;
        continue;
      }
    }

    i += 1;
  }

  return ranges;
}

class MathWidget extends WidgetType {
  constructor(
    readonly content: string,
    readonly displayMode: boolean,
    readonly html: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return (
      this.content === other.content &&
      this.displayMode === other.displayMode &&
      this.html === other.html &&
      this.from === other.from
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement(this.displayMode ? "div" : "span");
    wrap.className = this.displayMode
      ? "cm-live-preview-math is-display"
      : "cm-live-preview-math is-inline";
    wrap.setAttribute("contenteditable", "false");
    wrap.innerHTML = this.html;
    bindLivePreviewWidgetCaret(view, wrap, this.from);
    queueMicrotask(() => scheduleLivePreviewMeasure(view));
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => scheduleLivePreviewMeasure(view));
    }
    if (this.displayMode) {
      bindLivePreviewWidgetResizeMeasure(view, wrap);
    }
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function buildMathDecorationsInScanRanges(
  state: EditorState,
  scanRanges: readonly CoverageRange[],
): BlockDecorationBuild {
  const coverage: CoverageRange[] = [];
  if (isLargeEditorState(state) || scanRanges.length === 0) {
    return { decorations: Decoration.none, coverage };
  }

  const builder = new RangeSetBuilder<Decoration>();
  const pending: Array<{ from: number; to: number; deco?: Decoration }> = [];

  for (const scan of scanRanges) {
    const from = Math.max(0, scan.from);
    const to = Math.min(state.doc.length, scan.to);
    if (from >= to) continue;
    const text = state.doc.sliceString(from, to);
    const wikiRanges = collectWikiLinkRanges(text, 0, text.length).map((w) => ({
      from: w.from + from,
      to: w.to + from,
    }));
    const candidates = findMathRangesInText(text).map((range) => ({
      ...range,
      from: range.from + from,
      to: range.to + from,
    }));

    for (const range of candidates) {
      if (range.from >= range.to) continue;
      if (hasSkipAncestor(state, range.from)) continue;
      if (
        wikiRanges.some((w) =>
          rangesOverlap(range.from, range.to, w.from, w.to),
        )
      ) {
        continue;
      }

      coverage.push({ from: range.from, to: range.to });

      if (selectionTouchesRange(state, range.from, range.to)) {
        continue;
      }

      let html: string;
      try {
        html = renderKatexHtml(range.content, range.displayMode);
      } catch {
        continue;
      }

      pending.push({
        from: range.from,
        to: range.to,
        deco: Decoration.replace({
          widget: new MathWidget(
            range.content,
            range.displayMode,
            html,
            range.from,
          ),
          block: range.displayMode,
        }),
      });
    }
  }

  pending.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;
  for (const range of pending) {
    if (range.from < lastTo || !range.deco) continue;
    builder.add(range.from, range.to, range.deco);
    lastTo = range.to;
  }

  return { decorations: builder.finish(), coverage };
}

export function buildMathDecorations(state: EditorState): BlockDecorationBuild {
  if (isLargeEditorState(state)) {
    return { decorations: Decoration.none, coverage: [] };
  }
  return buildMathDecorationsInScanRanges(state, [
    { from: 0, to: state.doc.length },
  ]);
}

/** @deprecated Prefer buildMathDecorations(state). */
export function buildLivePreviewMathDecorations(
  view: EditorView,
): DecorationSet {
  return buildMathDecorations(view.state).decorations;
}

function expandMathChangedRanges(
  state: EditorState,
  ranges: readonly CoverageRange[],
): CoverageRange[] {
  // Display math can span blank lines — expand farther when `$` is nearby.
  const expanded: CoverageRange[] = [];
  for (const range of ranges) {
    let from = range.from;
    let to = range.to;
    try {
      let line = state.doc.lineAt(from);
      // Walk back across non-empty lines, and one extra blank if a $$ may open above.
      while (line.number > 1) {
        const prev = state.doc.line(line.number - 1);
        if (!prev.text.trim()) {
          const look = state.doc.line(Math.max(1, prev.number - 1)).text;
          if (look.includes("$$") || look.includes("$")) {
            line = state.doc.line(Math.max(1, prev.number - 1));
            continue;
          }
          break;
        }
        line = prev;
      }
      from = line.from;

      line = state.doc.lineAt(Math.max(from, Math.min(to, state.doc.length)));
      while (line.number < state.doc.lines) {
        const next = state.doc.line(line.number + 1);
        if (!next.text.trim()) {
          if (line.text.includes("$$") || next.text.includes("$$")) {
            line = next;
            continue;
          }
          break;
        }
        line = next;
      }
      to = line.to;
    } catch {
      // keep
    }
    expanded.push({ from, to });
  }
  // Merge via shared helper.
  return mergeCoverageRanges(expanded);
}

export const livePreviewMath = defineLivePreviewBlockDecorationField({
  create: buildMathDecorations,
  createInRanges: buildMathDecorationsInScanRanges,
  expandChangedRanges: expandMathChangedRanges,
  // Math does not read livePreviewContextFacet — skip file-tree/theme churn rebuilds.
  rebuildOnContextChange: false,
});
