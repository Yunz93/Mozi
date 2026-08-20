/**
 * Line-start slash completions for inserting a Markdown table.
 *
 * `/` or `/表格` opens a size picker. `/3x4` / `/表格 3x4` inserts immediately.
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { useAppStore } from "../../../store/appStore";
import { t } from "../../../utils/i18n";
import { parseTableInsertSlashQuery } from "../../../utils/tableInsert";
import { isInsideFencedCode, isInsideFrontmatter } from "./core";
import { insertMarkdownTable, isInMarkdownTable } from "./tables";
import { openTableInsertPicker } from "./tableInsertPicker";

function slashLineMatch(
  context: CompletionContext,
): { from: number; query: string } | null {
  if (isInsideFrontmatter(context.state, context.pos)) return null;
  if (isInsideFencedCode(context.state, context.pos)) return null;
  if (isInMarkdownTable(context.state, context.pos)) return null;

  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const after = line.text.slice(context.pos - line.from);
  if (after.trim() !== "") return null;

  const match = before.match(/^(\s*)\/(.*)$/);
  if (!match) return null;

  return {
    from: line.from + match[1].length,
    query: match[2],
  };
}

function applySizedTable(
  visualRows: number,
  cols: number,
): Completion["apply"] {
  return (view, _completion, from, to) => {
    insertMarkdownTable(view.state, (tr) => view.dispatch(tr), {
      visualRows,
      cols,
      replaceFrom: from,
      replaceTo: to,
    });
  };
}

function applyTablePicker(): Completion["apply"] {
  return (view: EditorView, _completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
    });
    openTableInsertPicker(view);
  };
}

export function markdownSlashInsertCompletion(
  context: CompletionContext,
): CompletionResult | null {
  const match = slashLineMatch(context);
  if (!match) return null;

  const parsed = parseTableInsertSlashQuery(match.query);
  if (parsed.mode === "none") return null;

  const language = useAppStore.getState().settings.language;
  const options: Completion[] =
    parsed.mode === "sized"
      ? [
          {
            label: t(language, "table_insertSized", {
              rows: parsed.visualRows,
              cols: parsed.cols,
            }),
            detail: `${parsed.visualRows}×${parsed.cols}`,
            type: "function",
            boost: 99,
            apply: applySizedTable(parsed.visualRows, parsed.cols),
          },
        ]
      : [
          {
            label: t(language, "table_insert"),
            detail: t(language, "table_insertPickerHint"),
            type: "function",
            boost: 99,
            apply: applyTablePicker(),
          },
        ];

  return {
    from: match.from,
    to: context.pos,
    options,
    filter: false,
    validFor: /^\/[^\n]*$/,
  };
}
