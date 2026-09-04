/**
 * 多级列表行为处理模块
 *
 * 设计原则：
 * 1. 层级由缩进决定，普通缩进单位为 4 空格
 * 2. 有序列表编号按层级独立计算
 * 3. Tab/Shift-Tab 调整缩进并重新计算编号
 * 4. Enter 续写保持当前层级
 * 5. 严格模式：自动修复整个文档的编号连续性
 *
 * 层级定义：
 * - Level 0: 无缩进 (column 0)
 * - Level 1: 4 空格 (column 4)
 * - Level 2: 8 空格 (column 8)
 * ...以此类推
 */

import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { markdownLanguage } from "@codemirror/lang-markdown";
import {
  EditorState,
  type ChangeSpec,
  type Transaction,
} from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import {
  getIndentColumnWidth as getIndentColumnWidthFromCore,
  getLevelFromIndent as getLevelFromIndentFromCore,
  getIndentFromLevel as getIndentFromLevelFromCore,
  ORDERED_LIST_REGEX,
  ORDERED_LIST_HEAD_REGEX,
  UNORDERED_LIST_REGEX,
  TASK_LIST_REGEX,
  BLOCKQUOTE_REGEX,
  isBlankLine as isBlankLineFromCore,
} from "./core";
import { formatRomanNumeral, parseRomanNumeral } from "./romanNumerals";

// Keep these as literals (not re-exports of core consts): this module
// participates in an import cycle with core, so a module-init re-export would
// capture `undefined` in the temporal dead zone.
export const LIST_INDENT_UNIT = "    ";
export const LIST_INDENT_SIZE = 4;

// 列表类型定义
export type ListType = "unordered" | "ordered" | "task";

/** 有序列表标记在源码中的「样式」，用于续行/重编号时与同级已有项一致 */
export type OrderedListMarkerStyle =
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman";

export interface ListItemInfo {
  type: ListType;
  level: number; // 层级 (0, 1, 2, ...)
  quotePrefix: string; // 引用前缀（含缩进与 > 标记），如 "> " 或 ""（非引用）
  indent: string; // 前导空格
  marker: string; // -, *, +, 1., 2), 等
  content: string; // 内容部分
  number?: number; // 有序列表编号
  delimiter?: string; // . 或 )
  /** 仅 ordered：与源码标记样式一致，供 formatListItem / 重编号输出 */
  markerStyle?: OrderedListMarkerStyle;
  checkbox?: string; // [ ], [x], [X]
  lineNumber: number; // 行号
  startPos: number; // 行起始位置
}

export interface ListContext {
  parentLevel: number; // 父级层级
  listType: ListType; // 列表类型
  startNumber: number; // 起始编号
}

/**
 * 计算缩进对应的层级
 * 优先使用 core.ts 的实现以保持一致性
 */
export function getLevelFromIndent(
  indent: string,
  tabSize: number = LIST_INDENT_SIZE,
): number {
  return getLevelFromIndentFromCore(indent, tabSize);
}

/**
 * 根据层级生成缩进
 * 优先使用 core.ts 的实现以保持一致性
 */
export function getIndentFromLevel(
  level: number,
  tabSize: number = LIST_INDENT_SIZE,
): string {
  return getIndentFromLevelFromCore(level, tabSize);
}

export function getIndentColumnWidth(
  indent: string,
  tabSize: number = LIST_INDENT_SIZE,
): number {
  return getIndentColumnWidthFromCore(indent, tabSize);
}

/**
 * 解析有序列表标记（支持阿拉伯数字、字母、罗马数字）
 * 返回解析出的序号值和分隔符
 */
