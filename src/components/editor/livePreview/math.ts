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
      this.from === other.from
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement(this.displayMode ? "div" : "span");
    el.className = this.displayMode
      ? "cm-live-preview-math cm-live-preview-math-display katex-display"
      : "cm-live-preview-math cm-live-preview-math-inline";
    el.setAttribute("contenteditable", "false");
    el.innerHTML = this.html;
    // KaTeX metrics can settle after font load; refresh CM height maps.
    queueMicrotask(() => scheduleLivePreviewMeasure(view));
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => scheduleLivePreviewMeasure(view));
    }
    if (this.displayMode) {
      bindLivePreviewWidgetResizeMeasure(view, el);
    }
    bindLivePreviewWidgetCaret(view, el, this.from);
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

export function buildMathDecorations(state: EditorState): BlockDecorationBuild {
  const coverage: CoverageRange[] = [];

  // Large-file mode: keep source visible; banner explains why widgets are off.
  if (isLargeEditorState(state)) {
    return { decorations: Decoration.none, coverage };
  }

  const builder = new RangeSetBuilder<Decoration>();
  const docText = state.doc.toString();
  const wikiRanges = collectWikiLinkRanges(docText, 0, docText.length);
  const candidates = findMathRangesInText(docText);

  candidates.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;

  for (const range of candidates) {
    if (range.from < lastTo) continue;
    if (range.from >= range.to) continue;
    if (hasSkipAncestor(state, range.from)) continue;
    if (
      wikiRanges.some((w) => rangesOverlap(range.from, range.to, w.from, w.to))
    ) {
      continue;
    }

    coverage.push({ from: range.from, to: range.to });

    if (selectionTouchesRange(state, range.from, range.to)) {
      lastTo = range.to;
      continue;
    }

    let html: string;
    try {
      html = renderKatexHtml(range.content, range.displayMode);
    } catch {
      lastTo = range.to;
      continue;
    }

    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        widget: new MathWidget(
          range.content,
          range.displayMode,
          html,
          range.from,
        ),
        block: range.displayMode,
      }),
    );
    lastTo = range.to;
  }

  return { decorations: builder.finish(), coverage };
}

/** @deprecated Prefer buildMathDecorations(state). */
export function buildLivePreviewMathDecorations(
  view: EditorView,
): DecorationSet {
  return buildMathDecorations(view.state).decorations;
}

export const livePreviewMath = defineLivePreviewBlockDecorationField({
  create: buildMathDecorations,
});
