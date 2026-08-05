/**
 * Live GFM table overlay: render pipe tables as an editable HTML grid.
 * Row/column insert & delete via context menu (and keyboard shortcuts);
 * source remains standard GFM.
 */

import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import {
  RangeSetBuilder,
  StateField,
  type EditorState,
} from "@codemirror/state";
import type { AppLanguage } from "../../types";
import { t } from "../../utils/i18n";
import {
  type MarkdownTable,
  deleteColumn,
  deleteRow,
  findAllTables,
  getLogicalRowCells,
  getTableDocRange,
  insertColumn,
  insertRowAbove,
  insertRowBelow,
  logicalRowCount,
  serializeTable,
  setTableCell,
  unescapeTableCellText,
} from "../../utils/markdownTable";
import { isLargeEditorState } from "./hooks/codeMirrorHelpers";
import { getFrontmatterRange, isInsideFencedCode } from "./behavior/core";
import { useAppStore } from "../../store/appStore";

type CellCoord = { logicalRow: number; col: number };

type PendingFocus = {
  startLine: number;
  cell: CellCoord;
  placeCaretAtEnd?: boolean;
};

const pendingFocusByView = new WeakMap<EditorView, PendingFocus>();

function currentLanguage(): AppLanguage {
  return useAppStore.getState().settings.language ?? "zh-CN";
}

function tableSignature(table: MarkdownTable): string {
  return serializeTable(table).join("\n");
}

function docLinesFromState(state: EditorState): string[] {
  return state.doc.toString().split("\n");
}

function replaceTableInView(
  view: EditorView,
  table: MarkdownTable,
  nextTable: MarkdownTable,
  focus?: CellCoord,
  placeCaretAtEnd = false,
): void {
  const range = getTableDocRange(view.state.doc, table);
  const serialized = serializeTable(nextTable).join("\n");
  if (focus) {
    pendingFocusByView.set(view, {
      startLine: table.startLine,
      cell: focus,
      placeCaretAtEnd,
    });
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: serialized },
    userEvent: "input",
  });
}

function readCellText(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\u00a0/g, " ");
}

function placeCaretIn(el: HTMLElement, atEnd = false): void {
  el.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  selection.removeAllRanges();
  selection.addRange(range);
}

function cellValueEquals(rawMarkdown: string, edited: string): boolean {
  return unescapeTableCellText(rawMarkdown) === edited;
}

function withCommittedCell(
  table: MarkdownTable,
  logicalRow: number,
  col: number,
  el: HTMLElement,
): MarkdownTable {
  const value = readCellText(el);
  const current = getLogicalRowCells(table, logicalRow)[col] ?? "";
  if (cellValueEquals(current, value)) return table;
  return setTableCell(table, logicalRow, col, value);
}

function buildContextMenu(
  view: EditorView,
  getTable: () => MarkdownTable | null,
  cell: CellCoord,
  language: AppLanguage,
  onClose: () => void,
): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "mp-live-table-menu";
  menu.setAttribute("role", "menu");

  const items: Array<{
    label: string;
    run: (
      table: MarkdownTable,
    ) => { table: MarkdownTable; focus: CellCoord } | null;
  }> = [
    {
      label: t(language, "table_insertRowAbove"),
      run: (table) => {
        if (cell.logicalRow <= 0) return null;
        return {
          table: insertRowAbove(table, cell.logicalRow),
          focus: cell,
        };
      },
    },
    {
      label: t(language, "table_insertRowBelow"),
      run: (table) => {
        const next = insertRowBelow(table, cell.logicalRow);
        return {
          table: next,
          focus: {
            logicalRow: Math.min(
              cell.logicalRow + 1,
              logicalRowCount(next) - 1,
            ),
            col: cell.col,
          },
        };
      },
    },
    {
      label: t(language, "table_deleteRow"),
      run: (table) => {
        if (cell.logicalRow <= 0 || table.body.length <= 1) return null;
        const next = deleteRow(table, cell.logicalRow);
        if (!next) return null;
        return {
          table: next,
          focus: {
            logicalRow: Math.min(cell.logicalRow, logicalRowCount(next) - 1),
            col: cell.col,
          },
        };
      },
    },
    {
      label: t(language, "table_insertColumnLeft"),
      run: (table) => ({
        table: insertColumn(table, cell.col, "left"),
        focus: cell,
      }),
    },
    {
      label: t(language, "table_insertColumnRight"),
      run: (table) => ({
        table: insertColumn(table, cell.col, "right"),
        focus: { logicalRow: cell.logicalRow, col: cell.col + 1 },
      }),
    },
    {
      label: t(language, "table_deleteColumn"),
      run: (table) => {
        if (table.columnCount <= 1) return null;
        const next = deleteColumn(table, cell.col);
        if (!next) return null;
        return {
          table: next,
          focus: {
            logicalRow: cell.logicalRow,
            col: Math.min(cell.col, next.columnCount - 1),
          },
        };
      },
    },
  ];

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mp-live-table-menu-item";
    button.textContent = item.label;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const table = getTable();
      onClose();
      if (!table) return;
      const result = item.run(table);
      if (!result) return;
      replaceTableInView(view, table, result.table, result.focus);
    });
    menu.appendChild(button);
  }

  return menu;
}