function parseOrderedListMarker(
  markerText: string,
): { value: number; delimiter: string } | null {
  // 阿拉伯数字: 1., 2), etc.
  const arabicMatch = markerText.match(/^(\d+)([.)])$/);
  if (arabicMatch) {
    return { value: parseInt(arabicMatch[1], 10), delimiter: arabicMatch[2] };
  }

  // 罗马数字: i., ii), iv., etc.（须在单字符字母之前，否则 i. 会被误判为第 9 项）
  const romanMatch = markerText.match(/^([ivxlcdm]+)([.)])$/i);
  if (romanMatch) {
    const romanValue = parseRomanNumeral(romanMatch[1]);
    if (romanValue > 0) {
      return { value: romanValue, delimiter: romanMatch[2] };
    }
  }

  // 小写字母: a., b), etc. (a=1, b=2, ...)
  const lowerAlphaMatch = markerText.match(/^([a-z])([.)])$/i);
  if (lowerAlphaMatch) {
    const charCode = lowerAlphaMatch[1].toLowerCase().charCodeAt(0) - 96; // 'a' = 97, so 97-96=1
    if (charCode >= 1 && charCode <= 26) {
      return { value: charCode, delimiter: lowerAlphaMatch[2] };
    }
  }

  return null;
}

/**
 * 解析罗马数字字符串为数值
 */
function inferOrderedMarkerStyleFromRawPart(
  markerPart: string,
): OrderedListMarkerStyle {
  if (/^\d+$/.test(markerPart)) {
    return "decimal";
  }
  if (
    /^[ivxlcdm]{2,}$/i.test(markerPart) &&
    parseRomanNumeral(markerPart) > 0
  ) {
    return markerPart === markerPart.toUpperCase() &&
      markerPart.toLowerCase() !== markerPart
      ? "upper-roman"
      : "lower-roman";
  }
  if (/^[a-zA-Z]$/.test(markerPart)) {
    return markerPart === markerPart.toUpperCase() &&
      markerPart !== markerPart.toLowerCase()
      ? "upper-alpha"
      : "lower-alpha";
  }
  return "decimal";
}

/** 将有序序号按样式格式化为「数字/字母/罗马 + 分隔符」 */
export function formatOrderedMarkerValue(
  value: number,
  style: OrderedListMarkerStyle,
  delimiter: string,
): string {
  let body: string;
  switch (style) {
    case "lower-alpha":
      body =
        value >= 1 && value <= 26
          ? String.fromCharCode(96 + value)
          : String(value);
      break;
    case "upper-alpha":
      body =
        value >= 1 && value <= 26
          ? String.fromCharCode(64 + value)
          : String(value);
      break;
    case "lower-roman":
      body = formatRomanNumeral(value, false);
      break;
    case "upper-roman":
      body = formatRomanNumeral(value, true);
      break;
    default:
      body = String(value);
  }
  return `${body}${delimiter}`;
}

function extractOrderedMarkerRawPartFromLineText(
  lineText: string,
): string | null {
  let text = lineText;
  const quoteMatch = text.match(BLOCKQUOTE_REGEX);
  if (quoteMatch) {
    text = quoteMatch[3];
  }
  const ORDERED_HEAD = ORDERED_LIST_REGEX;
  const m = text.match(ORDERED_HEAD);
  return m ? m[2] : null;
}

/**
 * 解析单行列表项
 * 使用与 behavior/core.ts 一致的正则表达式
 * 扩展支持字母和罗马数字的有序列表
 */
