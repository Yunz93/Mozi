/**
 * Markdown Behavior - Inline Formatting Commands
 * Bold, italic, code, links
 */

import { EditorSelection, type StateCommand } from "@codemirror/state";
import { unwrapInline, insertText } from "../core";

export const toggleBold: StateCommand = ({ state, dispatch }): boolean => {
  return unwrapInline(state, dispatch, "**", "**");
};

export const toggleItalic: StateCommand = ({ state, dispatch }): boolean => {
  return unwrapInline(state, dispatch, "*", "*");
};

export const toggleInlineCode: StateCommand = ({
  state,
  dispatch,
}): boolean => {
  if (state.selection.ranges.every((range) => range.empty)) {
    return unwrapInline(state, dispatch, "`", "`");
  }
  const changes = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    const prefix = state.doc.sliceString(0, range.from).match(/(`+)( ?)$/);
    const suffix = state.doc.sliceString(range.to).match(/^( ?)(`+)/);
    if (
      prefix &&
      suffix &&
      prefix[1] === suffix[2] &&
      prefix[2] === suffix[1]
    ) {
      const from = range.from - prefix[0].length;
      return {
        changes: [
          { from, to: range.from, insert: "" },
          { from: range.to, to: range.to + suffix[0].length, insert: "" },
        ],
        range: EditorSelection.range(from, from + text.length),
      };
    }
    const opening = text.match(/^`+/)?.[0];
    const closing = text.match(/`+$/)?.[0];
    const inner = opening ? text.slice(opening.length, -opening.length) : "";
    if (
      opening &&
      opening === closing &&
      inner.length > 0 &&
      !Array.from(inner.matchAll(/`+/g)).some(
        (run) => run[0].length === opening.length,
      )
    ) {
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }
    let longestRun = 0;
    for (const match of text.matchAll(/`+/g))
      longestRun = Math.max(longestRun, match[0].length);
    const fence = "`".repeat(longestRun + 1);
    // 反引号边界和两端空格需要额外垫片，防止 Markdown 吞掉原选区的字符。
    const padding =
      /^`|`$/.test(text) || (/^ .* $/.test(text) && text.trim()) ? " " : "";
    const insert = `${fence}${padding}${text}${padding}${fence}`;
    const from = range.from + fence.length + padding.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(from, from + text.length),
    };
  });
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export const insertLink: StateCommand = ({ state, dispatch }): boolean => {
  const hasSelection = state.selection.ranges.some((range) => !range.empty);

  if (!hasSelection) {
    const changes = state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: "[]()" },
      range: EditorSelection.cursor(range.from + 1),
    }));
    dispatch(
      state.update(changes, { scrollIntoView: true, userEvent: "input" }),
    );
    return true;
  }

  const changes = state.changeByRange((range) => {
    const selectedText = state.doc.sliceString(range.from, range.to);
    const insert = `[${selectedText}]()`;
    const urlStart = range.from + selectedText.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(urlStart),
    };
  });

  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export const insertCodeBlock: StateCommand = ({ state, dispatch }): boolean => {
  const changes = state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: "```\n\n```" },
    range: EditorSelection.cursor(range.from + 4),
  }));

  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};
