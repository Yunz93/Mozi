/**
 * Live Preview block widgets for GFM pipe tables.
 * Tables stay rendered while editing; cells use contenteditable for in-place edits.
 *
 * Block replacements are provided via StateField (CodeMirror requirement).
 */

import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  findTableAt,
  isTablePartLine,
  insertColumn,
  insertRowAbove,
  insertRowBelow,
  deleteColumn,
  deleteRow,
  logicalRowCount,
  nextCell,
  prevCell,
  serializeTable,
  setTableCell,
  type ColumnAlignment,
  type MarkdownTable,
} from "../../../utils/markdownTable";
import { renderMarkdown } from "../../../utils/markdown";
import { useAppStore } from "../../../store/appStore";
import { t } from "../../../utils/i18n";
import { getCachedMarkdownHtml, scheduleLivePreviewMeasure } from "./shared";
import {
  getLivePreviewOptimizationMode,
  SoftOffPlaceholderWidget,
  softOffReason,
} from "./softOff";
import {
  closeLiveTableContextMenu,
  openLiveTableContextMenu,
  type LiveTableStructureOp,
} from "./tableContextMenu";

export type ActiveTableCell = {
  /** Document offset of the table header line start. */
  from: number;
  to: number;
  logicalRow: number;
  col: number;
};

export const setActiveTableCellEffect =
  StateEffect.define<ActiveTableCell | null>();

export const activeTableCellField = StateField.define<ActiveTableCell | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setActiveTableCellEffect)) {
        return effect.value;
      }
    }
    if (!value) return null;
    if (tr.docChanged) {
      const from = tr.changes.mapPos(value.from, 1);
      const to = tr.changes.mapPos(value.to, -1);
      if (from >= to) return null;
      return { ...value, from, to };
    }
    return value;
  },
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineCell(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return getCachedMarkdownHtml(trimmed, (source) => {
      const html = renderMarkdown(source);
      const match = html.match(/<p>([\s\S]*?)<\/p>/i);
      return match?.[1] ?? html;
    });
  } catch {
    return escapeHtml(trimmed);
  }
}

function alignStyle(alignments: ColumnAlignment[], index: number): string {
  const a = alignments[index];
  if (a === "left" || a === "center" || a === "right") {
    return `text-align:${a}`;
  }
  return "";
}

function tableAtDocPos(
  view: EditorView,
  tableFrom: number,
): { table: MarkdownTable; from: number; to: number } | null {
  const doc = view.state.doc;
  if (doc.length === 0) return null;
  const anchor = doc.lineAt(Math.max(0, Math.min(tableFrom, doc.length)));
  if (!isTablePartLine(anchor.text)) return null;

  // Walk only the contiguous table block — avoid doc.toString().split("\n").
  let start = anchor.number;
  while (start > 1 && isTablePartLine(doc.line(start - 1).text)) {
    start -= 1;
  }
  let end = anchor.number;
  while (end < doc.lines && isTablePartLine(doc.line(end + 1).text)) {
    end += 1;
  }

  const lines: string[] = [];
  for (let n = start; n <= end; n += 1) {
    lines.push(doc.line(n).text);
  }
  const local = findTableAt(lines, anchor.number - start);
  if (!local) return null;

  const absStartLine = start - 1 + local.startLine;
  const absEndLine = start - 1 + local.endLine;
  const from = doc.line(absStartLine + 1).from;
  const to = doc.line(absEndLine + 1).to;
  return {
    table: {
      ...local,
      startLine: absStartLine,
      endLine: absEndLine,
    },
    from,
    to,
  };
}

function dispatchTableRewrite(
  view: EditorView,
  tableFrom: number,
  mutate: (table: MarkdownTable) => {
    table: MarkdownTable;
    active: ActiveTableCell | null;
  },
): boolean {
  const located = tableAtDocPos(view, tableFrom);
  if (!located) return false;

  const { table: nextTable, active } = mutate(located.table);
  const serialized = serializeTable(nextTable);
  const insert = serialized.join("\n");
  const nextTo = located.from + insert.length;

  view.dispatch({
    changes: { from: located.from, to: located.to, insert },
    selection: { anchor: located.from },
    effects: setActiveTableCellEffect.of(
      active
        ? {
            from: located.from,
            to: nextTo,
            logicalRow: active.logicalRow,
            col: active.col,
          }
        : null,
    ),
    scrollIntoView: false,
  });
  return true;
}