export function parseListItem(
  lineText: string,
  lineNumber: number,
  startPos: number,
): ListItemInfo | null {
  // 支持引用块内列表："> - item" / "> 1. item"
  // 复用 core.ts 导出的 BLOCKQUOTE_REGEX，避免两处漂移。
  let quotePrefix = "";
  let text = lineText;
  const quoteMatch = text.match(BLOCKQUOTE_REGEX);
  if (quoteMatch) {
    const [, indent, raw, rest] = quoteMatch;
    quotePrefix = `${indent}${raw}`;
    text = rest;
  }
  quotePrefix = quotePrefix || "";

  // 与 behavior/core.ts 中导出的正则一致，避免两处漂移
  // 任务列表: - [ ] content 或 * [x] content
  const taskMatch = text.match(TASK_LIST_REGEX);
  if (taskMatch) {
    const [, indent, marker, checkbox, content = ""] = taskMatch;
    return {
      type: "task",
      level: getLevelFromIndent(indent),
      quotePrefix,
      indent,
      marker,
      content: content.trimStart(),
      checkbox,
      lineNumber,
      startPos,
    };
  }

  // 有序列表: 支持 1., a., i., I. 等格式；数值统一为序号的整数值，样式单独保留
  const orderedMatch = text.match(ORDERED_LIST_REGEX);
  if (orderedMatch) {
    const [, indent, markerPart, delimiter] = orderedMatch;
    const content = (
      orderedMatch[4] ??
      orderedMatch[5] ??
      orderedMatch[6] ??
      ""
    ).trimStart();
    const markerInfo = parseOrderedListMarker(`${markerPart}${delimiter}`);
    if (markerInfo) {
      const markerStyle = inferOrderedMarkerStyleFromRawPart(markerPart);
      const marker = formatOrderedMarkerValue(
        markerInfo.value,
        markerStyle,
        markerInfo.delimiter,
      );
      return {
        type: "ordered",
        level: getLevelFromIndent(indent),
        quotePrefix,
        indent,
        marker,
        content: content.trimStart(),
        number: markerInfo.value,
        delimiter: markerInfo.delimiter,
        markerStyle,
        lineNumber,
        startPos,
      };
    }
  }

  // 无序列表: - content 或 * content 或 + content
  const unorderedMatch = text.match(UNORDERED_LIST_REGEX);
  if (unorderedMatch) {
    const [, indent, marker, content] = unorderedMatch;
    return {
      type: "unordered",
      level: getLevelFromIndent(indent),
      quotePrefix,
      indent,
      marker,
      content: content.trimStart(),
      lineNumber,
      startPos,
    };
  }

  return null;
}

// 判断是否为空白行：复用 core.ts 实现，保持行为一致。
const isBlankLine = isBlankLineFromCore;

/**
 * 光标所在行是否为同一 Markdown ListItem 内「第一项之后的行」（懒延续 / 多段正文）。
 * 用于在前导无空格时仍能拦截默认 insertNewlineContinueMarkup（其对延续行会误判空项并删内容）。
 */
export function isLaterLineOfMarkdownListItem(
  state: EditorState,
  lineNumber: number,
): boolean {
  const line = state.doc.line(lineNumber);
  const pos = line.to;
  try {
    if (!markdownLanguage.isActiveAt(state, pos, -1)) return false;
  } catch {
    return false;
  }

  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "ListItem") {
      const itemFirstLine = state.doc.lineAt(node.from);
      return line.number > itemFirstLine.number;
    }
    node = node.parent;
  }
  return false;
}

/**
 * 计算父项续行段所需的最小缩进列宽（与 CommonMark 一致）。
 * = quotePrefix 长 + indent 列宽 + marker 文本宽 + 1（marker 后的空格）
 */
function getContinuationMinIndent(item: ListItemInfo): number {
  const quoteWidth = item.quotePrefix?.length ?? 0;
  const indentWidth = getIndentColumnWidth(item.indent);
  let markerWidth: number;
  if (item.type === "ordered") {
    const seg = formatOrderedMarkerValue(
      item.number ?? 1,
      item.markerStyle ?? "decimal",
      item.delimiter ?? ".",
    );
    markerWidth = seg.length;
  } else if (item.type === "task") {
    markerWidth = item.marker.length + 1 + (item.checkbox?.length ?? 3);
  } else {
    markerWidth = item.marker.length;
  }
  return quoteWidth + indentWidth + markerWidth + 1;
}

/**
 * 当前行是否为「列表下的懒延续」：非列表行、有前导缩进，且向上能找到有序列表项，
 * 中间未遇到顶格非列表正文（否则会打断列表）。
 *
 * 收紧：当当前行使用 ASCII 缩进续行时，缩进列宽必须 ≥ 父项的内容起列
 * （quotePrefix + indent + marker + 1），否则视为段落不再当作续行段。
 * 这样能让编辑器对 Enter 的续写行为与 CommonMark 渲染一致。
 */
