/**
 * CodeMirror 装饰器
 *
 * 提供视觉装饰：
 * - Frontmatter 高亮
 * - 代码块高亮
 * - 列表标记高亮
 */

import { RangeSetBuilder, type Text } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import {
  Decoration,
  ViewPlugin,
  type ViewUpdate,
  type EditorView,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { UNORDERED_LIST_REGEX, ORDERED_LIST_REGEX } from "./behavior";
import {
  getMarkdownListHangPrefixCharCount,
  getFrontmatterRange,
} from "./behavior/core";

import {
  ensureLivePreviewViewportTree,
  getLivePreviewDecorationRange,
  ViewportDecorationWindow,
} from "./livePreview/shared";

// ==================== 语法高亮样式 ====================

export const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading1,
    class: "tok-heading tok-heading-1 mp-tok-heading mp-tok-heading-1",
  },
  {
    tag: tags.heading2,
    class: "tok-heading tok-heading-2 mp-tok-heading mp-tok-heading-2",
  },
  {
    tag: tags.heading3,
    class: "tok-heading tok-heading-3 mp-tok-heading mp-tok-heading-3",
  },
  {
    tag: tags.heading4,
    class: "tok-heading tok-heading-4 mp-tok-heading mp-tok-heading-4",
  },
  {
    tag: tags.heading5,
    class: "tok-heading tok-heading-5 mp-tok-heading mp-tok-heading-5",
  },
  {
    tag: tags.heading6,
    class: "tok-heading tok-heading-6 mp-tok-heading mp-tok-heading-6",
  },
  { tag: tags.heading, class: "tok-heading mp-tok-heading" },
  { tag: tags.strong, class: "tok-strong mp-tok-strong" },
  { tag: tags.emphasis, class: "tok-emphasis mp-tok-emphasis" },
  {
    tag: tags.strikethrough,
    class: "tok-strikethrough mp-tok-strikethrough",
  },
  { tag: [tags.link, tags.url], class: "tok-link mp-tok-link" },
  { tag: [tags.quote, tags.list], class: "mp-tok-muted" },
  {
    tag: [
      tags.separator,
      tags.contentSeparator,
      tags.punctuation,
      tags.meta,
      tags.processingInstruction,
    ],
    class: "tok-punctuation tok-meta mp-tok-muted-soft",
  },
  // Inline code should follow the markdown style preset code text, not the code-string palette.
  { tag: tags.monospace, class: "tok-inline-code mp-tok-inline-code" },
  { tag: [tags.literal, tags.string], class: "tok-string mp-tok-code" },
  {
    tag: [tags.regexp, tags.escape, tags.special(tags.string)],
    class: "tok-string tok-regexp mp-tok-code",
  },
  {
    tag: [tags.keyword, tags.operatorKeyword],
    class: "tok-keyword mp-tok-keyword",
  },
  {
    tag: [
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.modifier,
    ],
    class: "tok-keyword tok-definitionKeyword mp-tok-keyword",
  },
  { tag: [tags.bool, tags.atom], class: "tok-bool tok-atom mp-tok-atom" },
  { tag: tags.number, class: "tok-number mp-tok-number" },
  {
    tag: [tags.propertyName, tags.attributeName, tags.labelName],
    class: "tok-propertyName tok-labelName mp-tok-property",
  },
  {
    tag: [tags.variableName, tags.name, tags.local(tags.variableName)],
    class: "tok-variableName mp-tok-variable",
  },
  {
    tag: [
      tags.definition(tags.variableName),
      tags.definition(tags.propertyName),
    ],
    class: "tok-variableName tok-definition mp-tok-variable",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "tok-function mp-tok-function",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.macroName],
    class: "tok-typeName tok-className mp-tok-type",
  },
  {
    tag: [
      tags.operator,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.compareOperator,
      tags.definitionOperator,
      tags.updateOperator,
    ],
    class: "tok-operator mp-tok-operator",
  },
  { tag: tags.comment, class: "tok-comment mp-tok-comment" },
]);

// ==================== Frontmatter 装饰器 ====================

function buildFrontmatterDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  if (doc.lines === 0 || doc.line(1).text.trim() !== "---") {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const frontmatterLine = Decoration.line({ class: "cm-frontmatter-line" });
  const frontmatterMark = Decoration.mark({ class: "cm-frontmatter-mark" });
  const frontmatterPunctuation = Decoration.mark({
    class: "cm-frontmatter-punctuation",
  });
  const frontmatterKey = Decoration.mark({ class: "cm-frontmatter-key" });
  const frontmatterComment = Decoration.mark({
    class: "cm-frontmatter-comment",
  });

  const firstLine = doc.line(1);
  builder.add(firstLine.from, firstLine.from, frontmatterLine);
  builder.add(firstLine.from, firstLine.to, frontmatterMark);

  let closingLineNumber: number | null = null;
  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    if (doc.line(lineNumber).text.trim() === "---") {
      closingLineNumber = lineNumber;
      break;
    }
  }

  const contentEndLine = closingLineNumber ?? doc.lines + 1;

  for (let lineNumber = 2; lineNumber < contentEndLine; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const text = line.text;
    builder.add(line.from, line.from, frontmatterLine);

    if (!text.trim()) continue;

    const commentMatch = text.match(/^(\s*)(#.*)$/);
    if (commentMatch) {
      const [, indent, comment] = commentMatch;
      const commentFrom = line.from + indent.length;
      builder.add(
        commentFrom,
        commentFrom + comment.length,
        frontmatterComment,
      );
      continue;
    }

    const listMatch = text.match(/^(\s*)(-)(\s+)(.*)$/);
    if (listMatch) {
      const [, indent, marker] = listMatch;
      const markerFrom = line.from + indent.length;
      builder.add(
        markerFrom,
        markerFrom + marker.length,
        frontmatterPunctuation,
      );
      continue;
    }

    const keyValueMatch = text.match(/^(\s*)([^:#\n][^:\n]*?)(\s*):/);
    if (!keyValueMatch) continue;

    const [, indent, key, beforeColon] = keyValueMatch;
    const keyFrom = line.from + indent.length;
    const keyTo = keyFrom + key.length;
    const colonFrom = keyTo + beforeColon.length;

    builder.add(keyFrom, keyTo, frontmatterKey);
    builder.add(colonFrom, colonFrom + 1, frontmatterPunctuation);
  }

  if (closingLineNumber !== null) {
    const closingLine = doc.line(closingLineNumber);
    builder.add(closingLine.from, closingLine.from, frontmatterLine);
    builder.add(closingLine.from, closingLine.to, frontmatterMark);
  }

  return builder.finish();
}

export const frontmatterDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFrontmatterDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildFrontmatterDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

// ==================== 代码块装饰器 ====================

function buildFencedCodeDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  if (view.visibleRanges.length === 0) return Decoration.none;
  const window = getLivePreviewDecorationRange(view);
  const tree = ensureLivePreviewViewportTree(view, window.to);
  const firstVisibleLine = doc.lineAt(window.from).number;
  const lastVisibleLine = doc.lineAt(window.to).number;

  tree.iterate({
    from: window.from,
    to: window.to,
    enter: ({ name, from, to }) => {
      if (name !== "FencedCode") return;

      const firstLineNumber = doc.lineAt(from).number;
      const lastLineNumber = doc.lineAt(Math.max(from, to - 1)).number;

      for (
        let lineNumber = Math.max(firstLineNumber, firstVisibleLine);
        lineNumber <= Math.min(lastLineNumber, lastVisibleLine);
        lineNumber += 1
      ) {
        const line = doc.line(lineNumber);
        const classNames = ["cm-fenced-code-line"];

        if (lineNumber === firstLineNumber) {
          classNames.push(
            "cm-fenced-code-line-start",
            "cm-fenced-code-line-fence",
          );
        } else if (lineNumber === lastLineNumber) {
          classNames.push(
            "cm-fenced-code-line-end",
            "cm-fenced-code-line-fence",
          );
        } else {
          classNames.push("cm-fenced-code-line-body");
        }

        builder.add(
          line.from,
          line.from,
          Decoration.line({ class: classNames.join(" ") }),
        );
      }
      return false;
    },
  });

  return builder.finish();
}

export const fencedCodeDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    private readonly window = new ViewportDecorationWindow();

    constructor(view: EditorView) {
      this.decorations = buildFencedCodeDecorations(view);
      this.window.mark(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        (update.viewportChanged && this.window.needsUpdate(update.view))
      ) {
        this.decorations = buildFencedCodeDecorations(update.view);
        this.window.mark(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

// ==================== 列表装饰器 ====================

/**
 * One-pass fence membership matching `isInsideFencedCode` semantics
 * (open fence line counts as inside; close fence line does not).
 */
function buildFencedLineSet(doc: Text): Set<number> {
  const inside = new Set<number>();
  const stack: Array<{ fenceChar: string; fenceLength: number }> = [];

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const lineText = doc.line(lineNumber).text;
    const match = lineText.match(/^([ \t]*)(`{3,}|~{3,})(.*)$/);
    if (match) {
      const fence = match[2];
      const fenceChar = fence[0];
      const fenceLength = fence.length;
      const top = stack[stack.length - 1];
      if (
        top &&
        top.fenceChar === fenceChar &&
        fenceLength >= top.fenceLength
      ) {
        stack.pop();
      } else if (!top) {
        stack.push({ fenceChar, fenceLength });
      }
    }
    if (stack.length > 0) {
      inside.add(lineNumber);
    }
  }

  return inside;
}

function buildMarkdownListDecorations(
  view: EditorView,
  fencedLines: ReadonlySet<number>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const state = view.state;
  const frontmatter = getFrontmatterRange(state);
  const frontmatterClosingLine = frontmatter?.closingLineNumber ?? 0;
  if (view.visibleRanges.length === 0) return Decoration.none;
  const window = getLivePreviewDecorationRange(view);
  const firstLine = doc.lineAt(window.from).number;
  const lastLine = doc.lineAt(window.to).number;

  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    if (
      frontmatterClosingLine > 0 &&
      lineNumber > 1 &&
      lineNumber < frontmatterClosingLine
    ) {
      continue;
    }
    if (fencedLines.has(lineNumber)) {
      continue;
    }

    const line = doc.line(lineNumber);

    const hangChars = getMarkdownListHangPrefixCharCount(line.text);
    if (hangChars !== null && hangChars > 0) {
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: "cm-markdown-list-line-hang",
          attributes: {
            style: `padding-left: calc(var(--pane-content-px, 56px) + var(--mp-editor-list-hang-em-per-char, 0.34) * ${hangChars} * 1em); text-indent: calc(-1 * var(--mp-editor-list-hang-em-per-char, 0.34) * ${hangChars} * 1em)`,
          },
        }),
      );
    }

    const unorderedMatch = line.text.match(UNORDERED_LIST_REGEX);
    const orderedMatch = line.text.match(ORDERED_LIST_REGEX);
    const match = unorderedMatch ?? orderedMatch;

    if (!match) {
      continue;
    }

    const markerText = orderedMatch
      ? `${orderedMatch[2]}${orderedMatch[3]}`
      : unorderedMatch![2];
    const markerFrom = line.from + match[1].length;
    builder.add(
      markerFrom,
      markerFrom + markerText.length,
      Decoration.mark({ class: "cm-markdown-list-marker" }),
    );
  }

  return builder.finish();
}

export const markdownListDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    private readonly window = new ViewportDecorationWindow();
    private fencedDoc: Text | null = null;
    private fencedLines: ReadonlySet<number> = new Set();

    private build(view: EditorView): DecorationSet {
      if (view.visibleRanges.length === 0) return Decoration.none;
      // Text 不可变；仅文本变更时更新围栏归属，滚动和后台语法推进复用当前结果。
      if (this.fencedDoc !== view.state.doc) {
        this.fencedDoc = view.state.doc;
        this.fencedLines = buildFencedLineSet(view.state.doc);
      }
      return buildMarkdownListDecorations(view, this.fencedLines);
    }

    constructor(view: EditorView) {
      this.decorations = this.build(view);
      this.window.mark(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        (update.viewportChanged && this.window.needsUpdate(update.view))
      ) {
        this.decorations = this.build(update.view);
        this.window.mark(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
