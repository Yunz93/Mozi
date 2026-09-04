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
import {
  BLOCKQUOTE_REGEX,
  ORDERED_LIST_REGEX,
  TASK_LIST_REGEX,
  UNORDERED_LIST_REGEX,
  getIndentColumnWidth,
  isInsideFencedCode,
  isWithinFrontmatterBlock,
} from "../behavior/core";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import {
  defineLivePreviewBlockDecorationField,
  ensureLivePreviewViewportTree,
  getLivePreviewDecorationRange,
  bindLivePreviewWidgetCaretAtDom,
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
  /** `replacedLength`：被替换的源码长度（缩进 + 标记 + 空格），点击后光标落在列表内容起点 */
  constructor(
    readonly ordered: boolean,
    readonly label: string,
    readonly replacedLength: number,
  ) {
    super();
  }

  eq(other: BulletWidget) {
    return (
      this.ordered === other.ordered &&
      this.label === other.label &&
      this.replacedLength === other.replacedLength
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = this.ordered
      ? "cm-live-preview-list-marker is-ordered"
      : "cm-live-preview-list-marker is-bullet";
    el.textContent = this.ordered ? `${this.label}.` : "•";
    el.setAttribute("aria-hidden", "true");
    // 非可编辑节点 + 显式落标：否则浏览器会把原生 caret 放进 widget 内部，
    // CodeMirror 再反推位置时会落到 widget 边界，表现为点哪不落哪。
    el.setAttribute("contenteditable", "false");
    bindLivePreviewWidgetCaretAtDom(view, el, this.replacedLength);
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

type LivePreviewListLineParts = {
  quoteLen: number;
  indent: string;
  marker: string;
  ordered: boolean;
  label: string;
  isTask: boolean;
};

function livePreviewListLineParts(
  lineText: string,
): LivePreviewListLineParts | null {
  let quoteLen = 0;
  let rest = lineText;
  const quoteMatch = lineText.match(BLOCKQUOTE_REGEX);
  if (quoteMatch) {
    quoteLen = quoteMatch[1].length + quoteMatch[2].length;
    rest = quoteMatch[3];
  }

  const task = rest.match(TASK_LIST_REGEX);
  if (task) {
    return {
      quoteLen,
      indent: task[1] ?? "",
      marker: task[2] ?? "-",
      ordered: false,
      label: "",
      isTask: true,
    };
  }

  const ordered = rest.match(ORDERED_LIST_REGEX);
  if (ordered) {
    return {
      quoteLen,
      indent: ordered[1] ?? "",
      marker: `${ordered[2] ?? ""}${ordered[3] ?? "."}`,
      ordered: true,
      label: ordered[2] ?? "1",
      isTask: false,
    };
  }

  const unordered = rest.match(UNORDERED_LIST_REGEX);
  if (!unordered) return null;
  return {
    quoteLen,
    indent: unordered[1] ?? "",
    marker: unordered[2] ?? "-",
    ordered: false,
    label: "",
    isTask: false,
  };
}

/** Indent-based nest level when the syntax tree did not emit a nested ListMark. */
export function livePreviewListNestLevelFromIndent(indent: string): number {
  const cols = getIndentColumnWidth(indent);
  if (cols <= 0) return 1;
  const step = cols % 4 === 0 ? 4 : 2;
  return Math.max(
    1,
    Math.min(Math.floor(cols / step) + 1, MAX_LIVE_LIST_LEVEL),
  );
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

  toDOM(view: EditorView) {
    const el = document.createElement("mark");
    el.className = "cm-live-preview-highlight";
    el.textContent = this.text;
    // 点击高亮：光标落到该片段源码起点，触发"选区触碰即显示源码"
    el.setAttribute("contenteditable", "false");
    bindLivePreviewWidgetCaretAtDom(view, el, 0);
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
  const ranges: Array<{ from: number; to: number; content: string }> = [];

  const start = Math.max(0, from);
  const end = Math.min(text.length, to);
  let i = start;

  while (i < end - 1) {
    const open = text.indexOf("==", i);
    if (open === -1 || open + 1 >= end) break;

    // 跳过被转义的起始标记：`\==...==`
    if (open > 0 && text[open - 1] === "\\") {
      i = open + 2;
      continue;
    }

    const first = text[open + 2];
    // 起始侧 flanking：紧随的第一个字符不能是空白或 `=`（排除 `a == b` 这类比较运算）
    if (first === undefined || /\s/.test(first) || first === "=") {
      i = open + 2;
      continue;
    }

    const contentStart = open + 2;
    let search = contentStart;
    let matched = false;

    while (search < end - 1) {
      const close = text.indexOf("==", search);
      if (close === -1 || close + 1 >= end) break;

      // 跳过被转义的结束标记
      if (close > 0 && text[close - 1] === "\\") {
        search = close + 2;
        continue;
      }

      // 结束侧 flanking：前一个字符不能是空白，后一个字符不能是 `=`
      const before = text[close - 1];
      const after = text[close + 2];
      if (before === undefined || /\s/.test(before) || after === "=") {
        search = close + 2;
        continue;
      }

      const content = text.slice(contentStart, close);
      // 不允许跨空行（跨段落）：否则前后段落会被误合并成一个高亮
      if (/\n[ \t]*\n/.test(content)) {
        search = close + 2;
        continue;
      }

      ranges.push({
        from: open,
        to: close + 2,
        content,
      });
      matched = true;
      i = close + 2;
      break;
    }

    if (!matched) {
      i = open + 2;
    }
  }
  return ranges;
}

export function findCommentRanges(
  text: string,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];

  const start = Math.max(0, from);
  const end = Math.min(text.length, to);
  let i = start;

  while (i < end - 1) {
    const open = text.indexOf("%%", i);
    if (open === -1 || open + 1 >= end) break;

    const contentStart = open + 2;
    let search = contentStart;
    let matched = false;

    while (search < end - 1) {
      const close = text.indexOf("%%", search);
      if (close === -1 || close + 1 >= end) break;

      const content = text.slice(contentStart, close);
      // 不允许跨空行（跨段落）
      if (/\n[ \t]*\n/.test(content)) {
        search = close + 2;
        continue;
      }

      ranges.push({
        from: open,
        to: close + 2,
      });
      matched = true;
      i = close + 2;
      break;
    }

    if (!matched) {
      i = open + 2;
    }
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
              widget: new BulletWidget(ordered, label, end - replaceFrom),
            }),
      });
    },
  });

  // Nested items can be parsed as indented code / paragraph text, so ListMark
  // is missing and the hyphen stays visible. Scan source lines as a fallback.
  let linePos = viewportFrom;
  while (linePos <= viewportTo) {
    const line = state.doc.lineAt(linePos);
    if (
      !decoratedLines.has(line.from) &&
      !selectionTouchesRange(state, line.from, line.to) &&
      !isWithinFrontmatterBlock(state, line.from) &&
      !isInsideFencedCode(state, line.from)
    ) {
      const parts = livePreviewListLineParts(line.text);
      if (parts) {
        const afterMarker =
          parts.quoteLen + parts.indent.length + parts.marker.length;
        const hasSpace = line.text[afterMarker] === " ";
        const replaceFrom = line.from + parts.quoteLen;
        const replaceTo = line.from + afterMarker + (hasSpace ? 1 : 0);
        const level = livePreviewListNestLevelFromIndent(parts.indent);
        decoratedLines.add(line.from);
        ranges.push({
          from: line.from,
          to: line.from,
          deco: livePreviewListLineDecos[level - 1]!,
        });
        if (replaceTo > replaceFrom) {
          ranges.push({
            from: replaceFrom,
            to: replaceTo,
            deco: parts.isTask
              ? hideTaskListMarkDecoration
              : Decoration.replace({
                  widget: new BulletWidget(
                    parts.ordered,
                    parts.label,
                    replaceTo - replaceFrom,
                  ),
                }),
          });
        }
      }
    }
    if (line.to >= viewportTo) break;
    linePos = line.to + 1;
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of ranges) {
    builder.add(range.from, range.to, range.deco);
  }

  return builder.finish();
}