export function getOrderedListParentForContinuation(
  state: EditorState,
  lineNumber: number,
): ListItemInfo | null {
  const line = state.doc.line(lineNumber);
  if (isBlankLine(line.text)) return null;

  const selfItem = parseListItem(line.text, lineNumber, line.from);
  if (selfItem) return null;

  const firstNonWs = line.text.search(/\S/);
  const hasAsciiIndent = firstNonWs !== -1 && firstNonWs > 0;
  const needsTreeContinuation =
    !hasAsciiIndent && isLaterLineOfMarkdownListItem(state, lineNumber);

  if (!hasAsciiIndent && !needsTreeContinuation) return null;

  const currentLeading = line.text.match(/^[ \t]*/)?.[0] ?? "";
  const currentIndentWidth = getIndentColumnWidth(currentLeading);

  for (let i = lineNumber - 1; i >= 1; i--) {
    const pl = state.doc.line(i);
    if (isBlankLine(pl.text)) continue;

    const item = parseListItem(pl.text, i, pl.from);
    if (item) {
      if (item.type !== "ordered") return null;
      // 仅 ASCII 缩进路径校验最小缩进；needsTreeContinuation 路径已由 lang-markdown 语法树确认归属
      if (hasAsciiIndent && !needsTreeContinuation) {
        if (currentIndentWidth < getContinuationMinIndent(item)) {
          return null;
        }
      }
      return item;
    }

    const plLeading = pl.text.match(/^[ \t]*/)?.[0] ?? "";
    if (plLeading.length === 0) return null;
  }

  return null;
}

/**
 * 构建列表层级上下文
 * 分析文档中每个列表项的父级关系
 *
 * 注意：根据 CommonMark 规范，列表中的空行不应该中断列表
 * 只有当空行后的内容缩进不足以构成列表延续时才中断
 *
 * 实现说明：层级判定统一使用「缩进列宽（含 marker 内容起列约束）」，
 * 而不是按 4 空格量化的 item.level，避免 5/6 空格等非倍数缩进出现层级漂移。
 */
export function buildListHierarchy(
  doc: EditorState["doc"],
): Map<number, ListContext> {
  const hierarchy = new Map<number, ListContext>();
  const stack: Array<{ depth: number; type: ListType; lineNumber: number }> =
    [];
  let lastNonBlankLine = 0;
  let consecutiveBlankLines = 0;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const item = parseListItem(line.text, i, line.from);

    if (!item) {
      if (isBlankLine(line.text)) {
        consecutiveBlankLines++;
        // 两个连续空行才中断列表（段落分隔）
        if (consecutiveBlankLines >= 2) {
          stack.length = 0;
        }
      } else {
        // 非列表行且非空行，中断列表
        stack.length = 0;
        consecutiveBlankLines = 0;
      }
      continue;
    }

    // 是列表项
    consecutiveBlankLines = 0;
    lastNonBlankLine = i;

    const itemDepth = getIndentColumnWidth(item.indent);

    // 弹出所有「等深或更深」的项，剩下的栈顶才是真正的父级
    while (stack.length > 0 && stack[stack.length - 1].depth >= itemDepth) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    hierarchy.set(i, {
      parentLevel: parent ? Math.floor(parent.depth / LIST_INDENT_SIZE) : -1,
      listType: item.type,
      startNumber: 1,
    });

    stack.push({ depth: itemDepth, type: item.type, lineNumber: i });
  }

  return hierarchy;
}

/**
 * 计算有序列表的标准化编号
 * 严格模式：每个层级独立计数
 *
 * 行为约定：
 * - 两个连续空行：清空所有计数器（段落级断开）
 * - 单个空行 + 后续是「显式起始 marker」（number === 1）：仅重置该 key 的计数器，允许新分组
 * - 单个空行 + 后续 number !== 1：视为同组延续（兼容 CommonMark 的 lazy 续行）
 * - 缩进延续段（` continuation`）：不打断
 */
type ParentStackEntry = {
  lineNumber: number;
  type: ListType;
  indentWidth: number;
  continuationMinIndent: number;
};

function findParentKeyFromStack(
  stack: ParentStackEntry[],
  depth: number,
): string {
  if (depth === 0) return "root";
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.indentWidth >= depth) continue;
    if (entry.continuationMinIndent <= depth) {
      return `${entry.lineNumber}:${entry.type}`;
    }
  }
  return "root";
}

