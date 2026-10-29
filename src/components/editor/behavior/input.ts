/**
 * Markdown Behavior - Input Handling
 * Enter, Backspace, Tab, Shift-Tab, Paste
 */

import { indentLess, insertNewlineAndIndent } from "@codemirror/commands";
import { insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { EditorSelection, type StateCommand } from "@codemirror/state";
import type { OrderedListMode } from "../../../types";
import {
  isInsideFencedCode,
  isInsideFrontmatter,
  replaceCurrentLine,
  parseStructuredLine,
  isEmptyListItem,
  isEmptyQuoteLine,
  insertText,
  looksLikeUrl,
  getIndentUnit,
  updateSelectedLines,
  getLeadingIndent,
  removeIndentUnit,
} from "./core";
import { buildQuotePrefix, buildQuoteRaw } from "./quotes";
import {
  parseListItem,
  formatOrderedMarkerValue,
  calculateOrderedListNumbers,
  getOrderedListParentForContinuation,
  isLaterLineOfMarkdownListItem,
} from "./nestedListBehavior";
import {
  handleListEnter,
  handleOrderedListContinuationEnter,
  handleListBackspace,
  createHandleListBackspace,
  handleListTab,
  handleListShiftTab,
} from "./nestedListCommands";
import type { EditorView } from "@codemirror/view";
import {
  handleTableEnter,
  handleTableShiftTab,
  handleTableTab,
  isInMarkdownTable,
} from "./tables";

function handleFrontmatterEnter({
  state,
  dispatch,
}: Parameters<StateCommand>[0]): boolean {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.from);
  const text = line.text;

  const yamlListMatch = text.match(/^(\s*)-\s*(.*)$/);
  if (yamlListMatch && main.from === line.to) {
    const [, indent, content] = yamlListMatch;
    const nextIndent = `${indent}- `;
    const insert = content.trim() === "" ? "\n" : `\n${nextIndent}`;
    const cursorOffset = insert === "\n" ? 1 : insert.length;

    dispatch(
      state.update({
        changes: { from: main.from, insert },
        selection: { anchor: main.from + cursorOffset },
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  const yamlKeyMatch = text.match(/^(\s*[^:#\n][^:\n]*):\s*$/);
  if (yamlKeyMatch && main.from === line.to) {
    const [, keyPrefix] = yamlKeyMatch;
    const insert = `\n${getLeadingIndent(keyPrefix)}${getIndentUnit(state)}`;
    dispatch(
      state.update({
        changes: { from: main.from, insert },
        selection: { anchor: main.from + insert.length },
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  return insertNewlineAndIndent({ state, dispatch });
}

// ==================== 智能 Enter 处理 ====================

export const handleSmartEnter: StateCommand = ({
  state,
  dispatch,
}): boolean => {
  const main = state.selection.main;

  // 有选区时使用默认行为
  if (!main.empty) {
    return insertNewlineContinueMarkupCommand({ nonTightLists: false })({
      state,
      dispatch,
    });
  }

  // 代码块内使用默认行为
  if (isInsideFencedCode(state, main.from)) {
    const quote = parseStructuredLine(state.doc.lineAt(main.from).text).quote;
    if (quote) {
      const insert = `\n${quote.indent}${quote.raw}`;
      dispatch(
        state.update({
          changes: { from: main.from, insert },
          selection: { anchor: main.from + insert.length },
          scrollIntoView: true,
          userEvent: "input",
        }),
      );
      return true;
    }
    return insertNewlineAndIndent({ state, dispatch });
  }

  if (isInsideFrontmatter(state, main.from)) {
    return handleFrontmatterEnter({ state, dispatch });
  }

  // GFM 表格：单元格内 Enter 也走表格逻辑（不必在行尾）
  if (isInMarkdownTable(state, main.from)) {
    return handleTableEnter({ state, dispatch });
  }

  const line = state.doc.lineAt(main.from);

  // 光标不在行尾时使用默认行为
  if (main.from !== line.to) {
    return insertNewlineContinueMarkupCommand({ nonTightLists: false })({
      state,
      dispatch,
    });
  }

  const structured = parseStructuredLine(line.text);

  // 使用新的列表处理逻辑
  if (structured.list) {
    // 检查是否使用新的多级列表处理
    const item = parseListItem(line.text, line.number, line.from);
    if (item) {
      return (
        handleListEnter({ state, dispatch } as Parameters<StateCommand>[0]) ??
        false
      );
    }
  }

  if (handleOrderedListContinuationEnter({ state, dispatch })) {
    return true;
  }

  // 引用块处理
  if (structured.quote) {
    if (isEmptyQuoteLine(structured)) {
      const replacement =
        structured.quote.depth > 1
          ? `${structured.quote.indent}${buildQuoteRaw(structured.quote.depth - 1, structured.quote.spacedStyle)}`
          : structured.quote.indent;
      return replaceCurrentLine(
        state,
        dispatch,
        replacement,
        replacement.length,
      );
    }

    const continuation = `${buildQuotePrefix(structured.quote)}`;
    dispatch(
      state.update({
        changes: { from: main.from, insert: `\n${continuation}` },
        selection: { anchor: main.from + continuation.length + 1 },
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  // 标题处理
  const headingMatch = line.text.match(/^([ \t]*)(#{1,6})( +)(.*)$/);
  if (headingMatch) {
    dispatch(
      state.update({
        changes: { from: main.from, insert: "\n" },
        selection: { anchor: main.from + 1 },
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  // 无序列表等：同一 ListItem 多行正文时，lang-markdown 会把 marker 列偏移误用到当前行，
  // 误判「空列表项」并删掉延续段文字；有序段已由 handleOrderedListContinuationEnter 处理。
  if (
    isLaterLineOfMarkdownListItem(state, line.number) &&
    !getOrderedListParentForContinuation(state, line.number)
  ) {
    return insertNewlineAndIndent({ state, dispatch });
  }

  return insertNewlineContinueMarkupCommand({ nonTightLists: false })({
    state,
    dispatch,
  });
};

// ==================== 智能 Backspace 处理 ====================

export const handleSmartBackspace: StateCommand = ({
  state,
  dispatch,
}): boolean => {
  return createHandleSmartBackspace("strict")({ state, dispatch });
};

export function createHandleSmartBackspace(
  orderedListMode: OrderedListMode,
): StateCommand {
  return ({ state, dispatch }): boolean => {
    const main = state.selection.main;
    if (!main.empty || isInsideFencedCode(state, main.from)) {
      return false;
    }

    if (isInsideFrontmatter(state, main.from)) {
      return false;
    }

    const line = state.doc.lineAt(main.from);
    const structured = parseStructuredLine(line.text);

    if (structured.list) {
      const item = parseListItem(line.text, line.number, line.from);
      if (item) {
        const cmd = createHandleListBackspace({
          strictMode: orderedListMode === "strict",
        });
        return cmd({ state, dispatch }) ?? false;
      }
    }

    if (structured.quote) {
      const markerBoundary =
        line.from + buildQuotePrefix(structured.quote).length;

      if (main.from === markerBoundary) {
        const nextText =
          structured.quote.depth > 1
            ? `${structured.quote.indent}${buildQuoteRaw(structured.quote.depth - 1, structured.quote.spacedStyle)}${structured.quote.content}`
            : `${structured.quote.indent}${structured.quote.content}`;
        return replaceCurrentLine(
          state,
          dispatch,
          nextText,
          nextText.length - structured.quote.content.length,
        );
      }
    }

    return false;
  };
}

// ==================== Tab / Shift-Tab 处理 ====================

export const handleSmartTab: StateCommand = ({ state, dispatch }): boolean => {
  return createHandleSmartTab("strict")({ state, dispatch });
};

export function createHandleSmartTab(
  orderedListMode: OrderedListMode,
): StateCommand {
  return ({ state, dispatch }): boolean => {
    const hasExpandedSelection = state.selection.ranges.some(
      (range) => !range.empty,
    );
    const line = state.doc.lineAt(state.selection.main.from);
    const structured = parseStructuredLine(line.text);
    const insideFencedCode = isInsideFencedCode(
      state,
      state.selection.main.from,
    );
    const insideFrontmatter = isInsideFrontmatter(
      state,
      state.selection.main.from,
    );

    const indent = getIndentUnit(state);

    // 代码块内处理
    if (insideFencedCode) {
      if (hasExpandedSelection) {
        return updateSelectedLines(
          state,
          dispatch,
          (lineText) => `${indent}${lineText}`,
        );
      }

      const changes = state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: indent },
        range: EditorSelection.cursor(range.from + indent.length),
      }));

      dispatch(
        state.update(changes, { scrollIntoView: true, userEvent: "input" }),
      );
      return true;
    }

    if (insideFrontmatter) {
      if (hasExpandedSelection) {
        return updateSelectedLines(
          state,
          dispatch,
          (lineText) => `${indent}${lineText}`,
        );
      }

      const changes = state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: indent },
        range: EditorSelection.cursor(range.from + indent.length),
      }));

      dispatch(
        state.update(changes, { scrollIntoView: true, userEvent: "input" }),
      );
      return true;
    }

    // GFM 表格：优先单元格导航
    if (
      !hasExpandedSelection &&
      isInMarkdownTable(state, state.selection.main.from)
    ) {
      return handleTableTab({ state, dispatch });
    }

    // 列表处理 - 使用新逻辑
    if (structured.list) {
      const cmd = handleListTab({ strictMode: orderedListMode === "strict" });
      return cmd({ state, dispatch }) ?? false;
    }

    // 普通文本：有选区时按行首缩进，避免整段替换为一段空格
    if (hasExpandedSelection) {
      return updateSelectedLines(
        state,
        dispatch,
        (lineText) => `${indent}${lineText}`,
      );
    }

    const changes = state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: indent },
      range: EditorSelection.cursor(range.from + indent.length),
    }));

    dispatch(
      state.update(changes, { scrollIntoView: true, userEvent: "input" }),
    );
    return true;
  };
}

export const handleSmartShiftTab: StateCommand = ({
  state,
  dispatch,
}): boolean => {
  return createHandleSmartShiftTab("strict")({ state, dispatch });
};

export function createHandleSmartShiftTab(
  orderedListMode: OrderedListMode,
): StateCommand {
  return ({ state, dispatch }): boolean => {
    const line = state.doc.lineAt(state.selection.main.from);
    const structured = parseStructuredLine(line.text);
    const insideFencedCode = isInsideFencedCode(
      state,
      state.selection.main.from,
    );
    const insideFrontmatter = isInsideFrontmatter(
      state,
      state.selection.main.from,
    );

    // 代码块内处理
    if (insideFencedCode) {
      const handled = updateSelectedLines(state, dispatch, (lineText) => {
        const indent = getLeadingIndent(lineText);
        return `${removeIndentUnit(indent, getIndentUnit(state))}${lineText.slice(indent.length)}`;
      });

      return handled || indentLess({ state, dispatch });
    }

    if (insideFrontmatter) {
      return updateSelectedLines(state, dispatch, (lineText) => {
        const indent = getLeadingIndent(lineText);
        return `${removeIndentUnit(indent, getIndentUnit(state))}${lineText.slice(indent.length)}`;
      });
    }

    // GFM 表格：优先单元格导航
    if (
      state.selection.main.empty &&
      isInMarkdownTable(state, state.selection.main.from)
    ) {
      return handleTableShiftTab({ state, dispatch });
    }

    // 列表处理 - 使用新逻辑
    if (structured.list) {
      const cmd = handleListShiftTab({
        strictMode: orderedListMode === "strict",
      });
      return cmd({ state, dispatch }) ?? false;
    }

    // 普通文本
    const handled = updateSelectedLines(state, dispatch, (lineText) => {
      const indent = getLeadingIndent(lineText);
      return `${removeIndentUnit(indent, getIndentUnit(state))}${lineText.slice(indent.length)}`;
    });

    return handled || indentLess({ state, dispatch });
  };
}

// ==================== 粘贴处理 ====================

function escapeMarkdownUrl(url: string): string {
  // 括号目标使用尖括号形式，阅读解析器与实时预览的目标收集器都能完整读取。
  return /[()]/.test(url)
    ? `<${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>`
    : url;
}

export function handleStructuredPaste(
  view: EditorView,
  event: ClipboardEvent,
): boolean {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) {
    return false;
  }

  const normalized = text.replace(/\r\n?/g, "\n");
  const state = view.state;
  const selection = state.selection.main;

  // 仅粘贴 URL、无选区 → [](url)，光标在 [] 之间以便填写链接文字
  if (selection.empty && looksLikeUrl(normalized)) {
    if (
      isInsideFencedCode(state, selection.from) ||
      isInsideFrontmatter(state, selection.from)
    ) {
      return false;
    }
    event.preventDefault();
    const url = escapeMarkdownUrl(normalized.trim());
    view.dispatch(
      state.update({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: `[](${url})`,
        },
        selection: EditorSelection.cursor(selection.from + 1),
        scrollIntoView: true,
        userEvent: "input.paste",
      }),
    );
    return true;
  }

  // 有选区且粘贴内容为 URL → [选区文本](url)
  if (!selection.empty && looksLikeUrl(normalized)) {
    if (
      isInsideFencedCode(state, selection.from) ||
      isInsideFrontmatter(state, selection.from)
    ) {
      return false;
    }
    const selectedText = state.doc.sliceString(selection.from, selection.to);
    event.preventDefault();
    insertText(
      view,
      `[${selectedText}](${escapeMarkdownUrl(normalized.trim())})`,
    );
    return true;
  }

  // 单行或代码块内不处理
  if (!normalized.includes("\n") || isInsideFencedCode(state, selection.from)) {
    return false;
  }

  const line = state.doc.lineAt(selection.from);
  const item = parseListItem(line.text, line.number, line.from);
  if (!item) {
    return false;
  }

  const lines = normalized.split("\n");
  if (lines.length <= 1) {
    return false;
  }

  const correctNumbers = calculateOrderedListNumbers(state);
  const baseNumber = correctNumbers.get(line.number) ?? item.number ?? 1;

  // 构建续行前缀
  const buildContinuation = (index: number): string => {
    const quotePrefix = item.quotePrefix ?? "";
    if (item.type === "ordered") {
      const n = baseNumber + index;
      const seg = formatOrderedMarkerValue(
        n,
        item.markerStyle ?? "decimal",
        item.delimiter ?? ".",
      );
      return `${quotePrefix}${item.indent}${seg} `;
    }

    if (item.type === "task") {
      const checkbox = item.checkbox ?? "[ ]";
      return `${quotePrefix}${item.indent}${item.marker} ${checkbox} `;
    }

    return `${quotePrefix}${item.indent}${item.marker} `;
  };

  const insert = lines
    .map((segment, index) =>
      index === 0 ? segment : `${buildContinuation(index)}${segment}`,
    )
    .join("\n");

  event.preventDefault();
  insertText(view, insert);
  return true;
}
