/**
 * Live Preview: Callouts `> [!type] Title` and horizontal rules.
 */

import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { renderMarkdown } from "../../../utils/markdown";
import {
  defineLivePreviewBlockDecorationField,
  getCachedMarkdownHtml,
  hasSkipAncestor,
  selectionTouchesRange,
  bindLivePreviewMediaMeasure,
  bindLivePreviewWidgetCaret,
  bindLivePreviewWidgetResizeMeasure,
  type BlockDecorationBuild,
  type CoverageRange,
} from "./shared";
import {
  getLivePreviewOptimizationMode,
  SoftOffPlaceholderWidget,
  softOffReason,
} from "./softOff";
import { livePreviewContextFacet } from "./context";

const CALLOUT_START = /^>\s*\[!([A-Za-z0-9_-]+)\]([+-]?)\s*(.*)$/;

export interface CalloutRange {
  from: number;
  to: number;
  type: string;
  foldable: boolean;
  title: string;
  bodyMarkdown: string;
}

export function findCalloutRanges(docText: string): CalloutRange[] {
  const lines = docText.split("\n");
  const ranges: CalloutRange[] = [];
  let i = 0;
  let offset = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(CALLOUT_START);
    if (!match) {
      offset += line.length + 1;
      i += 1;
      continue;
    }

    const type = match[1].toLowerCase();
    const foldable = match[2] === "+" || match[2] === "-";
    const title = (match[3] ?? "").trim() || type;
    const from = offset;
    const bodyLines: string[] = [];
    let j = i + 1;
    let endOffset = offset + line.length;

    while (j < lines.length) {
      const next = lines[j];
      if (!next.startsWith(">")) break;
      const content = next.replace(/^>\s?/, "");
      bodyLines.push(content);
      endOffset += 1 + next.length;
      j += 1;
    }

    ranges.push({
      from,
      to: endOffset,
      type,
      foldable,
      title,
      bodyMarkdown: bodyLines.join("\n"),
    });

    for (let k = i; k < j; k += 1) {
      offset += lines[k].length + 1;
    }
    i = j;
  }

  return ranges;
}

class CalloutWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly title: string,
    readonly bodyHtml: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: CalloutWidget) {
    return (
      this.type === other.type &&
      this.title === other.title &&
      this.bodyHtml === other.bodyHtml &&
      this.from === other.from
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = `cm-live-preview-callout cm-live-preview-callout-${this.type}`;
    wrap.setAttribute("contenteditable", "false");
    wrap.setAttribute("data-callout", this.type);

    const title = document.createElement("div");
    title.className = "cm-live-preview-callout-title";
    title.textContent = this.title;
    wrap.appendChild(title);

    if (this.bodyHtml.trim()) {
      const body = document.createElement("div");
      body.className = "cm-live-preview-callout-body markdown-body";
      body.innerHTML = this.bodyHtml;
      wrap.appendChild(body);
      bindLivePreviewMediaMeasure(view, body);
    }

    bindLivePreviewWidgetResizeMeasure(view, wrap);
    bindLivePreviewWidgetCaret(view, wrap, this.from);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(readonly from: number) {
    super();
  }

  eq(other: HorizontalRuleWidget) {
    return this.from === other.from;
  }

  toDOM(view: EditorView) {
    const hr = document.createElement("hr");
    hr.className = "cm-live-preview-hr";
    bindLivePreviewWidgetCaret(view, hr, this.from);
    return hr;
  }

  ignoreEvent() {
    return true;
  }
}

export function buildCalloutDecorations(
  state: EditorState,
  scanRanges?: readonly CoverageRange[],
): BlockDecorationBuild {
  const coverage: CoverageRange[] = [];
  const mode = getLivePreviewOptimizationMode(state);
  const reason = softOffReason(mode, "callout");
  // Large-file mode: leave source visible; banner covers why.
  if (mode === "large") {
    return { decorations: Decoration.none, coverage };
  }

  const builder = new RangeSetBuilder<Decoration>();
  const ctx = state.facet(livePreviewContextFacet);
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
  const scans =
    scanRanges && scanRanges.length > 0
      ? scanRanges
      : [{ from: 0, to: state.doc.length }];

  for (const scan of scans) {
    const from = Math.max(0, scan.from);
    const to = Math.min(state.doc.length, scan.to);
    if (from >= to) continue;
    const slice = state.doc.sliceString(from, to);
    for (const callout of findCalloutRanges(slice)) {
      const absFrom = callout.from + from;
      const absTo = callout.to + from;
      coverage.push({ from: absFrom, to: absTo });
      if (selectionTouchesRange(state, absFrom, absTo)) continue;
      if (hasSkipAncestor(state, absFrom)) continue;

      if (reason) {
        ranges.push({
          from: absFrom,
          to: absTo,
          deco: Decoration.replace({
            widget: new SoftOffPlaceholderWidget(
              "callout",
              reason,
              callout.title,
              absFrom,
            ),
            block: true,
          }),
        });
        continue;
      }

      let bodyHtml = "";
      if (callout.bodyMarkdown.trim()) {
        try {
          const renderOpts = {
            themeMode: ctx.themeMode,
            markdownStylePreset: ctx.markdownStylePreset,
            highlighter: ctx.highlighter ?? null,
          };
          const cacheKey = `${callout.bodyMarkdown}::${ctx.themeMode ?? "light"}::${ctx.markdownStylePreset ?? "nord"}::${ctx.highlighter?.__revision ?? 0}`;
          bodyHtml = getCachedMarkdownHtml(
            callout.bodyMarkdown,
            (source) => renderMarkdown(source, renderOpts),
            cacheKey,
          );
        } catch {
          bodyHtml = "";
        }
      }

      ranges.push({
        from: absFrom,
        to: absTo,
        deco: Decoration.replace({
          widget: new CalloutWidget(
            callout.type,
            callout.title,
            bodyHtml,
            absFrom,
          ),
          block: true,
        }),
      });
    }
  }

  const parseTo = Math.max(
    ...scans.map((s) => Math.min(state.doc.length, s.to + 200)),
    0,
  );
  const tree = ensureSyntaxTree(state, parseTo, 0) ?? syntaxTree(state);
  for (const scan of scans) {
    tree.iterate({
      from: Math.max(0, scan.from),
      to: Math.min(state.doc.length, scan.to),
      enter: (node) => {
        if (node.name !== "HorizontalRule") return;
        coverage.push({ from: node.from, to: node.to });
        if (selectionTouchesRange(state, node.from, node.to)) return;
        if (hasSkipAncestor(state, node.from)) return;
        ranges.push({
          from: node.from,
          to: node.to,
          deco: Decoration.replace({
            widget: new HorizontalRuleWidget(node.from),
            block: true,
          }),
        });
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

  return { decorations: builder.finish(), coverage };
}

/** @deprecated Prefer buildCalloutDecorations(state). */
export function buildLivePreviewCalloutDecorations(
  view: EditorView,
): DecorationSet {
  return buildCalloutDecorations(view.state).decorations;
}

export const livePreviewCallouts = defineLivePreviewBlockDecorationField({
  create: buildCalloutDecorations,
  createInRanges: (state, ranges) => buildCalloutDecorations(state, ranges),
  rebuildOnContextChange: (prev, next) =>
    prev.themeMode !== next.themeMode ||
    prev.markdownStylePreset !== next.markdownStylePreset ||
    prev.highlighter !== next.highlighter,
});
