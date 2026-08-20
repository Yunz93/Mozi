/**
 * Live Preview: hide list marks and show bullet/number widgets;
 * ==highlight== and %%comments%%.
 *
 * Highlights/comments may span line breaks, so their replace decorations are
 * provided via StateField (CodeMirror forbids linebreak replaces from plugins).
 */

import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import {
  defineLivePreviewBlockDecorationField,
  ensureLivePreviewViewportTree,
  getLivePreviewDecorationRange,
  hasSkipAncestor,
  maxVisibleParseTo,
  mergeCoverageRanges,
  selectionTouchesRange,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
  type BlockDecorationBuild,
  type CoverageRange,
} from "./shared";

/** Hide `- ` / `* ` / `1. ` on task lines so only the checkbox remains. */
const hideTaskListMarkDecoration = Decoration.replace({});

class BulletWidget extends WidgetType {
  constructor(
    readonly ordered: boolean,
    readonly label: string,
  ) {
    super();
  }

  eq(other: BulletWidget) {
    return this.ordered === other.ordered && this.label === other.label;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = this.ordered
      ? "cm-live-preview-list-marker is-ordered"
      : "cm-live-preview-list-marker is-bullet";
    el.textContent = this.ordered ? `${this.label}.` : "•";
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

const MAX_LIVE_LIST_LEVEL = 6;

const livePreviewListLineDecos = Array.from(
  { length: MAX_LIVE_LIST_LEVEL },
  (_, index) => {
    const level = index + 1;
    const nested = level > 1 ? " is-nested" : "";
    return Decoration.line({
      class: `cm-live-preview-list-line cm-live-preview-list-level-${level}${nested}`,
    });
  },
);

/** Leading indent immediately before a ListMark, not quote/fence prefixes. */
export function livePreviewListMarkerReplaceFrom(
  lineFrom: number,
  markFrom: number,
  textBeforeMark: string,
): number {
  const indent = textBeforeMark.match(/[ \t]+$/);
  return indent ? markFrom - indent[0].length : markFrom;
}

function subtreeHasName(node: SyntaxNode | null, name: string): boolean {
  let current = node;
  while (current) {
    if (current.name === name) return true;
    if (subtreeHasName(current.firstChild, name)) return true;
    current = current.nextSibling;
  }
  return false;
}

function listMarkIsTaskItem(
  state: EditorState,
  listMark: SyntaxNodeRef,
  lineTo: number,
  markTo: number,
): boolean {
  let item: SyntaxNode | null = listMark.node.parent;
  while (item && item.name !== "ListItem") {
    item = item.parent;
  }
  if (item && subtreeHasName(item.firstChild, "TaskMarker")) {
    return true;
  }
  const after = state.doc.sliceString(markTo, Math.min(lineTo, markTo + 6));
  return /^\s*\[[ xX]\]/.test(after);
}

/** 1 = top-level list, 2 = nested, … */
export function livePreviewListNestLevel(node: {
  parent: { name: string; parent: unknown } | null;
}): number {
  let level = 0;
  let current: { name: string; parent: unknown } | null = node.parent;
  while (current) {
    if (current.name === "BulletList" || current.name === "OrderedList") {
      level += 1;
    }
    current = current.parent as { name: string; parent: unknown } | null;
  }
  return Math.max(1, Math.min(level || 1, MAX_LIVE_LIST_LEVEL));
}

class HighlightWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: HighlightWidget) {
    return this.text === other.text;
  }

  toDOM() {
    const el = document.createElement("mark");
    el.className = "cm-live-preview-highlight";
    el.textContent = this.text;
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

export function findHighlightRanges(
  text: string,
  from: number,
  to: number,
): Array<{ from: number; to: number; content: string }> {
  const slice = text.slice(from, to);
  const ranges: Array<{ from: number; to: number; content: string }> = [];
  const re = /==([^=\n][\s\S]*?)==/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) {
    ranges.push({
      from: from + match.index,
      to: from + match.index + match[0].length,
      content: match[1],
    });
  }
  return ranges;
}

export function findCommentRanges(
  text: string,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const slice = text.slice(from, to);
  const ranges: Array<{ from: number; to: number }> = [];
  const re = /%%[\s\S]*?%%/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) {
    ranges.push({
      from: from + match.index,
      to: from + match.index + match[0].length,
    });
  }
  return ranges;
}

