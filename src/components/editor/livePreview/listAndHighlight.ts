/**
 * Live Preview: hide list marks and show bullet/number widgets;
 * ==highlight== and %%comments%%.
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import {
  ensureLivePreviewViewportTree,
  getLivePreviewDecorationRange,
  hasSkipAncestor,
  maxVisibleParseTo,
  selectionTouchesRange,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
} from "./shared";

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
      // Skip task list lines — TaskMarker widget owns them.
      const after = state.doc.sliceString(to, Math.min(line.to, to + 4));
      if (/^\s*\[[ xX]\]/.test(after)) return;

      const ordered = /^\d+[.)]?$/.test(markText);
      const label = markText.replace(/[.)]$/, "");
      // Include trailing space after marker when present.
      let end = to;
      if (state.doc.sliceString(to, to + 1) === " ") end = to + 1;

      builder.add(
        from,
        end,
        Decoration.replace({
          widget: new BulletWidget(ordered, label),
        }),
      );
    },
  });

  return builder.finish();
}

export function buildLivePreviewHighlightDecorations(
  view: EditorView,
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
  const { from, to } = getLivePreviewDecorationRange(view);
  const text = state.doc.sliceString(from, to);
  for (const range of findHighlightRanges(text, 0, text.length)) {
    const absFrom = from + range.from;
    const absTo = from + range.to;
    if (selectionTouchesRange(state, absFrom, absTo)) continue;
    if (hasSkipAncestor(state, absFrom)) continue;
    ranges.push({
      from: absFrom,
      to: absTo,
      deco: Decoration.replace({
        widget: new HighlightWidget(range.content),
      }),
    });
  }

  for (const range of findCommentRanges(text, 0, text.length)) {
    const absFrom = from + range.from;
    const absTo = from + range.to;
    if (selectionTouchesRange(state, absFrom, absTo)) continue;
    if (hasSkipAncestor(state, absFrom)) continue;
    ranges.push({
      from: absFrom,
      to: absTo,
      deco: Decoration.replace({}),
    });
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;
  for (const range of ranges) {
    if (range.from < lastTo) continue;
    builder.add(range.from, range.to, range.deco);
    lastTo = range.to;
  }

  return builder.finish();
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

export const livePreviewHighlights = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly viewportWindow = new ViewportDecorationWindow();
    constructor(view: EditorView) {
      this.decorations = buildLivePreviewHighlightDecorations(view);
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
        this.decorations = buildLivePreviewHighlightDecorations(update.view);
        this.viewportWindow.mark(update.view);
      }
    }
  },
  { decorations: (p) => p.decorations },
);

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
