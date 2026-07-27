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
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import {
  collectWikiLinkRanges,
  hasSkipAncestor,
  livePreviewShouldRebuild,
  rangesOverlap,
  selectionTouchesRange,
} from "./shared";
import { findCalloutRanges } from "./callouts";

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

function findInlineParent(
  state: EditorState,
  markFrom: number,
  markTo: number,
): { name: string; from: number; to: number } | null {
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
): boolean {
  if (BLOCK_MARK_NODES.has(name)) {
    const line = state.doc.lineAt(from);
    return selectionTouchesRange(state, line.from, line.to);
  }

  const parent = findInlineParent(state, from, to);
  if (parent) {
    return selectionTouchesRange(state, parent.from, parent.to);
  }

  return selectionTouchesRange(state, from, to, 1);
}

function shouldHideUrl(state: EditorState, from: number, to: number): boolean {
  // Autolink body is the URL itself — never hide it.
  let node = syntaxTree(state).resolveInner(from, 1);
  for (let depth = 0; depth < 8 && node; depth += 1) {
    if (node.name === "Autolink") return false;
    if (!node.parent) break;
    node = node.parent;
  }

  const parent = findInlineParent(state, from, to);
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
  let parseTo = 0;
  for (const { to } of view.visibleRanges) {
    parseTo = Math.max(parseTo, to);
  }
  const tree =
    ensureSyntaxTree(state, Math.min(state.doc.length, parseTo + 500), 50) ??
    syntaxTree(state);
  const docText = state.doc.toString();
  const wikiRanges = view.visibleRanges.flatMap(({ from, to }) =>
    collectWikiLinkRanges(
      docText,
      Math.max(0, from - 2),
      Math.min(docText.length, to + 2),
    ),
  );
  const viewFrom = view.visibleRanges.length
    ? Math.min(...view.visibleRanges.map((range) => range.from))
    : 0;
  const viewTo = view.visibleRanges.length
    ? Math.max(...view.visibleRanges.map((range) => range.to))
    : state.doc.length;
  const calloutRanges = findCalloutRanges(docText).filter(
    (range) => range.to >= viewFrom && range.from <= viewTo,
  );

  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];

  for (const { from: viewportFrom, to: viewportTo } of view.visibleRanges) {
    tree.iterate({
      from: viewportFrom,
      to: viewportTo,
      enter: (node) => {
        const { name, from, to } = node;
        if (from >= to) return;
        if (wikiRanges.some((w) => rangesOverlap(from, to, w.from, w.to))) {
          return;
        }
        if (calloutRanges.some((c) => rangesOverlap(from, to, c.from, c.to))) {
          return;
        }

        if (HIDEABLE_MARK_NODES.has(name)) {
          if (hasSkipAncestor(state, from)) return;
          const parent = findInlineParent(state, from, to);
          // Image/Link widgets replace the whole construct when inactive.
          if (
            (parent?.name === "Image" || parent?.name === "Link") &&
            !selectionTouchesRange(state, parent.from, parent.to)
          ) {
            return;
          }
          if (shouldRevealMark(state, name, from, to)) return;
          ranges.push({ from, to, deco: hideMarkDecoration });
          return;
        }

        if (name === "URL") {
          if (hasSkipAncestor(state, from)) return;
          if (!shouldHideUrl(state, from, to)) return;
          ranges.push({ from, to, deco: hideUrlDecoration });
        }
      },
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

export const livePreviewHideFormatting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewHideDecorations(view);
    }

    update(update: ViewUpdate) {
      if (livePreviewShouldRebuild(update, "marks")) {
        this.decorations = buildLivePreviewHideDecorations(update.view);
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
  ".cm-live-preview-task": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.05em",
    height: "1.05em",
    marginInline: "0.1em 0.35em",
    verticalAlign: "middle",
    cursor: "pointer",
    border:
      "1.5px solid var(--mp-doc-task-border, var(--mp-doc-list-marker, #94a3b8))",
    borderRadius: "0.25em",
    background: "transparent",
    padding: 0,
    color: "inherit",
  },
  ".cm-live-preview-task[data-checked='true']": {
    background: "var(--mp-doc-task-checked, var(--mp-doc-accent, #2563eb))",
    borderColor: "var(--mp-doc-task-checked, var(--mp-doc-accent, #2563eb))",
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
    marginBottom: "0.35em",
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
  ".cm-live-preview-math-display": {
    display: "block",
    width: "100%",
    paddingBlock: "0.65em",
    overflowX: "auto",
    textAlign: "center",
  },
  ".cm-live-preview-wiki": {
    color: "var(--mp-doc-link, var(--mp-doc-accent, #2563eb))",
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
    cursor: "pointer",
  },
  ".cm-live-preview-wiki.is-unresolved": {
    color: "var(--mp-doc-link-unresolved, var(--mp-doc-muted, #94a3b8))",
    textDecorationStyle: "dashed",
  },
  ".cm-live-preview-link": {
    color: "var(--mp-doc-link, var(--mp-doc-accent, #2563eb))",
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
    cursor: "pointer",
  },
  ".cm-live-preview-table-wrap": {
    display: "block",
    width: "100%",
    // Scroll container — do not also max-width the <table>, or columns get
    // crushed and cell text / borders clip without a scrollbar.
    overflowX: "auto",
    paddingBlock: "0.75em",
  },
  ".cm-live-preview-table": {
    borderCollapse: "collapse",
    // Size to content so short CJK headers keep a readable column width.
    // Horizontal overflow is handled by the wrap above (not max-width here).
    width: "max-content",
    maxWidth: "none",
    tableLayout: "auto",
    fontSize: "0.95em",
  },
  ".cm-live-preview-table th, .cm-live-preview-table td": {
    border: "1px solid var(--mp-doc-border, rgba(148, 163, 184, 0.35))",
    padding: "0.45em 0.75em",
    verticalAlign: "top",
    cursor: "text",
    minWidth: "3.5em",
    maxWidth: "28em",
    lineHeight: "1.45",
    // Override `.cm-lineWrapping { overflow-wrap: anywhere }` inheritance.
    whiteSpace: "normal",
    wordBreak: "keep-all",
    overflowWrap: "break-word",
  },
  ".cm-live-preview-table th": {
    background: "var(--mp-doc-table-header-bg, rgba(148, 163, 184, 0.12))",
    fontWeight: "650",
    whiteSpace: "nowrap",
  },
  ".cm-live-preview-table tbody tr:nth-child(even) td": {
    background: "var(--mp-doc-table-row-alt-bg, transparent)",
  },
  ".cm-live-preview-table-cell-editing": {
    outline: "2px solid var(--mp-doc-accent, #2563eb)",
    // Outside the cell so the ring does not cover wrapped descenders.
    outlineOffset: "0",
    background:
      "color-mix(in srgb, var(--mp-doc-accent, #2563eb) 8%, transparent)",
    whiteSpace: "pre-wrap",
    wordBreak: "normal",
    overflowWrap: "anywhere",
    caretColor: "var(--mp-doc-accent, #2563eb)",
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
      "color-mix(in srgb, var(--mp-doc-accent, #2563eb) 12%, transparent)",
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
  ".cm-live-preview-callout": {
    display: "block",
    padding: "0.65em 0.85em",
    paddingBlock: "0.85em",
    borderRadius: "0.45rem",
    borderInlineStart: "4px solid var(--mp-doc-accent, #2563eb)",
    background:
      "color-mix(in srgb, var(--mp-doc-accent, #2563eb) 8%, transparent)",
  },
  ".cm-live-preview-callout-title": {
    fontWeight: "700",
    marginBottom: "0.35em",
    textTransform: "capitalize",
  },
  ".cm-live-preview-callout-body.markdown-body": {
    fontSize: "0.95em",
    lineHeight: "1.7",
  },
  ".cm-live-preview-callout-warning, .cm-live-preview-callout-caution": {
    borderInlineStartColor: "#d97706",
    background: "color-mix(in srgb, #d97706 10%, transparent)",
  },
  ".cm-live-preview-callout-error, .cm-live-preview-callout-danger, .cm-live-preview-callout-bug":
    {
      borderInlineStartColor: "#dc2626",
      background: "color-mix(in srgb, #dc2626 10%, transparent)",
    },
  ".cm-live-preview-callout-success, .cm-live-preview-callout-tip": {
    borderInlineStartColor: "#16a34a",
    background: "color-mix(in srgb, #16a34a 10%, transparent)",
  },
  ".cm-live-preview-hr": {
    border: "none",
    borderTop:
      "1px solid color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 45%, transparent)",
    // Prefer padding — CM block height maps ignore vertical margins.
    paddingBlock: "1em",
  },
  ".cm-live-preview-list-marker": {
    display: "inline-block",
    minWidth: "1.1em",
    marginInlineEnd: "0.35em",
    color: "var(--mp-doc-list-marker, #94a3b8)",
    textAlign: "right",
  },
  ".cm-live-preview-highlight": {
    background:
      "var(--mp-doc-mark-bg, color-mix(in srgb, #eab308 35%, transparent))",
    color: "var(--mp-doc-mark-text, inherit)",
    borderRadius: "0.15em",
    paddingInline: "0.1em",
  },
  ".cm-live-preview-mermaid": {
    display: "block",
    width: "100%",
    overflowX: "auto",
    padding: "0.5em",
    paddingBlock: "0.75em",
    borderRadius: "0.45rem",
    background:
      "color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 8%, transparent)",
  },
  ".cm-live-preview-note-embed": {
    display: "block",
    padding: "0.65em 0.85em",
    paddingBlock: "0.85em",
    borderRadius: "0.45rem",
    border:
      "1px solid color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 30%, transparent)",
    background:
      "color-mix(in srgb, var(--mp-doc-muted, #94a3b8) 6%, transparent)",
  },
  ".cm-live-preview-note-embed-body.markdown-body": {
    fontSize: "0.95em",
    lineHeight: "1.7",
  },
  ".cm-live-preview-note-embed-title": {
    display: "inline-block",
    fontWeight: "650",
    color: "var(--mp-doc-accent, #2563eb)",
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
    marginBottom: "0.35em",
    cursor: "pointer",
  },
  ".cm-live-preview-note-embed-body": {
    fontSize: "0.95em",
    opacity: "0.92",
  },
});
