/**
 * Markdown table structural editing commands (Obsidian-style, source mode).
 */

import {
  EditorSelection,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import {
  type ColumnAlignment,
  type MarkdownTable,
  cellContentOffset,
  createEmptyTable,
  deleteColumn,
  deleteRow,
  findTableAt,
  insertColumn,
  insertRowAbove,
  insertRowBelow,
  isCellEmpty,
  lineIndexForLogicalRow,
  logicalRowCount,
  moveColumn,
  moveRow,
  nextCell,
  prevCell,
  replaceTableLines,
  resolveTableCursor,
  serializeFormattedTable,
  serializeTable,
  setColumnAlignment,
} from "../../../utils/markdownTable";
import { isInsideFencedCode } from "./core";
import {
  bodyRowsForVisualRows,
  TABLE_INSERT_DEFAULT_COLS,
  TABLE_INSERT_DEFAULT_ROWS,
  tableInsertHeaderLabels,
} from "../../../utils/tableInsert";

function docLines(state: EditorState): string[] {
  const text = state.doc.toString();
  return text.split("\n");
}

function lineIndexAt(state: EditorState, pos: number): number {
  return state.doc.lineAt(pos).number - 1;
}

function applyTableMutation(
  state: EditorState,
  dispatch: Parameters<StateCommand>[0]["dispatch"],
  mutate: (
    table: MarkdownTable,
    logicalRow: number,
    col: number,
  ) => {
    table: MarkdownTable;
    logicalRow: number;
    col: number;
    serialized?: string[];
  } | null,
): boolean {
  const main = state.selection.main;
  if (isInsideFencedCode(state, main.from)) return false;

  const lines = docLines(state);
  const lineIndex = lineIndexAt(state, main.from);
  const line = state.doc.lineAt(main.from);
  const cursor = resolveTableCursor(lines, lineIndex, line.from, main.from);
  if (!cursor) return false;

  const result = mutate(cursor.table, cursor.logicalRow, cursor.col);
  if (!result) return false;

  const { lines: nextLines, startLine } = replaceTableLines(
    lines,
    cursor.table,
    result.table,
    result.serialized,
  );
  const nextText = nextLines.join("\n");
  const targetLine = lineIndexForLogicalRow(
    {
      ...result.table,
      startLine,
      endLine:
        startLine +
        (result.serialized ?? serializeTable(result.table)).length -
        1,
    },
    result.logicalRow,
  );
  const cell = cellContentOffset(nextLines, targetLine, result.col);
  const anchor = cell?.from ?? 0;

  dispatch(
    state.update({
      changes: { from: 0, to: state.doc.length, insert: nextText },
      selection: EditorSelection.cursor(anchor),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
}

function selectCell(
  state: EditorState,
  dispatch: Parameters<StateCommand>[0]["dispatch"],
  lines: string[],
  lineIndex: number,
  col: number,
): boolean {
  const cell = cellContentOffset(lines, lineIndex, col);
  if (!cell) return false;
  dispatch(
    state.update({
      selection: EditorSelection.cursor(cell.from),
      scrollIntoView: true,
    }),
  );
  return true;
}

/** True when the main cursor is inside a GFM table (including separator). */
export function isInMarkdownTable(
  state: EditorState,
  pos = state.selection.main.from,
): boolean {
  if (isInsideFencedCode(state, pos)) return false;
  const lines = docLines(state);
  const lineIndex = lineIndexAt(state, pos);
  return findTableAt(lines, lineIndex) !== null;
}

export const handleTableTab: StateCommand = ({ state, dispatch }): boolean => {
  const main = state.selection.main;
  if (!main.empty) return false;
  if (isInsideFencedCode(state, main.from)) return false;

  const lines = docLines(state);
  const lineIndex = lineIndexAt(state, main.from);
  const line = state.doc.lineAt(main.from);
  const cursor = resolveTableCursor(lines, lineIndex, line.from, main.from);
  if (!cursor) return false;

  // From separator, jump to first body cell (or header) same column
  let logicalRow = cursor.onSeparator ? 1 : cursor.logicalRow;
  if (cursor.onSeparator && logicalRowCount(cursor.table) <= 1) {
    logicalRow = 0;
  }
  const col = cursor.col;

  const target = nextCell(cursor.table, logicalRow, col);
  if (target.appendRow) {
    const nextTable = insertRowBelow(
      cursor.table,
      logicalRowCount(cursor.table) - 1,
    );
    // If table had only header, insertRowBelow(header) adds first body row
    const ensured =
      cursor.table.body.length === 0
        ? insertRowBelow(cursor.table, 0)
        : nextTable;
    const { lines: nextLines, startLine } = replaceTableLines(
      lines,
      cursor.table,
      ensured,
    );
    const newTable = {
      ...ensured,
      startLine,
      endLine: startLine + serializeTable(ensured).length - 1,
    };
    const newLogicalRow = logicalRowCount(newTable) - 1;
    const targetLine = lineIndexForLogicalRow(newTable, newLogicalRow);
    const cell = cellContentOffset(nextLines, targetLine, 0);
    dispatch(
      state.update({
        changes: {
          from: 0,
          to: state.doc.length,
          insert: nextLines.join("\n"),
        },
        selection: EditorSelection.cursor(cell?.from ?? 0),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  const targetLine = lineIndexForLogicalRow(cursor.table, target.logicalRow);
  return selectCell(state, dispatch, lines, targetLine, target.col);
};

export const handleTableShiftTab: StateCommand = ({
  state,
  dispatch,
}): boolean => {
  const main = state.selection.main;
  if (!main.empty) return false;
  if (isInsideFencedCode(state, main.from)) return false;

  const lines = docLines(state);
  const lineIndex = lineIndexAt(state, main.from);
  const line = state.doc.lineAt(main.from);
  const cursor = resolveTableCursor(lines, lineIndex, line.from, main.from);
  if (!cursor) return false;

  const logicalRow = cursor.onSeparator ? 0 : cursor.logicalRow;
  const target = prevCell(cursor.table, logicalRow, cursor.col);
  if (!target) {
    // Stay at first cell
    const targetLine = lineIndexForLogicalRow(cursor.table, 0);
    return selectCell(state, dispatch, lines, targetLine, 0);
  }

  const targetLine = lineIndexForLogicalRow(cursor.table, target.logicalRow);
  return selectCell(state, dispatch, lines, targetLine, target.col);
};

export const handleTableEnter: StateCommand = ({
  state,
  dispatch,
}): boolean => {
  const main = state.selection.main;
  if (!main.empty) return false;
  if (isInsideFencedCode(state, main.from)) return false;

  const lines = docLines(state);
  const lineIndex = lineIndexAt(state, main.from);
  const line = state.doc.lineAt(main.from);
  const cursor = resolveTableCursor(lines, lineIndex, line.from, main.from);
  if (!cursor) return false;

  // Separator: move to first body row same column (or append)
  if (cursor.onSeparator) {
    if (cursor.table.body.length === 0) {
      return applyTableMutation(state, dispatch, (table, _r, col) => {
        const next = insertRowBelow(table, 0);
        return { table: next, logicalRow: 1, col };
      });
    }
    const targetLine = lineIndexForLogicalRow(cursor.table, 1);
    return selectCell(state, dispatch, lines, targetLine, cursor.col);
  }

  const rows = logicalRowCount(cursor.table);
  const atLastRow = cursor.logicalRow >= rows - 1;
  const empty = isCellEmpty(cursor.table, cursor.logicalRow, cursor.col);

  // Obsidian-like exit: empty cell on last row → remove trailing empty row and leave table
  if (
    atLastRow &&
    empty &&
    cursor.logicalRow > 0 &&
    cursor.table.body.length > 0
  ) {
    const lastBody = cursor.table.body[cursor.table.body.length - 1];
    const rowEmpty = lastBody.every((c) => c.trim() === "");
    if (rowEmpty) {
      const nextTable = deleteRow(cursor.table, cursor.logicalRow);
      if (nextTable) {
        const { lines: nextLines, endLine } = replaceTableLines(
          lines,
          cursor.table,
          nextTable,
        );
        // Place cursor on the blank line after the table
        let after = 0;
        for (let i = 0; i <= endLine; i += 1) {
          after += nextLines[i].length + 1;
        }
        // Ensure a trailing newline after table for typing
        let insert = nextLines.join("\n");
        if (!insert.endsWith("\n")) {
          // If there's content after, we already have lines; compute offset after table
        }
        const suffix = lines.slice(cursor.table.endLine + 1);
        if (suffix.length === 0 || (suffix[0] ?? "").trim() !== "") {
          // Insert a blank line after table when exiting
          const withBlank = [
            ...nextLines.slice(0, endLine + 1),
            "",
            ...nextLines.slice(endLine + 1),
          ];
          insert = withBlank.join("\n");
          after = 0;
          for (let i = 0; i <= endLine; i += 1) {
            after += withBlank[i].length + 1;
          }
          dispatch(
            state.update({
              changes: { from: 0, to: state.doc.length, insert },
              selection: EditorSelection.cursor(after),
              scrollIntoView: true,
              userEvent: "input",
            }),
          );
          return true;
        }

        dispatch(
          state.update({
            changes: { from: 0, to: state.doc.length, insert },
            selection: EditorSelection.cursor(after),
            scrollIntoView: true,
            userEvent: "input",
          }),
        );
        return true;
      }
    }
  }

  if (atLastRow) {
    return applyTableMutation(state, dispatch, (table, logicalRow, col) => {
      const next = insertRowBelow(table, logicalRow);
      return { table: next, logicalRow: logicalRow + 1, col };
    });
  }

  const targetLine = lineIndexForLogicalRow(
    cursor.table,
    cursor.logicalRow + 1,
  );
  return selectCell(state, dispatch, lines, targetLine, cursor.col);
};

export interface InsertMarkdownTableOptions {
  visualRows?: number;
  cols?: number;
  headers?: string[];
  replaceFrom?: number;
  replaceTo?: number;
}

export function insertMarkdownTable(
  state: EditorState,
  dispatch: Parameters<StateCommand>[0]["dispatch"],
  options: InsertMarkdownTableOptions = {},
): boolean {
  const replaceFrom = options.replaceFrom;
  const replaceTo = options.replaceTo;
  const pos = replaceFrom ?? state.selection.main.from;
  if (isInsideFencedCode(state, pos)) return false;
  if (isInMarkdownTable(state, pos)) return false;

  const visualRows = options.visualRows ?? TABLE_INSERT_DEFAULT_ROWS;
  const cols = options.cols ?? TABLE_INSERT_DEFAULT_COLS;
  const headers = options.headers ?? tableInsertHeaderLabels(cols);
  const table = createEmptyTable(
    bodyRowsForVisualRows(visualRows),
    cols,
    headers,
  );
  const tableText = serializeTable(table).join("\n");
  const line = state.doc.lineAt(pos);

  let from: number;
  let to: number;
  let insert: string;

  if (replaceFrom != null && replaceTo != null) {
    from = replaceFrom;
    to = replaceTo;
    insert = `${tableText}\n`;
  } else if (line.text.trim() === "") {
    from = line.from;
    to = line.to;
    insert = `${tableText}\n`;
  } else if (state.selection.main.from === line.to) {
    from = line.to;
    to = line.to;
    insert = `\n${tableText}\n`;
  } else {
    from = state.selection.main.from;
    to = state.selection.main.to;
    insert = `\n${tableText}\n`;
  }

  const preview = state.update({
    changes: { from, to, insert },
  }).state;
  const nextLines = preview.doc.toString().split("\n");
  const approxLine =
    preview.doc.lineAt(Math.min(from + 1, preview.doc.length)).number - 1;
  const found =
    findTableAt(nextLines, approxLine) ??
    findTableAt(nextLines, Math.min(approxLine + 1, nextLines.length - 1));
  const cell = found ? cellContentOffset(nextLines, found.startLine, 0) : null;

  dispatch(
    state.update({
      changes: { from, to, insert },
      selection: cell
        ? EditorSelection.range(cell.from, cell.to)
        : EditorSelection.cursor(from + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
}

export const insertTable: StateCommand = ({ state, dispatch }): boolean =>
  insertMarkdownTable(state, dispatch);

export const insertTableRowAbove: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = insertRowAbove(table, logicalRow);
    const newRow = logicalRow <= 0 ? 1 : logicalRow;
    return { table: next, logicalRow: newRow, col };
  });

export const insertTableRowBelow: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = insertRowBelow(table, logicalRow);
    return { table: next, logicalRow: logicalRow + 1, col };
  });

export const deleteTableRow: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = deleteRow(table, logicalRow);
    if (!next) return null;
    const maxRow = logicalRowCount(next) - 1;
    return {
      table: next,
      logicalRow: Math.min(logicalRow, maxRow),
      col: Math.min(col, next.columnCount - 1),
    };
  });

export const insertTableColumnLeft: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = insertColumn(table, col, "left");
    return { table: next, logicalRow, col };
  });

export const insertTableColumnRight: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = insertColumn(table, col, "right");
    return { table: next, logicalRow, col: col + 1 };
  });

export const deleteTableColumn: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = deleteColumn(table, col);
    if (!next) return null;
    return {
      table: next,
      logicalRow,
      col: Math.min(col, next.columnCount - 1),
    };
  });