export function buildLivePreviewListMarkerDecorations(
  view: EditorView,
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const parseTo = maxVisibleParseTo(view);
  const tree = ensureLivePreviewViewportTree(view, parseTo);
  const { from: viewportFrom, to: viewportTo } =
    getLivePreviewDecorationRange(view);
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
  const decoratedLines = new Set<number>();

  tree.iterate({
    from: viewportFrom,
    to: viewportTo,
    enter: (node) => {
      if (node.name !== "ListMark") return;
      const { from, to } = node;
      if (from >= to) return;
      const line = state.doc.lineAt(from);
      if (selectionTouchesRange(state, line.from, line.to)) return;
      if (hasSkipAncestor(state, from)) return;

      const markText = state.doc.sliceString(from, to).trim();
      const ordered = /^\d+[.)]?$/.test(markText);
      const label = markText.replace(/[.)]$/, "");
      // Include trailing space after marker when present.
      let end = to;
      if (state.doc.sliceString(to, to + 1) === " ") end = to + 1;
      // Nested items keep source indent (`  - `). Replace that prefix too so
      // inactive second-level lines don't stay as raw markdown hyphens.
      const replaceFrom = livePreviewListMarkerReplaceFrom(
        line.from,
        from,
        state.doc.sliceString(line.from, from),
      );
      const level = livePreviewListNestLevel(node.node);
      const isTaskItem = listMarkIsTaskItem(state, node, line.to, to);

      if (!decoratedLines.has(line.from)) {
        decoratedLines.add(line.from);
        ranges.push({
          from: line.from,
          to: line.from,
          deco: livePreviewListLineDecos[level - 1]!,
        });
      }

      ranges.push({
        from: replaceFrom,
        to: end,
        deco: isTaskItem
          ? hideTaskListMarkDecoration
          : Decoration.replace({
              widget: new BulletWidget(ordered, label),
            }),
      });
    },
  });

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of ranges) {
    builder.add(range.from, range.to, range.deco);
  }

  return builder.finish();
}

function buildHighlightDecorationsInScanRanges(
  state: EditorState,
  scanRanges: readonly CoverageRange[],
): BlockDecorationBuild {
  if (isLargeEditorState(state) || scanRanges.length === 0) {
    return { decorations: Decoration.none, coverage: [] };
  }

  const builder = new RangeSetBuilder<Decoration>();
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
  const coverage: CoverageRange[] = [];

  for (const scan of mergeCoverageRanges(scanRanges)) {
    const text = state.doc.sliceString(scan.from, scan.to);
    for (const range of findHighlightRanges(text, 0, text.length)) {
      const absFrom = scan.from + range.from;
      const absTo = scan.from + range.to;
      coverage.push({ from: absFrom, to: absTo });
      if (selectionTouchesRange(state, absFrom, absTo)) continue;
      if (hasSkipAncestor(state, absFrom)) continue;
      const spansBreak = range.content.includes("\n");
      ranges.push({
        from: absFrom,
        to: absTo,
        deco: Decoration.replace({
          widget: new HighlightWidget(range.content),
          block: spansBreak,
        }),
      });
    }

    for (const range of findCommentRanges(text, 0, text.length)) {
      const absFrom = scan.from + range.from;
      const absTo = scan.from + range.to;
      coverage.push({ from: absFrom, to: absTo });
      if (selectionTouchesRange(state, absFrom, absTo)) continue;
      if (hasSkipAncestor(state, absFrom)) continue;
      const spansBreak = state.doc.sliceString(absFrom, absTo).includes("\n");
      ranges.push({
        from: absFrom,
        to: absTo,
        deco: Decoration.replace({
          block: spansBreak,
        }),
      });
    }
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;
  for (const range of ranges) {
    if (range.from < lastTo) continue;
    builder.add(range.from, range.to, range.deco);
    lastTo = range.to;
  }

  return {
    decorations: builder.finish(),
    coverage: mergeCoverageRanges(coverage),
  };
}

export function buildHighlightDecorations(
  state: EditorState,
): BlockDecorationBuild {
  return buildHighlightDecorationsInScanRanges(state, [
    { from: 0, to: state.doc.length },
  ]);
}

/** @deprecated Prefer buildHighlightDecorations(state). */
export function buildLivePreviewHighlightDecorations(
  view: EditorView,
): DecorationSet {
  return buildHighlightDecorations(view.state).decorations;
}

export const livePreviewListMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly viewportWindow = new ViewportDecorationWindow();
    constructor(view: EditorView) {
      this.decorations = buildLivePreviewListMarkerDecorations(view);
      this.viewportWindow.mark(view);
    }
    update(update: ViewUpdate) {
      if (
        shouldRebuildLivePreviewDecorations(
          update,
          "marks",
          this.viewportWindow,
        )
      ) {
        this.decorations = buildLivePreviewListMarkerDecorations(update.view);
        this.viewportWindow.mark(update.view);
      }
    }
  },
  { decorations: (p) => p.decorations },
);