function commitCellValue(
  view: EditorView,
  tableFrom: number,
  logicalRow: number,
  col: number,
  value: string,
  nextActive: { logicalRow: number; col: number } | null,
): boolean {
  return dispatchTableRewrite(view, tableFrom, (table) => {
    const updated = setTableCell(table, logicalRow, col, value);
    return {
      table: updated,
      active: nextActive
        ? {
            from: tableFrom,
            to: tableFrom,
            logicalRow: nextActive.logicalRow,
            col: nextActive.col,
          }
        : null,
    };
  });
}

function applyLiveTableStructureOp(
  view: EditorView,
  tableFrom: number,
  logicalRow: number,
  col: number,
  value: string,
  op: LiveTableStructureOp,
): boolean {
  return dispatchTableRewrite(view, tableFrom, (table) => {
    const withValue = setTableCell(table, logicalRow, col, value);
    let nextTable: MarkdownTable | null = withValue;
    let nextRow = logicalRow;
    let nextCol = col;

    switch (op) {
      case "insertRowAbove": {
        nextTable = insertRowAbove(withValue, logicalRow);
        nextRow = logicalRow <= 0 ? 1 : logicalRow;
        break;
      }
      case "insertRowBelow": {
        nextTable = insertRowBelow(withValue, logicalRow);
        nextRow = logicalRow + 1;
        break;
      }
      case "deleteRow": {
        nextTable = deleteRow(withValue, logicalRow);
        if (!nextTable) return { table: withValue, active: null };
        nextRow = Math.min(
          logicalRow,
          Math.max(0, logicalRowCount(nextTable) - 1),
        );
        nextCol = Math.min(col, nextTable.columnCount - 1);
        break;
      }
      case "insertColumnLeft": {
        nextTable = insertColumn(withValue, col, "left");
        break;
      }
      case "insertColumnRight": {
        nextTable = insertColumn(withValue, col, "right");
        nextCol = col + 1;
        break;
      }
      case "deleteColumn": {
        nextTable = deleteColumn(withValue, col);
        if (!nextTable) return { table: withValue, active: null };
        nextCol = Math.min(col, nextTable.columnCount - 1);
        break;
      }
      default:
        break;
    }

    return {
      table: nextTable,
      active: {
        from: tableFrom,
        to: tableFrom,
        logicalRow: nextRow,
        col: nextCol,
      },
    };
  });
}