interface OrderedListNumberingResult {
  numbers: Map<number, number>;
  previousSiblingStyles: Map<number, OrderedListMarkerStyle | null>;
}

/**
 * 单遍计算有序编号与同组前一项 marker 样式。
 * 用各引用前缀下的缩进栈代替逐项回溯，避免 O(n²)。
 */
function computeOrderedListNumbering(
  state: EditorState,
): OrderedListNumberingResult {
  const numbers = new Map<number, number>();
  const previousSiblingStyles = new Map<
    number,
    OrderedListMarkerStyle | null
  >();
  const counters = new Map<string, number>(); // key: "quoteKey:parentKey:itemDepth"
  const counterDepths = new Map<string, number>();
  const lastStyleByKey = new Map<string, OrderedListMarkerStyle>();
  const parentStacks = new Map<string, ParentStackEntry[]>();
  let consecutiveBlankLines = 0;
  let pendingBlankReset = false;

  const clearCountersAtOrBelow = (minDepth: number) => {
    for (const [k, d] of [...counterDepths.entries()]) {
      if (d >= minDepth) {
        counters.delete(k);
        counterDepths.delete(k);
        lastStyleByKey.delete(k);
      }
    }
  };

  const clearAllCounters = () => {
    counters.clear();
    counterDepths.clear();
  };

  const getStack = (quoteKey: string): ParentStackEntry[] => {
    let stack = parentStacks.get(quoteKey);
    if (!stack) {
      stack = [];
      parentStacks.set(quoteKey, stack);
    }
    return stack;
  };

  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const item = parseListItem(line.text, i, line.from);

    if (item) {
      const itemDepth = getIndentColumnWidth(item.indent);
      const quoteKey = item.quotePrefix ?? "";
      const stack = getStack(quoteKey);
      while (
        stack.length > 0 &&
        stack[stack.length - 1].indentWidth >= itemDepth
      ) {
        stack.pop();
      }

      if (item.type === "ordered") {
        consecutiveBlankLines = 0;
        const parentKey = findParentKeyFromStack(stack, itemDepth);
        const key = `${quoteKey}:${parentKey}:${itemDepth}`;

        if (pendingBlankReset && item.number === 1) {
          counters.delete(key);
          counterDepths.delete(key);
        }
        pendingBlankReset = false;

        let current: number;
        const stored = counters.get(key);
        if (stored === undefined) {
          const isTopLevel = parentKey === "root";
          const seed = isTopLevel ? Math.max(1, item.number ?? 1) : 1;
          current = seed;
        } else {
          current = stored + 1;
        }
        counters.set(key, current);
        counterDepths.set(key, itemDepth);
        numbers.set(i, current);

        previousSiblingStyles.set(i, lastStyleByKey.get(key) ?? null);
        const raw = extractOrderedMarkerRawPartFromLineText(line.text);
        lastStyleByKey.set(
          key,
          raw
            ? inferOrderedMarkerStyleFromRawPart(raw)
            : (item.markerStyle ?? "decimal"),
        );
      } else {
        clearCountersAtOrBelow(itemDepth);
        consecutiveBlankLines = 0;
        pendingBlankReset = false;
      }

      stack.push({
        lineNumber: i,
        type: item.type,
        indentWidth: itemDepth,
        continuationMinIndent: getContinuationMinIndent(item),
      });
      continue;
    }

    if (isBlankLine(line.text)) {
      consecutiveBlankLines++;
      pendingBlankReset = true;
      if (consecutiveBlankLines >= 2) {
        clearAllCounters();
        pendingBlankReset = false;
      }
    } else if (getOrderedListParentForContinuation(state, i)) {
      consecutiveBlankLines = 0;
      pendingBlankReset = false;
    } else {
      clearAllCounters();
      lastStyleByKey.clear();
      consecutiveBlankLines = 0;
      pendingBlankReset = false;
    }
  }

  return { numbers, previousSiblingStyles };
}