export const moveTableRowUp: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = moveRow(table, logicalRow, "up");
    if (!next) return null;
    return { table: next, logicalRow: logicalRow - 1, col };
  });

export const moveTableRowDown: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = moveRow(table, logicalRow, "down");
    if (!next) return null;
    return { table: next, logicalRow: logicalRow + 1, col };
  });

export const moveTableColumnLeft: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = moveColumn(table, col, "left");
    if (!next) return null;
    return { table: next, logicalRow, col: col - 1 };
  });

export const moveTableColumnRight: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => {
    const next = moveColumn(table, col, "right");
    if (!next) return null;
    return { table: next, logicalRow, col: col + 1 };
  });

function alignCommand(align: ColumnAlignment): StateCommand {
  return ({ state, dispatch }) =>
    applyTableMutation(state, dispatch, (table, logicalRow, col) => ({
      table: setColumnAlignment(table, col, align),
      logicalRow,
      col,
    }));
}

export const alignTableColumnLeft = alignCommand("left");
export const alignTableColumnCenter = alignCommand("center");
export const alignTableColumnRight = alignCommand("right");

export const formatTable: StateCommand = ({ state, dispatch }) =>
  applyTableMutation(state, dispatch, (table, logicalRow, col) => ({
    table,
    logicalRow,
    col,
    serialized: serializeFormattedTable(table),
  }));
