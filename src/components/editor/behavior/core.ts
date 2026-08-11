/**
 * Markdown Behavior - Core Utilities
 * Base types, constants, and helper functions
 */

import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import { indentUnit as indentUnitFacet } from "@codemirror/language";
import type { OrderedListMode } from "../../../types";

// ==================== 常量定义 ====================

// 默认缩进单位：4 空格
export const LIST_INDENT_UNIT = "    ";
export const LIST_INDENT_SIZE = 4;

// 保持向后兼容的正则导出
export const UNORDERED_LIST_REGEX = /^([ \t]*)([-+*]) (.*)$/;
// 有序：标准 `1. 正文`；另支持 `2.AIGC`（点号后无空格）；`1.2` 等数字开头仍视为非列表，避免版本号误判
export const ORDERED_LIST_REGEX =
  /^([ \t]*)(\d+|[a-z]|[ivxlcdm]+)([.)])(?:\s+(.*)|([A-Za-z\u4e00-\u9fff].*)|())$/i;
export const TASK_LIST_REGEX = /^([ \t]*)([-+*]) (\[[ xX]\])(?: (.*)|$)$/;
export const BLOCKQUOTE_REGEX = /^([ \t]*)(>+(?:\s*>+)*\s*)(.*)$/;
export const HEADING_REGEX = /^([ \t]*)(#{1,6})( +)(.*)$/;
export const EMPTY_LINE_REGEX = /^[ \t]*$/;

/**
 * 列表行正文起点之前的字符数（用于软换行悬挂缩进，配合 padding-left + 负 text-indent）。
 * 非列表、或无法解析时返回 null。Tab 计为 1 字符；悬挂缩进在编辑器侧按字符数 × em 系数换算。
 */
export function getMarkdownListHangPrefixCharCount(
  lineText: string,
): number | null {
  const task = lineText.match(TASK_LIST_REGEX);
  if (task) {
    const rest = task[4] ?? "";
    return Math.max(0, lineText.length - rest.length);
  }
  const ordered = lineText.match(ORDERED_LIST_REGEX);
  if (ordered) {
    const rest = ordered[4] ?? ordered[5] ?? ordered[6] ?? "";
    return Math.max(0, lineText.length - rest.length);
  }
  const unordered = lineText.match(UNORDERED_LIST_REGEX);
  if (unordered) {
    const rest = unordered[3] ?? "";
    return Math.max(0, lineText.length - rest.length);
  }
  return null;
}

// ==================== 缩进单位工具 ====================

/**
 * 获取统一缩进单位（优先读取 CodeMirror indentUnit facet）。
 * 未配置 indentUnit 时，CodeMirror 默认是 2 空格且 tabSize 为 4；
 * 此时回退到历史列表缩进（4 空格），避免测试/裸 EditorState 行为漂移。
 */
export function getIndentUnit(state: EditorState): string {
  const unit = state.facet(indentUnitFacet);
  if (unit === "\t") return "\t";
  if (unit === LIST_INDENT_UNIT) return unit;
  if (unit === "  " && state.tabSize !== 2) {
    return LIST_INDENT_UNIT;
  }
  return unit || LIST_INDENT_UNIT;
}

/**
 * 获取缩进宽度（列数）
 * 将制表符和空格统一转换为列数
 */
export function getIndentColumnWidth(
  indent: string,
  tabSize: number = LIST_INDENT_SIZE,
): number {
  let width = 0;
  for (const char of indent) {
    width += char === "\t" ? tabSize : 1;
  }
  return width;
}

/**
 * 根据层级生成缩进
 */
export function getIndentFromLevel(
  level: number,
  tabSize: number = LIST_INDENT_SIZE,
): string {
  return " ".repeat(tabSize * level);
}

/**
 * 从缩进计算层级
 */
export function getLevelFromIndent(
  indent: string,
  tabSize: number = LIST_INDENT_SIZE,
): number {
  const spaces = getIndentColumnWidth(indent, tabSize);
  return Math.floor(spaces / tabSize);
}

// ==================== 类型定义 ====================

export interface LineDraft {
  from: number;
  lineNumber: number;
  newText: string;
  oldText: string;
}

export interface QuoteInfo {
  indent: string;
  depth: number;
  raw: string;
  spacedStyle: boolean;
  content: string;
}

// 保持向后兼容的 ListInfo 类型
export interface ListInfo {
  type: "unordered" | "ordered" | "task";
  indent: string;
  marker: string;
  content: string;
  number?: number;
  delimiter?: string;
  /** 有序列表标记样式（与 nestedListBehavior 一致） */
  markerStyle?:
    | "decimal"
    | "lower-alpha"
    | "upper-alpha"
    | "lower-roman"
    | "upper-roman";
  checkbox?: string;
}

export interface StructuredLine {
  text: string;
  quote: QuoteInfo | null;
  list: ListInfo | null;
  isBlank: boolean;
}

export type OrderedNormalizationMode = "selection" | "document";

// ==================== 基础工具函数 ====================

export function isBlankLine(lineText: string): boolean {
  return EMPTY_LINE_REGEX.test(lineText);
}

export function getLeadingIndent(lineText: string): string {
  return lineText.match(/^[ \t]*/)![0];
}

// 保持向后兼容的导出 - 使用默认缩进大小
export function addIndentUnit(
  indent: string,
  unit: string = LIST_INDENT_UNIT,
): string {
  return `${indent}${unit}`;
}

export function removeIndentUnit(
  indent: string,
  unit: string = LIST_INDENT_UNIT,
): string {
  if (indent.startsWith("\t")) {
    return indent.slice(1);
  }

  const unitLength = unit.length;
  const leadingSpaces = indent.match(/^ */)?.[0].length ?? 0;
  if (leadingSpaces > 0) {
    return indent.slice(Math.min(unitLength, leadingSpaces));
  }

  return indent;
}

// ==================== 代码块检测 ====================

function walkFenceStackForLines(
  state: EditorState,
  upToLineInclusive: number,
): Array<{ fenceChar: string; fenceLength: number }> {
  const stack: Array<{ fenceChar: string; fenceLength: number }> = [];

  for (let lineNumber = 1; lineNumber <= upToLineInclusive; lineNumber += 1) {
    const lineText = state.doc.line(lineNumber).text;
    const match = lineText.match(/^([ \t]*)(`{3,}|~{3,})(.*)$/);
    if (!match) continue;

    const fence = match[2];
    const fenceChar = fence[0];
    const fenceLength = fence.length;

    const top = stack[stack.length - 1];
    if (top && top.fenceChar === fenceChar && fenceLength >= top.fenceLength) {
      stack.pop();
    } else if (!top) {
      stack.push({ fenceChar, fenceLength });
    }
  }

  return stack;
}

export function isInsideFencedCode(
  state: EditorState,
  position: number,
): boolean {
  const currentLine = state.doc.lineAt(position).number;
  const stack = walkFenceStackForLines(state, currentLine);
  return stack.length > 0;
}

/** True when a fenced block is still open before the given line (lines above only). */
export function hasOpenFencedBlockBeforeLine(
  state: EditorState,
  lineNumber: number,
): boolean {
  if (lineNumber <= 1) {
    return false;
  }
  return walkFenceStackForLines(state, lineNumber - 1).length > 0;
}

export function getFrontmatterRange(
  state: EditorState,
): { from: number; to: number; closingLineNumber: number } | null {
  const { doc } = state;
  if (doc.lines === 0 || doc.line(1).text.trim() !== "---") {
    return null;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (line.text.trim() === "---") {
      return {
        from: doc.line(1).from,
        to: line.to,
        closingLineNumber: lineNumber,
      };
    }
  }

  return null;
}

export function isInsideFrontmatter(
  state: EditorState,
  position: number,
): boolean {
  const range = getFrontmatterRange(state);
  if (!range) {
    return false;
  }

  const lineNumber = state.doc.lineAt(position).number;
  return lineNumber > 1 && lineNumber < range.closingLineNumber;
}

/** True for any position in the YAML block, including the opening/closing `---` lines. */
export function isWithinFrontmatterBlock(
  state: EditorState,
  position: number,
): boolean {
  const range = getFrontmatterRange(state);
  if (!range) {
    return false;
  }
  return position >= range.from && position <= range.to;
}

// ==================== 列映射工具 ====================

export function mapColumnAfterLineUpdate(
  oldText: string,
  newText: string,
  column: number,
): number {
  // 列表行：按正文相对位置映射，避免 Tab/缩进后光标停在列表符前
  const oldListStart = getMarkdownListHangPrefixCharCount(oldText);
  const newListStart = getMarkdownListHangPrefixCharCount(newText);
  if (oldListStart !== null && newListStart !== null) {
    if (column <= oldListStart) {
      return Math.min(newText.length, newListStart);
    }
    return Math.min(newText.length, newListStart + (column - oldListStart));
  }

  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) {
    prefix += 1;
  }

  if (column <= prefix) {
    return column;
  }

  let suffix = 0;
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChangedEnd = oldText.length - suffix;
  const newChangedEnd = newText.length - suffix;

  if (column >= oldChangedEnd) {
    return newChangedEnd + (column - oldChangedEnd);
  }

  return newChangedEnd;
}

// ==================== 行选择工具 ====================

export function getSelectedLineNumbers(state: EditorState): number[] {
  const lineNumbers = new Set<number>();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endPosition = range.empty
      ? range.to
      : Math.max(range.from, range.to - 1);
    const endLine = state.doc.lineAt(endPosition).number;

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      lineNumbers.add(lineNumber);
    }
  }

  return Array.from(lineNumbers).sort((a, b) => a - b);
}

// ==================== 行更新工具 ====================

export function updateSelectedLines(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  transformLine: (
    lineText: string,
    meta: { lineNumber: number; index: number; total: number },
  ) => string,
  options?: { normalizeOrderedNumbers?: OrderedNormalizationMode },
): boolean {
  const selectedLineNumbers = getSelectedLineNumbers(state);
  const drafts = new Map<number, LineDraft>();

  selectedLineNumbers.forEach((lineNumber, index) => {
    const line = state.doc.line(lineNumber);
    drafts.set(lineNumber, {
      from: line.from,
      lineNumber,
      oldText: line.text,
      newText: transformLine(line.text, {
        lineNumber,
        index,
        total: selectedLineNumbers.length,
      }),
    });
  });

  if (options?.normalizeOrderedNumbers) {
    normalizeOrderedDrafts(
      state,
      drafts,
      selectedLineNumbers,
      options.normalizeOrderedNumbers,
    );
  }

  const changedDrafts = Array.from(drafts.values()).filter(
    (draft) => draft.newText !== draft.oldText,
  );
  if (!changedDrafts.length) {
    return false;
  }

  const changes = changedDrafts.map((draft) => ({
    from: draft.from,
    to: draft.from + draft.oldText.length,
    insert: draft.newText,
  }));

  const changeSet = state.changes(changes);
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) => {
      const mapPoint = (position: number, assoc: -1 | 1) => {
        const line = state.doc.lineAt(position);
        const draft = drafts.get(line.number);
        if (!draft) {
          return changeSet.mapPos(position, assoc);
        }

        const newLineFrom = changeSet.mapPos(draft.from, 1);
        const column = position - line.from;
        const nextColumn = Math.min(
          draft.newText.length,
          mapColumnAfterLineUpdate(draft.oldText, draft.newText, column),
        );
        return newLineFrom + nextColumn;
      };

      return EditorSelection.range(
        mapPoint(range.anchor, -1),
        mapPoint(range.head, 1),
      );
    }),
    state.selection.mainIndex,
  );

  dispatch(
    state.update({
      changes,
      selection,
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
}

export function replaceCurrentLine(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  newText: string,
  selectionColumn?: number,
): boolean {
  const line = state.doc.lineAt(state.selection.main.from);
  const oldText = line.text;
  const nextColumn =
    selectionColumn ??
    Math.min(
      newText.length,
      mapColumnAfterLineUpdate(
        oldText,
        newText,
        state.selection.main.from - line.from,
      ),
    );

  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: newText },
      selection: { anchor: line.from + nextColumn },
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
}

// ==================== 有序列表标准化 ====================

function getListDepth(structured: StructuredLine): number {
  if (!structured.list) return 0;
  return (
    (structured.quote?.depth ?? 0) * 1000 +
    getIndentColumnWidth(structured.list.indent)
  );
}

function getOrderedContextKey(structured: StructuredLine): string | null {
  if (structured.list?.type !== "ordered") {
    return null;
  }

  return [
    structured.quote?.depth ?? 0,
    structured.list.indent,
    structured.list.delimiter ?? ".",
  ].join("|");
}

function getPreviousOrderedNumber(
  state: EditorState,
  drafts: Map<number, LineDraft>,
  lineNumber: number,
  contextKey: string,
): number {
  let consecutiveBlankLines = 0;

  for (let current = lineNumber - 1; current >= 1; current -= 1) {
    const text = drafts.get(current)?.newText ?? state.doc.line(current).text;

    if (isBlankLine(text)) {
      consecutiveBlankLines++;
      // 两个连续空行才中断查找
      if (consecutiveBlankLines >= 2) {
        break;
      }
      continue;
    }

    consecutiveBlankLines = 0;

    const structured = parseStructuredLine(text);
    if (getOrderedContextKey(structured) !== contextKey) {
      continue;
    }

    return structured.list?.number ?? 0;
  }

  return 0;
}

function normalizeOrderedDrafts(
  state: EditorState,
  drafts: Map<number, LineDraft>,
  orderedLineNumbers: number[],
  mode: OrderedNormalizationMode,
): void {
  const counters = new Map<string, number>();

  for (const lineNumber of orderedLineNumbers) {
    const draft = drafts.get(lineNumber);
    if (!draft) continue;

    const structured = parseStructuredLine(draft.newText);
    const contextKey = getOrderedContextKey(structured);
    if (!contextKey) continue;

    let currentNumber = counters.get(contextKey);
    if (currentNumber == null) {
      currentNumber =
        mode === "selection"
          ? 0
          : getPreviousOrderedNumber(state, drafts, lineNumber, contextKey);
    }

    currentNumber += 1;
    counters.set(contextKey, currentNumber);
    draft.newText = replaceOrderedNumber(draft.newText, currentNumber);
  }
}

function replaceOrderedNumber(lineText: string, nextNumber: number): string {
  const structured = parseStructuredLine(lineText);
  if (structured.list?.type !== "ordered") {
    return lineText;
  }

  return formatListLine(structured.quote, structured.list, {
    number: nextNumber,
  });
}

// ==================== 行内格式处理 ====================

export function unwrapInline(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
  before: string,
  after: string,
): boolean {
  const hasSelection = state.selection.ranges.some((range) => !range.empty);

  if (!hasSelection) {
    const changes = state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: `${before}${after}` },
      range: EditorSelection.cursor(range.from + before.length),
    }));
    dispatch(
      state.update(changes, { scrollIntoView: true, userEvent: "input" }),
    );
    return true;
  }

  const changes = state.changeByRange((range) => {
    const selectedText = state.doc.sliceString(range.from, range.to);
    const alreadyWrapped =
      selectedText.startsWith(before) && selectedText.endsWith(after);

    if (alreadyWrapped) {
      const unwrapped = selectedText.slice(
        before.length,
        selectedText.length - after.length,
      );
      return {
        changes: { from: range.from, to: range.to, insert: unwrapped },
        range: EditorSelection.range(range.from, range.from + unwrapped.length),
      };
    }

    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: EditorSelection.range(
        range.from + before.length,
        range.to + before.length,
      ),
    };
  });

  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

export function insertText(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  text: string,
): void {
  const range = view.state.selection.main;
  view.dispatch(
    view.state.update({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    }),
  );
}

// ==================== 引用解析（需要ListInfo） ====================

import { parseQuote, buildQuoteRaw, buildQuotePrefix } from "./quotes";

import { parseListLine, formatListLine } from "./lists";

export function parseStructuredLine(lineText: string): StructuredLine {
  const quote = parseQuote(lineText);
  const afterQuote = quote ? quote.content : lineText;

  return {
    text: lineText,
    quote,
    list: parseListLine(afterQuote),
    isBlank: isBlankLine(lineText),
  };
}

export function isEmptyListItem(structured: StructuredLine): boolean {
  return Boolean(structured.list && structured.list.content.trim() === "");
}

export function isEmptyQuoteLine(structured: StructuredLine): boolean {
  return Boolean(
    structured.quote &&
    structured.quote.content.trim() === "" &&
    !structured.list,
  );
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