export function calculateOrderedListNumbers(
  state: EditorState,
  _changes?: ChangeSpec[],
): Map<number, number> {
  return computeOrderedListNumbering(state).numbers;
}

/**
 * 查找父级计数器 key
 *
 * 仅当前一项的内容起列 ≤ 当前缩进列宽时，前一项才是有效父级（与 CommonMark 嵌套规则一致）。
 * 缩进虽然更浅但内容起列不够的项不能作为父级，会继续向上寻找。
 */
function findParentCounterKey(
  state: EditorState,
  lineNumber: number,
  depth: number,
  quotePrefix: string,
): string {
  if (depth === 0) return "root";
  for (let i = lineNumber - 1; i >= 1; i--) {
    const line = state.doc.line(i);
    const item = parseListItem(line.text, i, line.from);

    if (!item) {
      continue;
    }

    if ((item.quotePrefix ?? "") !== quotePrefix) {
      continue;
    }

    const itemIndentWidth = getIndentColumnWidth(item.indent);
    if (itemIndentWidth >= depth) {
      // 同级或更深，不是当前项的父级，继续向上寻找
      continue;
    }

    if (getContinuationMinIndent(item) <= depth) {
      return `${i}:${item.type}`;
    }
    // 更浅但内容起列不够：当前项不能算它的子项，继续向上找更外层潜在父级
  }
  return "root";
}

/** 与 calculateOrderedListNumbers 中计数器 key 一致，用于判断「同级同组」有序列表 */
export function orderedListCounterKey(
  state: EditorState,
  lineNumber: number,
): string | null {
  const line = state.doc.line(lineNumber);
  const item = parseListItem(line.text, lineNumber, line.from);
  if (!item || item.type !== "ordered") {
    return null;
  }
  const itemDepth = getIndentColumnWidth(item.indent);
  const quoteKey = item.quotePrefix ?? "";
  const parentKey = findParentCounterKey(
    state,
    lineNumber,
    itemDepth,
    quoteKey,
  );
  return `${quoteKey}:${parentKey}:${itemDepth}`;
}

/**
 * 获取严格模式下的标准化更改
 */
export function getStrictOrderedListNormalizationChanges(
  state: EditorState,
): ChangeSpec[] | null {
  const changes: ChangeSpec[] = [];
  const { numbers: correctNumbers, previousSiblingStyles } =
    computeOrderedListNumbering(state);

  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const item = parseListItem(line.text, i, line.from);

    if (!item || item.type !== "ordered") continue;

    const correctNumber = correctNumbers.get(i);
    if (correctNumber === undefined) continue;

    const markerColumn = (item.quotePrefix?.length ?? 0) + item.indent.length;
    const slice = line.text.slice(markerColumn);
    const headMatch = slice.match(ORDERED_LIST_HEAD_REGEX);
    if (!headMatch) continue;

    const style = previousSiblingStyles.get(i) ?? item.markerStyle ?? "decimal";
    const delim = item.delimiter ?? ".";
    const desired = formatOrderedMarkerValue(correctNumber, style, delim);
    const currentMarker = `${headMatch[1]}${headMatch[2]}`;
    if (currentMarker === desired) continue;

    const spacedContent = headMatch[3];
    const tightContent = headMatch[4];
    const emptyContent = headMatch[5];
    const markerSeparator =
      spacedContent !== undefined
        ? " "
        : tightContent !== undefined || emptyContent !== undefined
          ? ""
          : " ";
    const rest = spacedContent ?? tightContent ?? emptyContent ?? "";
    const newText = `${line.text.slice(0, markerColumn)}${desired}${markerSeparator}${rest}`;

    if (newText !== line.text) {
      changes.push({
        from: line.from,
        to: line.to,
        insert: newText,
      });
    }
  }

  return changes.length > 0 ? changes : null;
}

/**
 * 调整列表项层级（Tab/Shift-Tab）
 */
export function adjustListItemLevel(
  item: ListItemInfo,
  delta: number,
): ListItemInfo {
  const newLevel = Math.max(0, item.level + delta);
  return {
    ...item,
    level: newLevel,
    indent: getIndentFromLevel(newLevel),
    number: item.type === "ordered" ? 1 : item.number,
  };
}