export const livePreviewHighlights = defineLivePreviewBlockDecorationField({
  create: buildHighlightDecorations,
  createInRanges: buildHighlightDecorationsInScanRanges,
  rebuildOnContextChange: false,
});

const blockquoteLineDeco = Decoration.line({
  class: "cm-live-preview-blockquote",
});
const blockquoteFirstLineDeco = Decoration.line({
  class: "cm-live-preview-blockquote cm-live-preview-blockquote-first",
});
const blockquoteLastLineDeco = Decoration.line({
  class: "cm-live-preview-blockquote cm-live-preview-blockquote-last",
});
const blockquoteOnlyLineDeco = Decoration.line({
  class:
    "cm-live-preview-blockquote cm-live-preview-blockquote-first cm-live-preview-blockquote-last",
});

/** Style plain `>` blockquotes to match Reading mode quote chrome. */
export function buildLivePreviewBlockquoteDecorations(
  view: EditorView,
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const parseTo = maxVisibleParseTo(view);
  const tree = ensureLivePreviewViewportTree(view, parseTo);
  const { from: viewportFrom, to: viewportTo } =
    getLivePreviewDecorationRange(view);
  const lineFroms = new Set<number>();

  tree.iterate({
    from: viewportFrom,
    to: viewportTo,
    enter: (node) => {
      if (node.name !== "Blockquote") return;
      // Nested quotes re-enter; decorate leaf lines once.
      let pos = Math.max(node.from, viewportFrom);
      const end = Math.min(node.to, viewportTo);
      if (pos > end) return;
      while (pos <= end) {
        const line = state.doc.lineAt(pos);
        lineFroms.add(line.from);
        if (line.to >= end) break;
        pos = line.to + 1;
      }
    },
  });

  const sorted = Array.from(lineFroms).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    const from = sorted[i]!;
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const line = state.doc.lineAt(from);
    const prevIsAdjacent =
      prev !== undefined && state.doc.lineAt(prev).to + 1 === line.from;
    const nextIsAdjacent =
      next !== undefined && line.to + 1 === state.doc.lineAt(next).from;
    const isFirst = !prevIsAdjacent;
    const isLast = !nextIsAdjacent;
    const deco =
      isFirst && isLast
        ? blockquoteOnlyLineDeco
        : isFirst
          ? blockquoteFirstLineDeco
          : isLast
            ? blockquoteLastLineDeco
            : blockquoteLineDeco;
    builder.add(from, from, deco);
  }

  return builder.finish();
}

export const livePreviewBlockquotes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly viewportWindow = new ViewportDecorationWindow();
    constructor(view: EditorView) {
      this.decorations = buildLivePreviewBlockquoteDecorations(view);
      this.viewportWindow.mark(view);
    }
    update(update: ViewUpdate) {
      if (
        shouldRebuildLivePreviewDecorations(
          update,
          "marks",
          this.viewportWindow,
        )
      ) {
        this.decorations = buildLivePreviewBlockquoteDecorations(update.view);
        this.viewportWindow.mark(update.view);
      }
    }
  },
  { decorations: (p) => p.decorations },
);