class TableWidget extends WidgetType {
  readonly table: MarkdownTable;
  readonly signature: string;

  constructor(table: MarkdownTable) {
    super();
    this.table = table;
    this.signature = tableSignature(table);
  }

  eq(other: TableWidget): boolean {
    return this.signature === other.signature;
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const language = currentLanguage();
    const wrap = document.createElement("div");
    wrap.className = "mp-live-table-wrap";
    wrap.contentEditable = "false";
    wrap.dataset.startLine = String(this.table.startLine);

    let activeCell: CellCoord = { logicalRow: 0, col: 0 };
    let menuEl: HTMLDivElement | null = null;

    const closeMenu = () => {
      menuEl?.remove();
      menuEl = null;
    };

    const resolveTable = (): MarkdownTable | null => {
      const tables = findAllTables(docLinesFromState(view.state));
      return (
        tables.find(
          (candidate) => candidate.startLine === this.table.startLine,
        ) ??
        tables.find(
          (candidate) => tableSignature(candidate) === this.signature,
        ) ??
        null
      );
    };

    const focusCell = (coord: CellCoord, atEnd = false) => {
      const el = wrap.querySelector<HTMLElement>(
        `[data-row="${coord.logicalRow}"][data-col="${coord.col}"]`,
      );
      if (!el) return;
      activeCell = coord;
      placeCaretIn(el, atEnd);
    };

    const mutate = (
      run: (
        table: MarkdownTable,
      ) => { table: MarkdownTable; focus: CellCoord } | null,
    ) => {
      closeMenu();
      const table = resolveTable();
      if (!table) return;
      const activeEl = wrap.querySelector<HTMLElement>(
        `[data-row="${activeCell.logicalRow}"][data-col="${activeCell.col}"]`,
      );
      const base = activeEl
        ? withCommittedCell(
            table,
            activeCell.logicalRow,
            activeCell.col,
            activeEl,
          )
        : table;
      const result = run(base);
      if (!result) return;
      replaceTableInView(view, table, result.table, result.focus);
    };

    const tableEl = document.createElement("table");
    tableEl.className = "mp-live-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (let col = 0; col < this.table.columnCount; col += 1) {
      headerRow.appendChild(
        createCellEl("th", 0, col, this.table.header[col] ?? ""),
      );
    }
    thead.appendChild(headerRow);
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.table.body.forEach((row, bodyIndex) => {
      const tr = document.createElement("tr");
      const logicalRow = bodyIndex + 1;
      for (let col = 0; col < this.table.columnCount; col += 1) {
        tr.appendChild(createCellEl("td", logicalRow, col, row[col] ?? ""));
      }
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);
    wrap.appendChild(tableEl);

    function createCellEl(
      tag: "th" | "td",
      logicalRow: number,
      col: number,
      raw: string,
    ): HTMLElement {
      const el = document.createElement(tag);
      el.className = "mp-live-table-cell";
      el.contentEditable = "true";
      el.spellcheck = false;
      el.dataset.row = String(logicalRow);
      el.dataset.col = String(col);
      el.textContent = unescapeTableCellText(raw);

      el.addEventListener("focus", () => {
        activeCell = { logicalRow, col };
        closeMenu();
      });

      el.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (wrap.contains(document.activeElement)) return;
          const latest = resolveTable();
          if (!latest) return;
          const value = readCellText(el);
          const current = getLogicalRowCells(latest, logicalRow)[col] ?? "";
          if (cellValueEquals(current, value)) return;
          replaceTableInView(
            view,
            latest,
            setTableCell(latest, logicalRow, col, value),
          );
        }, 0);
      });

      el.addEventListener("keydown", (event) => {
        if (event.isComposing) return;

        const mod = event.metaKey || event.ctrlKey;

        if (event.key === "Tab") {
          event.preventDefault();
          const table = resolveTable();
          if (!table) return;
          const committed = withCommittedCell(table, logicalRow, col, el);

          if (event.shiftKey) {
            const focus: CellCoord =
              col > 0
                ? { logicalRow, col: col - 1 }
                : logicalRow > 0
                  ? {
                      logicalRow: logicalRow - 1,
                      col: committed.columnCount - 1,
                    }
                  : { logicalRow, col };
            if (committed !== table) {
              replaceTableInView(view, table, committed, focus, true);
            } else if (focus.logicalRow !== logicalRow || focus.col !== col) {
              focusCell(focus, true);
            }
            return;
          }

          if (col + 1 < committed.columnCount) {
            const focus = { logicalRow, col: col + 1 };
            if (committed !== table) {
              replaceTableInView(view, table, committed, focus);
            } else {
              focusCell(focus);
            }
            return;
          }

          if (logicalRow + 1 < logicalRowCount(committed)) {
            const focus = { logicalRow: logicalRow + 1, col: 0 };
            if (committed !== table) {
              replaceTableInView(view, table, committed, focus);
            } else {
              focusCell(focus);
            }
            return;
          }

          const next = insertRowBelow(committed, logicalRow);
          replaceTableInView(view, table, next, {
            logicalRow: logicalRowCount(next) - 1,
            col: 0,
          });
          return;
        }

        if (event.key === "Enter" && !mod && !event.altKey) {
          event.preventDefault();
          const table = resolveTable();
          if (!table) return;
          const committed = withCommittedCell(table, logicalRow, col, el);
          if (logicalRow + 1 < logicalRowCount(committed)) {
            const focus = { logicalRow: logicalRow + 1, col };
            if (committed !== table) {
              replaceTableInView(view, table, committed, focus);
            } else {
              focusCell(focus);
            }
            return;
          }
          const next = insertRowBelow(committed, logicalRow);
          replaceTableInView(view, table, next, {
            logicalRow: logicalRowCount(next) - 1,
            col,
          });
          return;
        }

        if (event.key === "Enter" && mod && event.shiftKey) {
          event.preventDefault();
          mutate((table) => {
            const next = insertRowBelow(table, activeCell.logicalRow);
            return {
              table: next,
              focus: {
                logicalRow: Math.min(
                  activeCell.logicalRow + 1,
                  logicalRowCount(next) - 1,
                ),
                col: activeCell.col,
              },
            };
          });
          return;
        }

        if (event.key === "Enter" && event.altKey && event.shiftKey) {
          event.preventDefault();
          mutate((table) => {
            if (activeCell.logicalRow <= 0) {
              return {
                table: insertRowBelow(table, 0),
                focus: { logicalRow: 1, col: activeCell.col },
              };
            }
            return {
              table: insertRowAbove(table, activeCell.logicalRow),
              focus: activeCell,
            };
          });
          return;
        }

        if (event.key === "ArrowLeft" && event.altKey && mod) {
          event.preventDefault();
          mutate((table) => ({
            table: insertColumn(table, activeCell.col, "left"),
            focus: activeCell,
          }));
          return;
        }

        if (event.key === "ArrowRight" && event.altKey && mod) {
          event.preventDefault();
          mutate((table) => ({
            table: insertColumn(table, activeCell.col, "right"),
            focus: {
              logicalRow: activeCell.logicalRow,
              col: activeCell.col + 1,
            },
          }));
          return;
        }

        if (event.key === "Backspace" && mod && event.shiftKey) {
          event.preventDefault();
          mutate((table) => {
            if (activeCell.logicalRow <= 0 || table.body.length <= 1) {
              return null;
            }
            const next = deleteRow(table, activeCell.logicalRow);
            if (!next) return null;
            return {
              table: next,
              focus: {
                logicalRow: Math.min(
                  activeCell.logicalRow,
                  logicalRowCount(next) - 1,
                ),
                col: activeCell.col,
              },
            };
          });
          return;
        }

        if (event.key === "Backspace" && event.altKey && mod) {
          event.preventDefault();
          mutate((table) => {
            if (table.columnCount <= 1) return null;
            const next = deleteColumn(table, activeCell.col);
            if (!next) return null;
            return {
              table: next,
              focus: {
                logicalRow: activeCell.logicalRow,
                col: Math.min(activeCell.col, next.columnCount - 1),
              },
            };
          });
        }
      });

      el.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        activeCell = { logicalRow, col };
        menuEl = buildContextMenu(
          view,
          resolveTable,
          { logicalRow, col },
          language,
          closeMenu,
        );
        menuEl.style.left = `${event.clientX}px`;
        menuEl.style.top = `${event.clientY}px`;
        document.body.appendChild(menuEl);

        const onDoc = (ev: MouseEvent) => {
          if (menuEl && !menuEl.contains(ev.target as Node)) {
            closeMenu();
            document.removeEventListener("mousedown", onDoc, true);
          }
        };
        document.addEventListener("mousedown", onDoc, true);
      });

      return el;
    }

    const pending = pendingFocusByView.get(view);
    if (pending && pending.startLine === this.table.startLine) {
      pendingFocusByView.delete(view);
      requestAnimationFrame(() => {
        focusCell(pending.cell, pending.placeCaretAtEnd);
      });
    }

    return wrap;
  }
}

function buildTableDecorations(state: EditorState): DecorationSet {
  if (isLargeEditorState(state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const tables = findAllTables(docLinesFromState(state));
  const frontmatter = getFrontmatterRange(state);

  for (const table of tables) {
    const range = getTableDocRange(state.doc, table);
    if (
      frontmatter &&
      range.from < frontmatter.to &&
      range.to > frontmatter.from
    ) {
      continue;
    }
    if (isInsideFencedCode(state, range.from)) {
      continue;
    }
    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        widget: new TableWidget(table),
        block: true,
      }),
    );
  }

  return builder.finish();
}

/** Block table widgets must come from a StateField (not a ViewPlugin). */
const tableLiveOverlayField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildTableDecorations(tr.state);
    }
    return decorations;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

export const tableLiveOverlay = tableLiveOverlayField;