/**
 * 格式化列表项为文本
 */
export function formatListItem(item: ListItemInfo): string {
  const indent = item.indent;
  // 确保内容没有前导空格，避免格式化后出现多余空格
  const content = item.content.trimStart();
  const quotePrefix = item.quotePrefix ?? "";

  if (item.type === "ordered") {
    const number = item.number ?? 1;
    const delimiter = item.delimiter ?? ".";
    const markerStyle = item.markerStyle ?? "decimal";
    const markerSeg = formatOrderedMarkerValue(number, markerStyle, delimiter);
    return `${quotePrefix}${indent}${markerSeg} ${content}`;
  }

  if (item.type === "task") {
    const checkbox = item.checkbox ?? "[ ]";
    return `${quotePrefix}${indent}${item.marker} ${checkbox} ${content}`;
  }

  return `${quotePrefix}${indent}${item.marker} ${content}`;
}

/**
 * 判断列表项是否为空（只有 marker 没有内容）
 */
export function isEmptyListItem(item: ListItemInfo): boolean {
  return item.content.trim() === "";
}

/**
 * 获取行的列表信息
 */
export function getListInfoAtLine(
  state: EditorState,
  lineNumber: number,
): ListItemInfo | null {
  const line = state.doc.line(lineNumber);
  return parseListItem(line.text, lineNumber, line.from);
}

/**
 * 获取选中行的所有列表项
 */
export function getSelectedListItems(state: EditorState): ListItemInfo[] {
  const items: ListItemInfo[] = [];
  const selectedLines = new Set<number>();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    // Fix: when selection is empty (cursor mode), use range.to directly
    // to avoid lineAt(range.to - 1) returning wrong line when cursor is at line boundary
    const endPosition = range.empty
      ? range.to
      : Math.max(range.from, range.to - 1);
    const endLine = state.doc.lineAt(endPosition).number;
    for (let i = startLine; i <= endLine; i++) {
      selectedLines.add(i);
    }
  }

  for (const lineNumber of Array.from(selectedLines)) {
    const item = getListInfoAtLine(state, lineNumber);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

/**
 * 查找同级上一个列表项
 * 参数 depth 为缩进列宽（getIndentColumnWidth 的返回值），同列宽视为同级，
 * 不再按 4 空格量化层级，避免 5/6 空格等非倍数缩进出现误判。
 */
export function findPreviousSiblingItem(
  state: EditorState,
  lineNumber: number,
  depth: number,
): ListItemInfo | null {
  for (let i = lineNumber - 1; i >= 1; i--) {
    const line = state.doc.line(i);
    if (isBlankLine(line.text)) continue;

    const item = parseListItem(line.text, i, line.from);
    if (!item) continue;

    const itemDepth = getIndentColumnWidth(item.indent);
    if (itemDepth === depth) {
      return item;
    }
    if (itemDepth < depth) {
      break; // 到达父级或更高级别
    }
  }
  return null;
}

/**
 * 查找同级下一个列表项
 * 参数 depth 同上，为缩进列宽。
 */
export function findNextSiblingItem(
  state: EditorState,
  lineNumber: number,
  depth: number,
): ListItemInfo | null {
  for (let i = lineNumber + 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (isBlankLine(line.text)) continue;

    const item = parseListItem(line.text, i, line.from);
    if (!item) continue;

    const itemDepth = getIndentColumnWidth(item.indent);
    if (itemDepth === depth) {
      return item;
    }
    if (itemDepth < depth) {
      break; // 到达父级或更高级别
    }
  }
  return null;
}

/**
 * 检查是否为列表的最后一项
 */
export function isLastListItem(
  state: EditorState,
  lineNumber: number,
): boolean {
  const item = getListInfoAtLine(state, lineNumber);
  if (!item) return false;

  const nextItem = findNextSiblingItem(
    state,
    lineNumber,
    getIndentColumnWidth(item.indent),
  );
  return nextItem === null;
}
