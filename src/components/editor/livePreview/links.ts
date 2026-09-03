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
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import { livePreviewContextFacet } from "./context";
import { collectMarkdownLinkRanges } from "../../../utils/markdownInlineRanges";
import { bindLivePreviewWidgetModClick } from "./clickableLinks";
import { renderMarkdown } from "../../../utils/markdown";
import {
  collectVisibleWikiRanges,
  getLivePreviewDecorationRange,
  hasSkipAncestor,
  livePreviewContextChanged,
  rangesOverlap,
  selectionTouchesRange,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
  getCachedMarkdownHtml,
} from "./shared";

function renderInlineLinkLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  return getCachedMarkdownHtml(trimmed, (source) => {
    const html = renderMarkdown(source);
    const match = html.match(/<p>([\s\S]*?)<\/p>/i);
    return match?.[1] ?? html;
  });
}

class MarkdownLinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly href: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: MarkdownLinkWidget) {
    return (
      this.label === other.label &&
      this.href === other.href &&
      this.from === other.from
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement("a");
    el.className = "cm-live-preview-link";
    el.href = this.href;
    if (this.label.trim()) {
      const labelHtml = renderInlineLinkLabel(this.label);
      if (labelHtml) {
        el.innerHTML = labelHtml;
      } else {
        el.textContent = this.href;
      }
    } else {
      el.textContent = this.href;
    }
    el.setAttribute("contenteditable", "false");
    bindLivePreviewWidgetModClick(el, view, this.from, () => {
      const ctx = view.state.facet(livePreviewContextFacet);
      void ctx.onOpenLink?.(this.href);
    });
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

export function buildLivePreviewLinkDecorations(
  view: EditorView,
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const wikiRanges = collectVisibleWikiRanges(view, 2);
  const { from: viewportFrom, to: viewportTo } =
    getLivePreviewDecorationRange(view);
  const docText = state.doc.sliceString(viewportFrom, viewportTo);
  const links = collectMarkdownLinkRanges(docText, 0, docText.length)
    .map((link) => ({
      ...link,
      from: link.from + viewportFrom,
      to: link.to + viewportFrom,
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  let lastTo = -1;
  for (const link of links) {
    const { from, to, alt, url } = link;
    if (from < lastTo) continue;
    if (from >= to) continue;
    if (selectionTouchesRange(state, from, to)) continue;
    if (hasSkipAncestor(state, from)) continue;
    if (wikiRanges.some((w) => rangesOverlap(from, to, w.from, w.to))) {
      continue;
    }
    if (!url) continue;

    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new MarkdownLinkWidget(alt, url, from),
      }),
    );
    lastTo = to;
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