function isMod(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function readEditingCellValue(cell: HTMLElement): string {
  return (cell.textContent ?? "").replace(/\u00a0/g, " ");
}

function placeCaretAtEnd(el: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusActiveCell(view: EditorView) {
  const active = view.state.field(activeTableCellField);
  if (!active) return;
  const selector = `[data-mp-table-from="${active.from}"][data-mp-row="${active.logicalRow}"][data-mp-col="${active.col}"]`;
  const el = view.dom.querySelector(selector) as HTMLElement | null;
  if (!el || el.contentEditable !== "true") return;
  if (document.activeElement !== el) {
    el.focus();
    placeCaretAtEnd(el);
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly header: string[],
    readonly alignments: ColumnAlignment[],
    readonly body: string[][],
    readonly activeCell: { logicalRow: number; col: number } | null,
  ) {
    super();
  }

  eq(other: TableWidget) {
    return (
      this.from === other.from &&
      this.to === other.to &&
      this.activeCell?.logicalRow === other.activeCell?.logicalRow &&
      this.activeCell?.col === other.activeCell?.col &&
      this.header.join("\0") === other.header.join("\0") &&
      this.alignments.join("\0") === other.alignments.join("\0") &&
      this.body.map((row) => row.join("\0")).join("\n") ===
        other.body.map((row) => row.join("\0")).join("\n")
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-preview-table-wrap";
    wrap.setAttribute("contenteditable", "false");
    wrap.dataset.mpTableFrom = String(this.from);

    const tableEl = document.createElement("table");
    tableEl.className = "cm-live-preview-table";

    const thead = document.createElement("thead");
    thead.appendChild(this.buildRow(view, this.header, 0, true));
    tableEl.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.body.forEach((row, index) => {
      tbody.appendChild(this.buildRow(view, row, index + 1, false));
    });
    tableEl.appendChild(tbody);
    wrap.appendChild(tableEl);

    // Initial height map — wrapped cells / fonts can settle after insert.
    queueMicrotask(() => scheduleLivePreviewMeasure(view));

    wrap.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("th, td")) return;
      event.preventDefault();
      this.activateCell(view, 0, 0, null);
    });

    return wrap;
  }

  private buildRow(
    view: EditorView,
    cells: string[],
    logicalRow: number,
    header: boolean,
  ) {
    const tr = document.createElement("tr");
    const colCount = Math.max(cells.length, this.header.length, 1);
    for (let col = 0; col < colCount; col += 1) {
      const cell = document.createElement(header ? "th" : "td");
      const style = alignStyle(this.alignments, col);
      if (style) cell.setAttribute("style", style);
      cell.dataset.mpTableFrom = String(this.from);
      cell.dataset.mpRow = String(logicalRow);
      cell.dataset.mpCol = String(col);
      this.setupCell(view, cell, logicalRow, col, cells[col] ?? "");
      tr.appendChild(cell);
    }
    return tr;
  }

  private setupCell(
    view: EditorView,
    cell: HTMLElement,
    logicalRow: number,
    col: number,
    rawText: string,
  ) {
    const isEditing =
      this.activeCell?.logicalRow === logicalRow &&
      this.activeCell?.col === col;

    if (isEditing) {
      cell.contentEditable = "true";
      cell.spellcheck = false;
      cell.classList.add("cm-live-preview-table-cell-editing");
      cell.textContent = rawText;
      const remasure = () => scheduleLivePreviewMeasure(view);
      // contenteditable wrap changes height without updating the doc — remasure
      // so following lines do not cover the bottom of the cell / focus ring.
      cell.addEventListener("input", remasure);
      cell.addEventListener("beforeinput", remasure);
      cell.addEventListener("compositionend", remasure);
      queueMicrotask(remasure);
      cell.addEventListener("keydown", (event) => {
        this.onCellKeyDown(view, cell, logicalRow, col, event);
      });
      cell.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (!cell.isConnected) return;
          const activeField = view.state.field(activeTableCellField, false);
          // Tab / click already moved the active cell — value was committed there.
          if (
            !activeField ||
            activeField.from !== this.from ||
            activeField.logicalRow !== logicalRow ||
            activeField.col !== col
          ) {
            return;
          }
          commitCellValue(
            view,
            this.from,
            logicalRow,
            col,
            readEditingCellValue(cell),
            null,
          );
        }, 0);
      });
    } else {
      const html = renderInlineCell(rawText);
      cell.innerHTML = html || "&nbsp;";
    }

    const language = useAppStore.getState().settings.language;
    cell.title = t(language, "table_cellHint");

    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const located = tableAtDocPos(view, this.from);
      if (!located) return;
      const editing =
        cell.contentEditable === "true"
          ? cell
          : (cell
              .closest(".cm-live-preview-table-wrap")
              ?.querySelector(
                ".cm-live-preview-table-cell-editing",
              ) as HTMLElement | null);
      const value = editing
        ? readEditingCellValue(editing)
        : (located.table.body[logicalRow - 1]?.[col] ??
          (logicalRow === 0 ? (located.table.header[col] ?? "") : ""));

      // Ensure this cell is active before mutating.
      if (cell.contentEditable !== "true") {
        this.activateCell(
          view,
          logicalRow,
          col,
          cell.closest(".cm-live-preview-table-wrap"),
        );
      }

      openLiveTableContextMenu(event, {
        view,
        tableFrom: this.from,
        logicalRow,
        col,
        canDeleteColumn: located.table.columnCount > 1,
        readValue: () => {
          const current = view.dom.querySelector(
            `.cm-live-preview-table-cell-editing`,
          ) as HTMLElement | null;
          return current ? readEditingCellValue(current) : value;
        },
        apply: (op, nextValue) => {
          applyLiveTableStructureOp(
            view,
            this.from,
            logicalRow,
            col,
            nextValue,
            op,
          );
        },
      });
    });

    cell.addEventListener("mousedown", (event) => {
      if (event.button === 2) return;
      if (isEditing) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.activateCell(
        view,
        logicalRow,
        col,
        cell.closest(".cm-live-preview-table-wrap"),
      );
    });
  }

  private activateCell(
    view: EditorView,
    logicalRow: number,
    col: number,
    wrap: Element | null,
  ) {
    const editing = wrap?.querySelector(
      ".cm-live-preview-table-cell-editing",
    ) as HTMLElement | null;

    if (editing) {
      const prevRow = Number(editing.dataset.mpRow);
      const prevCol = Number(editing.dataset.mpCol);
      commitCellValue(
        view,
        this.from,
        prevRow,
        prevCol,
        readEditingCellValue(editing),
        { logicalRow, col },
      );
      return;
    }

    view.dispatch({
      selection: { anchor: this.from },
      effects: setActiveTableCellEffect.of({
        from: this.from,
        to: this.to,
        logicalRow,
        col,
      }),
      // Keep viewport stable — scrollIntoView yanked tall tables to the top.
      scrollIntoView: false,
    });
  }

  private onCellKeyDown(
    view: EditorView,
    cell: HTMLElement,
    logicalRow: number,
    col: number,
    event: KeyboardEvent,
  ) {
    if (event.isComposing) return;
    const value = readEditingCellValue(cell);
    const mod = isMod(event);

    // Structural shortcuts (same as source Phase A + delete).
    if (event.key === "Enter" && mod && event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      applyLiveTableStructureOp(
        view,
        this.from,
        logicalRow,
        col,
        value,
        "insertRowBelow",
      );
      return;
    }
    if (event.key === "Enter" && event.altKey && event.shiftKey && !mod) {
      event.preventDefault();
      event.stopPropagation();
      applyLiveTableStructureOp(
        view,
        this.from,
        logicalRow,
        col,
        value,
        "insertRowAbove",
      );
      return;
    }
    if (event.key === "ArrowLeft" && event.altKey && mod) {
      event.preventDefault();
      event.stopPropagation();
      applyLiveTableStructureOp(
        view,
        this.from,
        logicalRow,
        col,
        value,
        "insertColumnLeft",
      );
      return;
    }
    if (event.key === "ArrowRight" && event.altKey && mod) {
      event.preventDefault();
      event.stopPropagation();
      applyLiveTableStructureOp(
        view,
        this.from,
        logicalRow,
        col,
        value,
        "insertColumnRight",
      );
      return;
    }
    if (event.key === "Backspace" && mod && event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      applyLiveTableStructureOp(
        view,
        this.from,
        logicalRow,
        col,
        value,
        "deleteRow",
      );
      return;
    }
    if (event.key === "Backspace" && event.altKey && mod && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      applyLiveTableStructureOp(
        view,
        this.from,
        logicalRow,
        col,
        value,
        "deleteColumn",
      );
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeLiveTableContextMenu();
      commitCellValue(view, this.from, logicalRow, col, value, null);
      view.focus();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const located = tableAtDocPos(view, this.from);
      if (!located) return;
      const draft = setTableCell(located.table, logicalRow, col, value);

      if (event.shiftKey) {
        const prev = prevCell(draft, logicalRow, col);
        commitCellValue(
          view,
          this.from,
          logicalRow,
          col,
          value,
          prev ? { logicalRow: prev.logicalRow, col: prev.col } : null,
        );
        return;
      }

      const nav = nextCell(draft, logicalRow, col);
      if (nav.appendRow) {
        dispatchTableRewrite(view, this.from, (table) => {
          const withValue = setTableCell(table, logicalRow, col, value);
          const withRow = insertRowBelow(
            withValue,
            logicalRowCount(withValue) - 1,
          );
          return {
            table: withRow,
            active: {
              from: this.from,
              to: this.from,
              logicalRow: nav.logicalRow,
              col: nav.col,
            },
          };
        });
        return;
      }

      commitCellValue(view, this.from, logicalRow, col, value, {
        logicalRow: nav.logicalRow,
        col: nav.col,
      });
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !mod && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const located = tableAtDocPos(view, this.from);
      if (!located) return;
      const draft = setTableCell(located.table, logicalRow, col, value);
      const rows = logicalRowCount(draft);
      if (logicalRow + 1 < rows) {
        commitCellValue(view, this.from, logicalRow, col, value, {
          logicalRow: logicalRow + 1,
          col,
        });
        return;
      }
      dispatchTableRewrite(view, this.from, (table) => {
        const withValue = setTableCell(table, logicalRow, col, value);
        const withRow = insertRowBelow(withValue, logicalRow);
        return {
          table: withRow,
          active: {
            from: this.from,
            to: this.from,
            logicalRow: logicalRow + 1,
            col,
          },
        };
      });
    }
  }

  ignoreEvent(event: Event) {
    const type = event.type;
    return (
      type === "mousedown" ||
      type === "mouseup" ||
      type === "click" ||
      type === "contextmenu" ||
      type === "keydown" ||
      type === "keyup" ||
      type === "keypress" ||
      type === "input" ||
      type === "beforeinput" ||
      type === "compositionstart" ||
      type === "compositionupdate" ||
      type === "compositionend" ||
      type === "focus" ||
      type === "blur" ||
      type === "paste" ||
      type === "cut" ||
      type === "copy"
    );
  }
}

