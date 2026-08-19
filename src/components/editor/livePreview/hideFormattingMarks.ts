/**
 * Obsidian-style Live Preview: hide Markdown formatting marks when the
 * selection is not touching that construct. Source text stays in the document;
 * only the view is transformed via Decoration.replace.
 */

import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import {
  collectVisibleWikiRanges,
  ensureLivePreviewViewportTree,
  getLivePreviewDecorationRange,
  hasSkipAncestor,
  maxVisibleParseTo,
  rangesOverlap,
  selectionTouchesRange,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
} from "./shared";
import { findCalloutRanges } from "./callouts";
import {
  collectMarkdownImageRanges,
  collectMarkdownLinkRanges,
} from "../../../utils/markdownInlineRanges";

const HIDEABLE_MARK_NODES = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "LinkMark",
  "QuoteMark",
  "SubscriptMark",
  "SuperscriptMark",
]);

/** Parent constructs that should reveal their marks when selection touches them. */
const INLINE_PARENT_NODES = new Set([
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Strikethrough",
  "Link",
  "Image",
  "Subscript",
  "Superscript",
  "Autolink",
]);

const BLOCK_MARK_NODES = new Set(["HeaderMark", "QuoteMark"]);

const hideMarkDecoration = Decoration.replace({
  inclusive: true,
});

const hideUrlDecoration = Decoration.replace({
  inclusive: true,
});

type MarkdownConstructRange = {
  name: "Image" | "Link";
  from: number;
  to: number;
};

function findCoveringConstruct(
  constructs: MarkdownConstructRange[],
  from: number,
  to: number,
): MarkdownConstructRange | null {
  return (
    constructs.find((range) => rangesOverlap(from, to, range.from, range.to)) ??
    null
  );
}

function findInlineParent(
  state: EditorState,
  markFrom: number,
  markTo: number,
  constructs: MarkdownConstructRange[] = [],
): { name: string; from: number; to: number } | null {
  const covering = findCoveringConstruct(constructs, markFrom, markTo);
  if (covering) return covering;

  const mid = Math.min(markFrom, Math.max(markFrom, markTo - 1));
  let node = syntaxTree(state).resolveInner(mid, 1);
  for (let depth = 0; depth < 10 && node; depth += 1) {
    if (INLINE_PARENT_NODES.has(node.name)) {
      return { name: node.name, from: node.from, to: node.to };
    }
    if (!node.parent) break;
    node = node.parent;
  }
  return null;
}

function shouldRevealMark(
  state: EditorState,
  name: string,
  from: number,
  to: number,
  constructs: MarkdownConstructRange[] = [],
): boolean {
  if (BLOCK_MARK_NODES.has(name)) {
    const line = state.doc.lineAt(from);
    return selectionTouchesRange(state, line.from, line.to);
  }

  const parent = findInlineParent(state, from, to, constructs);
  if (parent) {
    return selectionTouchesRange(state, parent.from, parent.to);
  }

  return selectionTouchesRange(state, from, to, 1);
}

function shouldHideUrl(
  state: EditorState,
  from: number,
  to: number,
  constructs: MarkdownConstructRange[] = [],
): boolean {
  // Autolink body is the URL itself — never hide it.
  let node = syntaxTree(state).resolveInner(from, 1);
  for (let depth = 0; depth < 8 && node; depth += 1) {
    if (node.name === "Autolink") return false;
    if (!node.parent) break;
    node = node.parent;
  }

  const parent = findInlineParent(state, from, to, constructs);
  // Inactive images/links are fully replaced by widgets — skip partial hides.
  if (parent?.name === "Image" || parent?.name === "Link") {
    return false;
  }
  if (parent) {
    return !selectionTouchesRange(state, parent.from, parent.to);
  }
  return !selectionTouchesRange(state, from, to, 1);
}

