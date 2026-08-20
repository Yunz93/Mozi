/**
 * Line-start slash completions for Markdown inserts that are awkward to type.
 *
 * `/` lists table, callout, Mermaid, math, code, wiki embed, and footnote.
 * `/3x4` still inserts a sized table immediately.
 */

import {
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useAppStore } from "../../../store/appStore";
import { t } from "../../../utils/i18n";
import {
  buildFootnoteInsert,
  buildSlashInsertSnippet,
  resolveSlashInsert,
  type SlashInsertKind,
} from "../../../utils/slashInsert";
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

function applySnippet(
  kind: Exclude<SlashInsertKind, "table-picker" | "table-sized" | "footnote">,
  startFollowupCompletion = false,
): Completion["apply"] {
  return (view, _completion, from, to) => {
    const language = useAppStore.getState().settings.language;
    const snippet = buildSlashInsertSnippet(kind, language);
    const anchor = from + snippet.cursor;
    view.dispatch({
      changes: { from, to, insert: snippet.text },
      selection:
        snippet.select > 0
          ? EditorSelection.range(anchor, anchor + snippet.select)
          : EditorSelection.cursor(anchor),
      scrollIntoView: true,
      userEvent: "input",
    });
    if (startFollowupCompletion) {
      requestAnimationFrame(() => startCompletion(view));
    }
  };
}

function applyFootnote(): Completion["apply"] {
  return (view, _completion, from, to) => {
    const doc = view.state.doc.toString();
    const insert = buildFootnoteInsert(doc, from, to);
    const cursor =
      insert.definitionInsertFrom -
      (to - from) +
      insert.ref.length +
      insert.definition.length;
    view.dispatch({
      changes: [
        { from, to, insert: insert.ref },
        { from: insert.definitionInsertFrom, insert: insert.definition },
      ],
      selection: { anchor: cursor },
      scrollIntoView: true,
      userEvent: "input",
    });
  };
}

export function markdownSlashInsertCompletion(
  context: CompletionContext,
): CompletionResult | null {
  const match = slashLineMatch(context);
  if (!match) return null;

  const parsed = resolveSlashInsert(match.query);
  if (parsed.length === 0) return null;

  const language = useAppStore.getState().settings.language;
  const options: Completion[] = parsed.map((item, index) => {
    const boost = 99 - index;
    if (item.id === "table-sized" && item.tableSize) {
      return {
        label: t(language, "table_insertSized", {
          rows: item.tableSize.visualRows,
          cols: item.tableSize.cols,
        }),
        detail: `${item.tableSize.visualRows}×${item.tableSize.cols}`,
        type: "function",
        boost,
        apply: applySizedTable(item.tableSize.visualRows, item.tableSize.cols),
      };
    }
    if (item.id === "table-picker") {
      return {
        label: t(language, item.labelKey),
        detail: item.detailKey ? t(language, item.detailKey) : undefined,
        type: "function",
        boost,
        apply: applyTablePicker(),
      };
    }
    if (item.id === "footnote") {
      return {
        label: t(language, item.labelKey),
        detail: item.detailKey ? t(language, item.detailKey) : undefined,
        type: "function",
        boost,
        apply: applyFootnote(),
      };
    }

    if (item.id === "table-sized") {
      return {
        label: t(language, item.labelKey),
        type: "function",
        boost,
        apply: applyTablePicker(),
      };
    }

    return {
      label: t(language, item.labelKey),
      detail: item.detailKey ? t(language, item.detailKey) : undefined,
      type: "function",
      boost,
      apply: applySnippet(
        item.id,
        item.id === "code-fence" || item.id === "wiki-embed",
      ),
    };
  });

  return {
    from: match.from,
    to: context.pos,
    options,
    filter: false,
    validFor: /^\/[^\n]*$/,
  };
}
