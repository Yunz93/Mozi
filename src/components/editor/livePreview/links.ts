/**
 * Live Preview: clickable markdown links `[text](url)` (non-image).
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
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import { livePreviewContextFacet } from "./context";
import {
  collectVisibleWikiRanges,
  hasSkipAncestor,
  livePreviewContextChanged,
  rangesOverlap,
  selectionTouchesRange,
  shouldRebuildLivePreviewDecorations,
  maxVisibleParseTo,
  ViewportDecorationWindow,
} from "./shared";

class MarkdownLinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly href: string,
  ) {
    super();
  }

  eq(other: MarkdownLinkWidget) {
    return this.label === other.label && this.href === other.href;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("a");
    el.className = "cm-live-preview-link";
    el.href = this.href;
    el.textContent = this.label || this.href;
    el.setAttribute("contenteditable", "false");
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ctx = view.state.facet(livePreviewContextFacet);
      void ctx.onOpenLink?.(this.href);
    });
    el.addEventListener("mousedown", (event) => {
      // Keep selection from jumping into hidden source mid-click.
      if (event.button === 0) event.preventDefault();
    });
    return el;
  }

  ignoreEvent(event: Event) {
    return event.type !== "click" && event.type !== "mousedown";
  }
}

function extractLinkParts(
  state: { doc: { sliceString: (a: number, b: number) => string } },
  from: number,
  to: number,
): { label: string; href: string } {
  let href = "";
  let label = "";
  const tree = syntaxTree(state as never);
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "URL") {
        href = state.doc.sliceString(node.from, node.to);
      }
    },
  });
  const full = state.doc.sliceString(from, to);
  const labelMatch = full.match(/^\[([^\]]*)\]/);
  label = labelMatch?.[1] ?? "";
  return { label, href: href.trim() };
}

export function buildLivePreviewLinkDecorations(
  view: EditorView,
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const tree =
    ensureSyntaxTree(state, maxVisibleParseTo(view), 0) ?? syntaxTree(state);
  const wikiRanges = collectVisibleWikiRanges(view, 2);

  for (const { from: viewportFrom, to: viewportTo } of view.visibleRanges) {
    tree.iterate({
      from: viewportFrom,
      to: viewportTo,
      enter: (node) => {
        if (node.name !== "Link") return;
        const { from, to } = node;
        if (selectionTouchesRange(state, from, to)) return;
        if (hasSkipAncestor(state, from)) return;
        if (wikiRanges.some((w) => rangesOverlap(from, to, w.from, w.to))) {
          return;
        }

        const { label, href } = extractLinkParts(state, from, to);
        if (!href) return;

        builder.add(
          from,
          to,
          Decoration.replace({
            widget: new MarkdownLinkWidget(label, href),
          }),
        );
      },
    });
  }

  return builder.finish();
}

export const livePreviewLinks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly viewportWindow = new ViewportDecorationWindow();
    constructor(view: EditorView) {
      this.decorations = buildLivePreviewLinkDecorations(view);
      this.viewportWindow.mark(view);
    }
    update(update: ViewUpdate) {
      if (
        livePreviewContextChanged(update) ||
        shouldRebuildLivePreviewDecorations(
          update,
          "widgets",
          this.viewportWindow,
        )
      ) {
        this.decorations = buildLivePreviewLinkDecorations(update.view);
        this.viewportWindow.mark(update.view);
      }
    }
  },
  { decorations: (p) => p.decorations },
);