export function buildHighlightDecorationsInScanRanges(
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
      // 多行高亮时结束标记可能落在代码等跳过节点内部，两端都要检查
      if (absTo > absFrom && hasSkipAncestor(state, absTo - 1)) continue;

      const contentStart = absFrom + 2;
      const contentEnd = absTo - 2;

      const firstLineNo = state.doc.lineAt(absFrom).number;
      const lastLineNo = state.doc.lineAt(Math.max(absFrom, absTo - 1)).number;
      for (let lineNo = firstLineNo; lineNo <= lastLineNo; lineNo += 1) {
        const line = state.doc.line(lineNo);
        const segFrom = Math.max(absFrom, line.from);
        const segTo = Math.min(absTo, line.to);
        if (segFrom >= segTo) continue;

        const fragFrom = Math.max(contentStart, line.from);
        const fragTo = Math.min(contentEnd, line.to);
        if (fragFrom >= fragTo) continue;

        const fragmentText = state.doc.sliceString(fragFrom, fragTo);
        ranges.push({
          from: segFrom,
          to: segTo,
          deco: Decoration.replace({
            widget: new HighlightWidget(fragmentText),
          }),
        });
      }
    }

    for (const range of findCommentRanges(text, 0, text.length)) {
      const absFrom = scan.from + range.from;
      const absTo = scan.from + range.to;
      coverage.push({ from: absFrom, to: absTo });
      if (selectionTouchesRange(state, absFrom, absTo)) continue;
      if (hasSkipAncestor(state, absFrom)) continue;
      if (absTo > absFrom && hasSkipAncestor(state, absTo - 1)) continue;

      const firstLineNo = state.doc.lineAt(absFrom).number;
      const lastLineNo = state.doc.lineAt(Math.max(absFrom, absTo - 1)).number;
      for (let lineNo = firstLineNo; lineNo <= lastLineNo; lineNo += 1) {
        const line = state.doc.line(lineNo);
        const segFrom = Math.max(absFrom, line.from);
        const segTo = Math.min(absTo, line.to);
        if (segFrom >= segTo) continue;

        ranges.push({
          from: segFrom,
          to: segTo,
          deco: Decoration.replace({}),
        });
      }
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