export function buildLivePreviewHideDecorations(
  view: EditorView,
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const parseTo = maxVisibleParseTo(view);
  const tree = ensureLivePreviewViewportTree(view, parseTo);
  const wikiRanges = collectVisibleWikiRanges(view, 2);
  const { from: viewFrom, to: viewTo } = getLivePreviewDecorationRange(view);
  const viewportText = state.doc.sliceString(viewFrom, viewTo);
  const markdownConstructs: MarkdownConstructRange[] = [
    ...collectMarkdownImageRanges(viewportText).map((range) => ({
      name: "Image" as const,
      from: range.from + viewFrom,
      to: range.to + viewFrom,
    })),
    ...collectMarkdownLinkRanges(viewportText).map((range) => ({
      name: "Link" as const,
      from: range.from + viewFrom,
      to: range.to + viewFrom,
    })),
  ];
  // Look back so open callouts that started above the viewport still suppress marks.
  const calloutScanFrom = Math.max(0, viewFrom - 8000);
  const calloutSlice = state.doc.sliceString(calloutScanFrom, viewTo);
  const calloutRanges = findCalloutRanges(calloutSlice)
    .map((range) => ({
      ...range,
      from: range.from + calloutScanFrom,
      to: range.to + calloutScanFrom,
    }))
    .filter((range) => range.to >= viewFrom && range.from <= viewTo);

  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];

  tree.iterate({
    from: viewFrom,
    to: viewTo,
    enter: (node) => {
      const { name, from, to } = node;
      if (from >= to) return;
      const covering = findCoveringConstruct(markdownConstructs, from, to);
      if (
        covering &&
        !selectionTouchesRange(state, covering.from, covering.to)
      ) {
        return;
      }
      if (wikiRanges.some((w) => rangesOverlap(from, to, w.from, w.to))) {
        return;
      }
      if (calloutRanges.some((c) => rangesOverlap(from, to, c.from, c.to))) {
        return;
      }

      if (HIDEABLE_MARK_NODES.has(name)) {
        if (hasSkipAncestor(state, from)) return;
        const parent = findInlineParent(state, from, to, markdownConstructs);
        // Image/Link widgets replace the whole construct when inactive.
        if (
          (parent?.name === "Image" || parent?.name === "Link") &&
          !selectionTouchesRange(state, parent.from, parent.to)
        ) {
          return;
        }
        if (shouldRevealMark(state, name, from, to, markdownConstructs)) return;
        let hideTo = to;
        // ATX hashes / `>` marks are just the sigil; the following space would
        // indent the first visual line while wrapped lines sit under the chrome.
        if (name === "HeaderMark" || name === "QuoteMark") {
          const line = state.doc.lineAt(from);
          const rest = state.doc.sliceString(to, line.to);
          const spaces = rest.match(/^[ \t]+/);
          if (spaces) hideTo = to + spaces[0].length;
        }
        ranges.push({ from, to: hideTo, deco: hideMarkDecoration });
        return;
      }

      if (name === "URL") {
        if (hasSkipAncestor(state, from)) return;
        if (!shouldHideUrl(state, from, to, markdownConstructs)) return;
        ranges.push({ from, to, deco: hideUrlDecoration });
      }
    },
  });

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;
  for (const range of ranges) {
    if (range.from < lastTo) continue;
    builder.add(range.from, range.to, range.deco);
    lastTo = range.to;
  }

  return builder.finish();
}

export const livePreviewHideFormatting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly viewportWindow = new ViewportDecorationWindow();

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewHideDecorations(view);
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
        this.decorations = buildLivePreviewHideDecorations(update.view);
        this.viewportWindow.mark(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        return view.plugin(plugin)?.decorations ?? Decoration.none;
      }),
  },
);