function buildTableWidget(
  table: MarkdownTable,
  from: number,
  to: number,
  active: ActiveTableCell | null,
): TableWidget {
  const activeCell =
    active && active.from === from
      ? { logicalRow: active.logicalRow, col: active.col }
      : null;
  return new TableWidget(
    from,
    to,
    table.header,
    table.alignments,
    table.body,
    activeCell,
  );
}

export function buildTableDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const lines = state.doc.toString().split("\n");
  const seen = new Set<number>();
  const active = state.field(activeTableCellField, false) ?? null;
  const mode = getLivePreviewOptimizationMode(state);
  const reason = softOffReason(mode, "table");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (seen.has(lineIndex)) continue;
    const table = findTableAt(lines, lineIndex);
    if (!table) continue;

    for (let i = table.startLine; i <= table.endLine; i += 1) {
      seen.add(i);
    }

    const from = state.doc.line(table.startLine + 1).from;
    const to = state.doc.line(table.endLine + 1).to;
    if (reason) {
      const summary = table.header.slice(0, 3).join(" | ");
      builder.add(
        from,
        to,
        Decoration.replace({
          widget: new SoftOffPlaceholderWidget("table", reason, summary, from),
          block: true,
        }),
      );
      continue;
    }

    builder.add(
      from,
      to,
      Decoration.replace({
        widget: buildTableWidget(table, from, to, active),
        block: true,
      }),
    );
  }

  return builder.finish();
}

/** @deprecated Prefer buildTableDecorations(state); kept for existing tests. */
export function buildLivePreviewTableDecorations(
  view: EditorView,
): DecorationSet {
  return buildTableDecorations(view.state);
}

const tableDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state);
  },
  update(deco, tr) {
    const activeChanged = tr.effects.some((effect) =>
      effect.is(setActiveTableCellEffect),
    );
    if (tr.docChanged || activeChanged) {
      return buildTableDecorations(tr.state);
    }
    return deco;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

const tableFocusPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      const activeChanged =
        update.startState.field(activeTableCellField, false) !==
        update.state.field(activeTableCellField, false);
      if (activeChanged || update.docChanged) {
        requestAnimationFrame(() => focusActiveCell(update.view));
      }
    }
  },
);

export const livePreviewTables: Extension = [
  activeTableCellField,
  tableDecorationsField,
  tableFocusPlugin,
];