export const livePreviewTheme = EditorView.baseTheme({
  // Match Reading `.task-list-item-checkbox` chrome.
  ".cm-live-preview-task": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1em",
    height: "1em",
    marginInline: "0.1em 0.35em",
    verticalAlign: "middle",
    cursor: "pointer",
    border: "1.5px solid var(--mp-doc-task-border, #94a3b8)",
    borderRadius: "0.28rem",
    background: "#ffffff",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
    padding: 0,
    color: "inherit",
  },
  ".cm-live-preview-task[data-checked='true']": {
    background: "var(--mp-doc-task-checked, var(--mp-doc-accent, #2563eb))",
    borderColor: "var(--mp-doc-task-checked, var(--mp-doc-accent, #2563eb))",
    boxShadow: "none",
  },
  ".cm-live-preview-task[data-checked='true']::after": {
    content: '""',
    width: "0.35em",
    height: "0.6em",
    borderRight: "2px solid #fff",
    borderBottom: "2px solid #fff",
    transform: "rotate(40deg) translate(-0.05em, -0.08em)",
  },
  ".cm-live-preview-image": {
    display: "block",
    maxWidth: "100%",
    height: "auto",
    borderRadius: "0.35rem",
    cursor: "text",
  },
  ".cm-live-preview-image-wrap": {
    display: "inline-block",
    maxWidth: "100%",
    verticalAlign: "middle",
    // Prefer padding over margin — CM block height maps ignore vertical margins.
    paddingBlock: "0.35em",
    cursor: "text",
  },
  ".cm-live-preview-image-wrap.is-loading": {
    minWidth: "4rem",
    minHeight: "2.5rem",
    background:
      "color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 18%, transparent)",
    borderRadius: "0.4rem",
  },
  ".cm-live-preview-image-wrap.is-error": {
    minWidth: "4rem",
    minHeight: "2.5rem",
    outline: "1px dashed color-mix(in srgb, #ef4444 55%, transparent)",
    borderRadius: "0.4rem",
    opacity: "0.85",
  },
  ".cm-live-preview-mermaid-status": {
    fontSize: "0.8em",
    color: "var(--mp-doc-muted, #94a3b8)",
    // Prefer padding — CM block height maps ignore vertical margins.
    paddingBottom: "0.35em",
  },
  ".cm-live-preview-mermaid.is-error": {
    cursor: "pointer",
    outline: "1px dashed color-mix(in srgb, #ef4444 55%, transparent)",
  },
  ".cm-live-preview-soft-off": {
    display: "flex",
    flexDirection: "column",
    gap: "0.2em",
    width: "100%",
    padding: "0.55em 0.7em",
    borderRadius: "0.4rem",
    border:
      "1px dashed color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 55%, transparent)",
    background:
      "color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 10%, transparent)",
    color: "var(--mp-doc-muted, #64748b)",
    fontSize: "0.85em",
    lineHeight: "1.35",
  },
  ".cm-live-preview-soft-off-label": {
    fontWeight: "650",
    color: "var(--mp-doc-text, inherit)",
  },
  ".cm-live-preview-soft-off-summary": {
    opacity: "0.9",
  },
  ".cm-live-preview-soft-off-hint": {
    opacity: "0.75",
    fontSize: "0.92em",
  },
  ".cm-live-preview-math": {
    display: "inline-block",
    verticalAlign: "middle",
  },
  // Widget class is `cm-live-preview-math is-display`; keep the older
  // `cm-live-preview-math-display` alias in sync.
  ".cm-live-preview-math.is-display, .cm-live-preview-math-display": {
    display: "block",
    boxSizing: "border-box",
    width: "auto",
    marginInline: "var(--pane-content-px)",
    paddingBlock: "0.5em",
    overflowX: "auto",
    textAlign: "center",
  },
  // Match Reading: do not let CM line wrapping split KaTeX glyphs.
  ".cm-live-preview-math .katex, .cm-live-preview-math .katex *": {
    wordBreak: "normal",
    overflowWrap: "normal",
  },
  // Link chrome matches Reading `a` / `.wiki-link` underline + accent fallback.
  ".cm-live-preview-wiki": {
    color: "var(--mp-doc-link, var(--mp-doc-accent, #0f9aa8))",
    textDecoration: "underline",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "0.12em",
    cursor: "pointer",
  },
  ".cm-live-preview-wiki.is-unresolved": {
    color: "var(--mp-doc-link-unresolved, var(--mp-doc-accent, #0f9aa8))",
    textDecorationStyle: "dashed",
  },
  ".cm-live-preview-link": {
    color: "var(--mp-doc-link, var(--mp-doc-accent, #0f9aa8))",
    textDecoration: "underline",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "0.12em",
    cursor: "pointer",
  },
  ".cm-live-preview-table-wrap": {
    display: "block",
    boxSizing: "border-box",
    // Match `.cm-line` horizontal inset so the table stays in the text column.
    width: "100%",
    maxWidth: "100%",
    paddingBlock: "0.75em",
    paddingInline: "var(--pane-content-px)",
    // Wide tables scroll inside the wrap instead of expanding the editor.
    overflowX: "auto",
    contain: "inline-size",
  },
  ".cm-live-preview-table": {
    borderCollapse: "collapse",
    // Same width as headings/paragraphs; wrap cells instead of shrinking
    // the table into a narrower block (行宽不统一).
    width: "100%",
    maxWidth: "100%",
    tableLayout: "fixed",
    color: "var(--mp-doc-text, #1f2937)",
  },
  ".cm-live-preview-table th, .cm-live-preview-table td": {
    border: "1px solid var(--mp-doc-border, rgba(148, 163, 184, 0.26))",
    padding: "0.45em 0.75em",
    verticalAlign: "top",
    cursor: "text",
    minWidth: 0,
    lineHeight: "1.45",
    color: "inherit",
    // UA default is center on <th> and left on <td> — unify unless GFM align is set.
    textAlign: "left",
    // Override `.cm-lineWrapping { overflow-wrap: anywhere }` inheritance.
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflowWrap: "break-word",
  },
  // Keep fills translucent (like fenced-code) so cm-selectionBackground
  // shows through evenly during full-document selection.
  ".cm-live-preview-table th": {
    background:
      "color-mix(in srgb, var(--mp-doc-table-header-bg, rgba(241, 245, 249, 0.96)) 55%, transparent)",
    color: "var(--mp-doc-text, #334155)",
    fontWeight: "600",
    whiteSpace: "normal",
  },
  ".cm-live-preview-table tbody tr:nth-child(even) td": {
    background:
      "color-mix(in srgb, var(--mp-doc-table-row-alt-bg, rgba(248, 250, 252, 0.96)) 55%, transparent)",
  },
  ".cm-live-preview-table tbody tr:hover td": {
    background:
      "color-mix(in srgb, var(--mp-doc-table-hover-bg, var(--mp-doc-table-row-alt-bg, rgba(248, 250, 252, 0.96))) 55%, transparent)",
  },
  ".cm-live-preview-table-cell-editing": {
    outline: "2px solid var(--mp-doc-accent, #0f9aa8)",
    // Outside the cell so the ring does not cover wrapped descenders.
    outlineOffset: "0",
    background:
      "color-mix(in srgb, var(--mp-doc-accent, #0f9aa8) 8%, transparent)",
    whiteSpace: "pre-wrap",
    wordBreak: "normal",
    overflowWrap: "anywhere",
    caretColor: "var(--mp-doc-accent, #0f9aa8)",
  },
  ".cm-live-preview-table-menu": {
    position: "fixed",
    zIndex: "10050",
    minWidth: "14rem",
    padding: "0.3rem",
    borderRadius: "0.5rem",
    border: "1px solid var(--mp-doc-border, rgba(148, 163, 184, 0.35))",
    background: "var(--mp-doc-surface, #fff)",
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.16)",
    color: "var(--mp-doc-text, #1f2937)",
    fontSize: "0.85rem",
    lineHeight: "1.35",
  },
  ".cm-live-preview-table-menu-item": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    width: "100%",
    border: "none",
    background: "transparent",
    color: "inherit",
    borderRadius: "0.35rem",
    padding: "0.4rem 0.55rem",
    cursor: "pointer",
    textAlign: "left",
  },
  ".cm-live-preview-table-menu-item:hover:not(:disabled)": {
    background:
      "color-mix(in srgb, var(--mp-doc-accent, #0f9aa8) 12%, transparent)",
  },
  ".cm-live-preview-table-menu-item:disabled": {
    opacity: "0.45",
    cursor: "not-allowed",
  },
  ".cm-live-preview-table-menu-kbd": {
    color: "var(--mp-doc-muted, #94a3b8)",
    fontSize: "0.75em",
    whiteSpace: "nowrap",
  },
  ".cm-live-preview-table-menu-sep": {
    height: "1px",
    margin: "0.25rem 0.35rem",
    background:
      "color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 35%, transparent)",
  },
  // Callouts echo Reading blockquote chrome + type accents.
  // Block widgets sit beside `.cm-line` (no horizontal padding on `.cm-content`);
  // margin-inline matches the text column used in Reading.
  ".cm-live-preview-callout": {
    display: "block",
    boxSizing: "border-box",
    marginInline: "var(--pane-content-px)",
    padding: "0.9em 1em",
    paddingBlock: "0.9em",
    borderRadius: "0 14px 14px 0",
    borderInlineStart:
      "4px solid var(--mp-doc-accent, rgba(124, 58, 237, 0.28))",
    background:
      "color-mix(in srgb, var(--mp-doc-quote-bg, rgba(124, 58, 237, 0.04)) 70%, transparent)",
    color: "var(--mp-doc-quote-text, #5b21b6)",
  },
  ".cm-live-preview-callout-title": {
    fontWeight: "700",
    // Prefer padding — CM block height maps ignore vertical margins.
    paddingBottom: "0.35em",
    textTransform: "capitalize",
    color: "var(--mp-doc-text, inherit)",
  },
  ".cm-live-preview-callout-body.markdown-body": {
    fontSize: "0.95em",
    lineHeight: "1.7",
  },
  ".cm-live-preview-callout-warning, .cm-live-preview-callout-caution": {
    borderInlineStartColor: "#d97706",
    background: "color-mix(in srgb, #d97706 10%, transparent)",
    color: "inherit",
  },
  ".cm-live-preview-callout-error, .cm-live-preview-callout-danger, .cm-live-preview-callout-bug":
    {
      borderInlineStartColor: "#dc2626",
      background: "color-mix(in srgb, #dc2626 10%, transparent)",
      color: "inherit",
    },
  ".cm-live-preview-callout-success, .cm-live-preview-callout-tip": {
    borderInlineStartColor: "#16a34a",
    background: "color-mix(in srgb, #16a34a 10%, transparent)",
    color: "inherit",
  },
  ".cm-live-preview-hr": {
    border: "none",
    borderTop: "1px solid var(--mp-doc-border, rgba(124, 58, 237, 0.18))",
    marginInline: "var(--pane-content-px)",
    // Prefer padding — CM block height maps ignore vertical margins.
    paddingBlock: "1em",
  },
  ".cm-live-preview-list-marker": {
    display: "inline-block",
    minWidth: "1.1em",
    marginInlineEnd: "0.35em",
    color: "var(--mp-doc-list-marker, #8b5cf6)",
    textAlign: "right",
  },
  ".cm-live-preview-highlight": {
    background: "var(--mp-doc-mark-bg, rgba(235, 203, 139, 0.45))",
    color: "var(--mp-doc-mark-text, inherit)",
    borderRadius: "0.15em",
    paddingInline: "0.1em",
  },
  ".cm-live-preview-mermaid": {
    display: "block",
    boxSizing: "border-box",
    width: "fit-content",
    maxWidth: "calc(100% - 2 * var(--pane-content-px))",
    marginInline: "var(--pane-content-px)",
    overflowX: "auto",
    padding: "1.5em",
    paddingBlock: "1.5em",
    borderRadius: "8px",
    background: "rgba(128, 128, 128, 0.05)",
    textAlign: "center",
  },
  ".cm-live-preview-mermaid .mermaid": {
    display: "flex",
    justifyContent: "center",
  },
  ".cm-live-preview-mermaid .mermaid > svg": {
    display: "block",
    maxWidth: "none",
    width: "auto",
    height: "auto",
    marginInline: "auto",
  },
  ".cm-live-preview-mermaid .mermaid svg svg": {
    maxWidth: "none",
    width: "auto",
    height: "auto",
  },
  // Match Reading `.preview-note-embed` card chrome (translucent for selection).
  ".cm-live-preview-note-embed": {
    display: "block",
    boxSizing: "border-box",
    marginInline: "var(--pane-content-px)",
    overflow: "hidden",
    padding: "0",
    borderRadius: "1rem",
    border: "1px solid var(--mp-doc-border, rgba(148, 163, 184, 0.2))",
    background: "color-mix(in srgb, #ffffff 55%, transparent)",
    boxShadow:
      "0 14px 32px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7)",
  },
  ".cm-live-preview-note-embed-body.markdown-body": {
    fontSize: "0.95em",
    lineHeight: "1.8",
    padding: "1rem 1.05rem",
    color: "var(--mp-doc-text, #312e81)",
  },
  ".cm-live-preview-note-embed-title": {
    display: "block",
    padding: "0.8rem 1rem",
    borderBottom: "1px solid var(--mp-doc-border, rgba(148, 163, 184, 0.18))",
    fontSize: "0.9em",
    fontWeight: "700",
    letterSpacing: "0.01em",
    color: "var(--mp-doc-muted, #475569)",
    textDecoration: "none",
    cursor: "pointer",
  },
  ".cm-live-preview-note-embed-body": {
    fontSize: "0.95em",
    opacity: "1",
  },
});
