/**
 * Live Preview block widgets for GFM pipe tables.
 * Tables stay rendered while editing; cells use contenteditable for in-place edits.
 *
 * Block replacements are provided via StateField (CodeMirror requirement).
 */

import {
  RangeSetBuilder,
  Prec,
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
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { isolateHistory, redo, undo } from "@codemirror/commands";
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
  setTableCells,
  getCellContentRanges,
  locateCellInLine,
  escapeTableCellText,
  moveRow,
  moveColumn,
  setColumnAlignment,
  type ColumnAlignment,
  type MarkdownTable,
} from "../../../utils/markdownTable";
import { renderMarkdown } from "../../../utils/markdown";
import { useAppStore } from "../../../store/appStore";
import { isImeComposingEvent } from "../../../utils/imeKeyboard";
import { t } from "../../../utils/i18n";
import {
  defineLivePreviewBlockDecorationField,
  getCachedMarkdownHtml,
  mergeCoverageRanges,
  scheduleLivePreviewMeasure,
  bindLivePreviewWidgetResizeMeasure,
  hasSkipAncestor,
  selectionTouchesRange,
  type BlockDecorationBuild,
  type CoverageRange,
} from "./shared";
import { livePreviewBlockReason, SoftOffPlaceholderWidget } from "./softOff";
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
  anchorRow?: number;
  anchorCol?: number;
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
      const located = tableAtDocPos({ state: tr.state }, from);
      if (!located) return null;
      const clampRow = (row: number) =>
        Math.max(0, Math.min(row, logicalRowCount(located.table) - 1));
      const clampCol = (col: number) =>
        Math.max(0, Math.min(col, located.table.columnCount - 1));
      // 撤销结构修改后，活动格和矩形锚点可能已超出还原后的表格。
      return {
        ...value,
        from: located.from,
        to: located.to,
        logicalRow: clampRow(value.logicalRow),
        col: clampCol(value.col),
        ...(value.anchorRow === undefined
          ? {}
          : { anchorRow: clampRow(value.anchorRow) }),
        ...(value.anchorCol === undefined
          ? {}
          : { anchorCol: clampCol(value.anchorCol) }),
      };
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
  if (a === "center" || a === "right") {
    return `text-align:${a}`;
  }
  // GFM `| --- |` ("none") and `:---` ("left"): keep header and body aligned.
  return "text-align:left";
}

function tableAtDocPos(
  view: Pick<EditorView, "state">,
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
  options: { preserveSelection?: boolean } = {},
): boolean {
  const located = tableAtDocPos(view, tableFrom);
  if (!located) return false;

  const { table: nextTable, active } = mutate(located.table);
  const serialized = serializeTable(nextTable);
  const insert = serialized.join("\n");
  const nextTo = located.from + insert.length;

  // Blur / Escape commits clear the active cell — do not yank the caret back to
  // the table start after the user clicked elsewhere (CM will map selection).
  const preserveSelection = options.preserveSelection === true || !active;

  view.dispatch({
    ...(view.state.doc.sliceString(located.from, located.to) === insert
      ? {}
      : { changes: { from: located.from, to: located.to, insert } }),
    ...(preserveSelection ? {} : { selection: { anchor: located.from } }),
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
    userEvent: "input.table.structure",
    annotations: isolateHistory.of("full"),
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
  const located = tableAtDocPos(view, tableFrom);
  if (!located) return false;
  const current =
    logicalRow === 0
      ? located.table.header[col]
      : located.table.body[logicalRow - 1]?.[col];
  if ((current ?? "") === value.trim()) {
    view.dispatch({
      effects: setActiveTableCellEffect.of(
        nextActive
          ? { from: located.from, to: located.to, ...nextActive }
          : null,
      ),
      scrollIntoView: false,
    });
    return true;
  }
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
      case "moveRowUp":
      case "moveRowDown": {
        const direction = op === "moveRowUp" ? "up" : "down";
        const moved = moveRow(withValue, logicalRow, direction);
        if (moved) {
          nextTable = moved;
          nextRow += direction === "up" ? -1 : 1;
        }
        break;
      }
      case "moveColumnLeft":
      case "moveColumnRight": {
        const direction = op === "moveColumnLeft" ? "left" : "right";
        const moved = moveColumn(withValue, col, direction);
        if (moved) {
          nextTable = moved;
          nextCol += direction === "left" ? -1 : 1;
        }
        break;
      }
      case "alignLeft":
      case "alignCenter":
      case "alignRight":
        nextTable = setColumnAlignment(
          withValue,
          col,
          op === "alignLeft"
            ? "left"
            : op === "alignCenter"
              ? "center"
              : "right",
        );
        break;
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

/** 单元格输入直接进入正文事务，更新时保留原生输入节点和组合选区。 */
function syncEditingCell(
  view: EditorView,
  cell: HTMLElement,
  firstInput = false,
): void {
  const tableFrom = Number(cell.dataset.mpTableFrom);
  const located = tableAtDocPos(view, tableFrom);
  if (!located) return;
  const row = Number(cell.dataset.mpRow);
  const col = Number(cell.dataset.mpCol);
  const lineNumber = located.table.startLine + (row === 0 ? 0 : row + 1) + 1;
  const line = view.state.doc.line(lineNumber);
  const range = getCellContentRanges(line.text)[col];
  if (!range) return;
  const from = line.from + range.from;
  const to = Math.max(from, line.from + range.to);
  const insert = escapeTableCellText(readEditingCellValue(cell).trim());
  if (view.state.doc.sliceString(from, to) === insert) return;
  view.dispatch({
    changes: { from, to, insert },
    userEvent: "input.type",
    annotations: firstInput ? isolateHistory.of("before") : [],
    scrollIntoView: false,
  });
}

/** 保存和切换文档前也读取当前单元格，覆盖输入事件尚未送达的边界。 */
export function flushLiveTableInput(view: EditorView): void {
  const cell = view.dom.querySelector<HTMLElement>(
    ".cm-live-preview-table-cell-editing",
  );
  if (cell) syncEditingCell(view, cell);
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

function insertCellText(cell: HTMLElement, text: string): void {
  const selection = cell.ownerDocument.getSelection();
  if (!selection?.rangeCount || !cell.contains(selection.anchorNode)) {
    cell.append(document.createTextNode(text));
    placeCaretAtEnd(cell);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
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
    readonly activeCell: Pick<
      ActiveTableCell,
      "logicalRow" | "col" | "anchorRow" | "anchorCol"
    > | null,
  ) {
    super();
  }

  eq(other: TableWidget) {
    return (
      this.from === other.from &&
      this.to === other.to &&
      this.activeCell?.logicalRow === other.activeCell?.logicalRow &&
      this.activeCell?.col === other.activeCell?.col &&
      this.activeCell?.anchorRow === other.activeCell?.anchorRow &&
      this.activeCell?.anchorCol === other.activeCell?.anchorCol &&
      this.header.join("\0") === other.header.join("\0") &&
      this.alignments.join("\0") === other.alignments.join("\0") &&
      this.body.map((row) => row.join("\0")).join("\n") ===
        other.body.map((row) => row.join("\0")).join("\n")
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    if (
      !this.activeCell ||
      dom.dataset.mpActiveRow !== String(this.activeCell.logicalRow) ||
      dom.dataset.mpActiveCol !== String(this.activeCell.col) ||
      dom.querySelectorAll("tr").length !== this.body.length + 1 ||
      dom.querySelectorAll("th").length !== this.header.length
    )
      return false;
    dom.dataset.mpTableFrom = String(this.from);
    for (const cell of dom.querySelectorAll<HTMLElement>("th,td")) {
      cell.dataset.mpTableFrom = String(this.from);
      const row = Number(cell.dataset.mpRow);
      const col = Number(cell.dataset.mpCol);
      const value = row === 0 ? this.header[col] : this.body[row - 1]?.[col];
      if (value === undefined) return false;
      if (cell.contentEditable === "true") {
        if (
          !cell.dataset.mpComposing &&
          readEditingCellValue(cell).trim() !== value.trim()
        ) {
          cell.textContent = value;
          if (cell.ownerDocument.activeElement === cell) placeCaretAtEnd(cell);
        }
      } else {
        const html = renderInlineCell(value) || "&nbsp;";
        if (cell.innerHTML !== html) cell.innerHTML = html;
      }
      this.markSelection(cell, row, col);
      cell.style.textAlign =
        this.alignments[col] === "none" ? "left" : this.alignments[col];
    }
    return true;
  }

  private markSelection(cell: HTMLElement, row: number, col: number): void {
    const active = this.activeCell;
    const selected =
      active?.anchorRow !== undefined &&
      active.anchorCol !== undefined &&
      row >= Math.min(active.logicalRow, active.anchorRow) &&
      row <= Math.max(active.logicalRow, active.anchorRow) &&
      col >= Math.min(active.col, active.anchorCol) &&
      col <= Math.max(active.col, active.anchorCol);
    cell.classList.toggle(
      "cm-live-preview-table-cell-selected",
      Boolean(selected),
    );
    if (selected) cell.setAttribute("aria-selected", "true");
    else cell.removeAttribute("aria-selected");
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-preview-table-wrap";
    wrap.setAttribute("contenteditable", "false");
    wrap.dataset.mpTableFrom = String(this.from);
    if (this.activeCell) {
      wrap.dataset.mpActiveRow = String(this.activeCell.logicalRow);
      wrap.dataset.mpActiveCol = String(this.activeCell.col);
    }

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

    // Reflow (pane width / wrapped cells / edit growth) must remasure CM maps.
    bindLivePreviewWidgetResizeMeasure(view, wrap);

    wrap.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("th, td")) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        const pos = view.posAtDOM(wrap);
        view.focus();
        view.dispatch({
          selection: { anchor: pos },
          scrollIntoView: false,
        });
      } catch {
        // Keep the current caret if the widget is mid-detach.
      }
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
      this.markSelection(cell, logicalRow, col);
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
      cell.setAttribute("role", "textbox");
      cell.setAttribute(
        "aria-label",
        t(useAppStore.getState().settings.language, "table_cellPosition", {
          row: logicalRow + 1,
          col: col + 1,
        }),
      );
      cell.textContent = rawText;
      const remasure = () => scheduleLivePreviewMeasure(view);
      // contenteditable wrap changes height without updating the doc — remasure
      // so following lines do not cover the bottom of the cell / focus ring.
      let firstInput = true;
      cell.addEventListener("input", () => {
        syncEditingCell(view, cell, firstInput);
        firstInput = false;
        remasure();
      });
      cell.addEventListener("beforeinput", remasure);
      cell.addEventListener("compositionstart", () => {
        cell.dataset.mpComposing = "true";
      });
      cell.addEventListener("compositionend", () => {
        delete cell.dataset.mpComposing;
        syncEditingCell(view, cell, firstInput);
        firstInput = false;
        remasure();
      });
      cell.addEventListener("paste", (event) =>
        this.onCellPaste(view, cell, logicalRow, col, event),
      );
      cell.addEventListener("copy", (event) => this.onCellCopy(view, event));
      cell.addEventListener("cut", (event) => this.onCellCopy(view, event));
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
            activeField.from !== Number(cell.dataset.mpTableFrom) ||
            activeField.logicalRow !== logicalRow ||
            activeField.col !== col
          ) {
            return;
          }
          commitCellValue(
            view,
            Number(cell.dataset.mpTableFrom),
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
      const located = tableAtDocPos(view, Number(cell.dataset.mpTableFrom));
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
        tableFrom: Number(cell.dataset.mpTableFrom),
        logicalRow,
        col,
        canDeleteColumn: located.table.columnCount > 1,
        rowCount: logicalRowCount(located.table),
        columnCount: located.table.columnCount,
        readValue: () => {
          const current = view.dom.querySelector(
            `.cm-live-preview-table-cell-editing`,
          ) as HTMLElement | null;
          return current ? readEditingCellValue(current) : value;
        },
        apply: (op, nextValue) => {
          applyLiveTableStructureOp(
            view,
            Number(cell.dataset.mpTableFrom),
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
      if (isEditing && !event.shiftKey) {
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
        event.shiftKey,
      );
    });
  }

  private onCellCopy(view: EditorView, event: ClipboardEvent): void {
    const active = view.state.field(activeTableCellField);
    if (
      !active ||
      active.anchorRow === undefined ||
      active.anchorCol === undefined
    )
      return;
    const located = tableAtDocPos(view, active.from);
    if (!located || !event.clipboardData) return;
    event.preventDefault();
    event.stopPropagation();
    const top = Math.min(active.logicalRow, active.anchorRow);
    const bottom = Math.max(active.logicalRow, active.anchorRow);
    const left = Math.min(active.col, active.anchorCol);
    const right = Math.max(active.col, active.anchorCol);
    const values = [located.table.header, ...located.table.body]
      .slice(top, bottom + 1)
      .map((row) => row.slice(left, right + 1));
    event.clipboardData.setData(
      "text/plain",
      values.map((row) => row.join("\t")).join("\n"),
    );
    event.clipboardData.setData(
      "text/html",
      `<table>${values.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</table>`,
    );
    if (event.type === "cut") {
      dispatchTableRewrite(view, active.from, (table) => {
        let next = table;
        for (let row = top; row <= bottom; row++) {
          for (let col = left; col <= right; col++)
            next = setTableCell(next, row, col, "");
        }
        return { table: next, active };
      });
    }
  }

  private onCellPaste(
    view: EditorView,
    cell: HTMLElement,
    row: number,
    col: number,
    event: ClipboardEvent,
  ): void {
    const tableFrom = Number(cell.dataset.mpTableFrom);
    const text = event.clipboardData?.getData("text/plain");
    if (text === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (!/[\t\r\n]/.test(text)) {
      insertCellText(cell, text);
      syncEditingCell(view, cell, true);
      return;
    }
    const rows = text
      .replace(/\r\n?/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.split("\t"));
    syncEditingCell(view, cell);
    let showSource = false;
    dispatchTableRewrite(view, tableFrom, (table) => {
      const next = setTableCells(table, row, col, rows);
      const rowCount = logicalRowCount(next);
      const chars = [next.header, ...next.body].reduce(
        (total, cells) =>
          total + cells.reduce((sum, value) => sum + value.length, 0),
        rowCount * (next.columnCount * 3 + 2),
      );
      showSource = Boolean(
        livePreviewBlockReason("table", chars, rowCount * next.columnCount),
      );
      return {
        table: next,
        active: showSource
          ? null
          : { from: tableFrom, to: this.to, logicalRow: row, col },
      };
    });
    if (showSource) view.focus();
  }

  private activateCell(
    view: EditorView,
    logicalRow: number,
    col: number,
    wrap: Element | null,
    extend = false,
  ) {
    const tableFrom = Number(
      (wrap as HTMLElement | null)?.dataset.mpTableFrom ?? this.from,
    );
    const editing = wrap?.querySelector(
      ".cm-live-preview-table-cell-editing",
    ) as HTMLElement | null;

    if (editing && !extend) {
      const prevRow = Number(editing.dataset.mpRow);
      const prevCol = Number(editing.dataset.mpCol);
      commitCellValue(
        view,
        tableFrom,
        prevRow,
        prevCol,
        readEditingCellValue(editing),
        { logicalRow, col },
      );
      return;
    }

    if (editing) syncEditingCell(view, editing);
    const located = tableAtDocPos(view, tableFrom);
    if (!located) return;
    const previous = view.state.field(activeTableCellField);

    view.dispatch({
      selection: { anchor: tableFrom },
      effects: setActiveTableCellEffect.of({
        from: tableFrom,
        to: located.to,
        logicalRow,
        col,
        ...(extend && previous
          ? {
              anchorRow: previous.anchorRow ?? previous.logicalRow,
              anchorCol: previous.anchorCol ?? previous.col,
            }
          : {}),
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
    const tableFrom = Number(cell.dataset.mpTableFrom);
    if (isImeComposingEvent(event)) return;
    const value = readEditingCellValue(cell);
    const mod = isMod(event);

    // WKWebView 的默认全选会离开嵌套编辑区域，后续快捷键便作用到外层正文。
    if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      const selection = cell.ownerDocument.getSelection();
      const range = cell.ownerDocument.createRange();
      range.selectNodeContents(cell);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    if (mod && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopPropagation();
      syncEditingCell(view, cell);
      if (event.key.toLowerCase() === "y" || event.shiftKey) redo(view);
      else undo(view);
      return;
    }
    if (mod && ["b", "i", "k", "`"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopPropagation();
      const marker =
        event.key.toLowerCase() === "b"
          ? "**"
          : event.key.toLowerCase() === "i"
            ? "*"
            : "`";
      const selected = cell.ownerDocument.getSelection();
      if (!selected?.rangeCount || !cell.contains(selected.anchorNode)) return;
      const range = selected.getRangeAt(0);
      const text = range.toString();
      const leading = range.cloneRange();
      leading.selectNodeContents(cell);
      leading.setEnd(range.startContainer, range.startOffset);
      const prefix = leading.toString();
      const suffix = readEditingCellValue(cell).slice(
        prefix.length + text.length,
      );
      const link = event.key.toLowerCase() === "k";
      const unwrap =
        !link && prefix.endsWith(marker) && suffix.startsWith(marker);
      const selectedWrapped =
        !link &&
        text.length >= marker.length * 2 &&
        text.startsWith(marker) &&
        text.endsWith(marker);
      const inner = selectedWrapped
        ? text.slice(marker.length, -marker.length)
        : text;
      const replacement = link
        ? `[${text}](url)`
        : unwrap || selectedWrapped
          ? inner
          : `${marker}${text}${marker}`;
      const before = unwrap ? prefix.slice(0, -marker.length) : prefix;
      const after = unwrap ? suffix.slice(marker.length) : suffix;
      cell.textContent = before + replacement + after;
      const node =
        cell.firstChild ?? cell.appendChild(document.createTextNode(""));
      const selectionStart =
        before.length +
        (link
          ? text.length + 3
          : unwrap || selectedWrapped
            ? 0
            : marker.length);
      const selectionLength = link ? 3 : inner.length;
      range.setStart(node, selectionStart);
      range.setEnd(node, selectionStart + selectionLength);
      selected.removeAllRanges();
      selected.addRange(range);
      syncEditingCell(view, cell);
      return;
    }
    if (event.key === "Enter" && event.shiftKey && !mod && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      insertCellText(cell, "<br>");
      syncEditingCell(view, cell);
      return;
    }
    if (!mod && !event.altKey && event.key.startsWith("Arrow")) {
      const selection = cell.ownerDocument.getSelection();
      if (selection && !selection.isCollapsed && !event.shiftKey) return;
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const before = range?.cloneRange();
      before?.selectNodeContents(cell);
      if (range) before?.setEnd(range.startContainer, range.startOffset);
      const offset = before?.toString().length ?? 0;
      const atStart = offset === 0;
      const atEnd = offset === readEditingCellValue(cell).length;
      const horizontal =
        event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (
        (event.shiftKey &&
          view.state.field(activeTableCellField)?.anchorRow !== undefined) ||
        (!horizontal && (atStart || atEnd)) ||
        (event.key === "ArrowLeft" && atStart) ||
        (event.key === "ArrowRight" && atEnd)
      ) {
        const located = tableAtDocPos(view, tableFrom);
        if (!located) return;
        const row =
          logicalRow +
          (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0);
        const column =
          col +
          (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0);
        if (
          row >= 0 &&
          row < logicalRowCount(located.table) &&
          column >= 0 &&
          column < located.table.columnCount
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.activateCell(
            view,
            row,
            column,
            cell.closest(".cm-live-preview-table-wrap"),
            event.shiftKey,
          );
          return;
        }
        if (
          !event.shiftKey &&
          (row < 0 || row >= logicalRowCount(located.table))
        ) {
          event.preventDefault();
          event.stopPropagation();
          syncEditingCell(view, cell);
          const position =
            row < 0
              ? Math.max(0, located.from - 1)
              : Math.min(view.state.doc.length, located.to + 1);
          view.dispatch({
            selection: { anchor: position },
            effects: setActiveTableCellEffect.of(null),
            scrollIntoView: false,
          });
          view.focus();
          return;
        }
      }
    }

    // Structural shortcuts (same as source Phase A + delete).
    if (event.key === "Enter" && mod && event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      applyLiveTableStructureOp(
        view,
        tableFrom,
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
        tableFrom,
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
        tableFrom,
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
        tableFrom,
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
        tableFrom,
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
        tableFrom,
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
      commitCellValue(view, tableFrom, logicalRow, col, value, null);
      view.focus();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const located = tableAtDocPos(view, tableFrom);
      if (!located) return;
      const draft = setTableCell(located.table, logicalRow, col, value);

      if (event.shiftKey) {
        const prev = prevCell(draft, logicalRow, col);
        commitCellValue(
          view,
          tableFrom,
          logicalRow,
          col,
          value,
          prev ? { logicalRow: prev.logicalRow, col: prev.col } : null,
        );
        return;
      }

      const nav = nextCell(draft, logicalRow, col);
      if (nav.appendRow) {
        dispatchTableRewrite(view, tableFrom, (table) => {
          const withValue = setTableCell(table, logicalRow, col, value);
          const withRow = insertRowBelow(
            withValue,
            logicalRowCount(withValue) - 1,
          );
          return {
            table: withRow,
            active: {
              from: tableFrom,
              to: tableFrom,
              logicalRow: nav.logicalRow,
              col: nav.col,
            },
          };
        });
        return;
      }

      commitCellValue(view, tableFrom, logicalRow, col, value, {
        logicalRow: nav.logicalRow,
        col: nav.col,
      });
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !mod && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const located = tableAtDocPos(view, tableFrom);
      if (!located) return;
      const draft = setTableCell(located.table, logicalRow, col, value);
      const rows = logicalRowCount(draft);
      if (logicalRow + 1 < rows) {
        commitCellValue(view, tableFrom, logicalRow, col, value, {
          logicalRow: logicalRow + 1,
          col,
        });
        return;
      }
      dispatchTableRewrite(view, tableFrom, (table) => {
        const withValue = setTableCell(table, logicalRow, col, value);
        const withRow = insertRowBelow(withValue, logicalRow);
        return {
          table: withRow,
          active: {
            from: tableFrom,
            to: tableFrom,
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
  const activeCell = active && active.from === from ? active : null;
  return new TableWidget(
    from,
    to,
    table.header,
    table.alignments,
    table.body,
    activeCell,
  );
}

export function buildTableDecorations(
  state: EditorState,
  scanRanges?: readonly CoverageRange[],
): DecorationSet {
  return buildTableDecorationBuild(state, scanRanges).decorations;
}

function buildTableDecorationBuild(
  state: EditorState,
  scanRanges?: readonly CoverageRange[],
): BlockDecorationBuild {
  const coverage: CoverageRange[] = [];
  const builder = new RangeSetBuilder<Decoration>();
  const seen = new Set<number>();
  const active = state.field(activeTableCellField, false) ?? null;
  const tables: MarkdownTable[] = [];
  for (const scan of scanRanges?.length
    ? scanRanges
    : [{ from: 0, to: state.doc.length }]) {
    let lineNumber = state.doc.lineAt(Math.max(0, scan.from)).number;
    const endLine = state.doc.lineAt(
      Math.min(state.doc.length, scan.to),
    ).number;
    while (lineNumber <= endLine) {
      if (
        seen.has(lineNumber) ||
        !isTablePartLine(state.doc.line(lineNumber).text)
      ) {
        lineNumber++;
        continue;
      }
      let first = lineNumber;
      let last = lineNumber;
      while (first > 1 && isTablePartLine(state.doc.line(first - 1).text))
        first--;
      while (
        last < state.doc.lines &&
        isTablePartLine(state.doc.line(last + 1).text)
      )
        last++;
      const lines: string[] = [];
      for (let n = first; n <= last; n++) {
        lines.push(state.doc.line(n).text);
        seen.add(n);
      }
      const table = findTableAt(lines, 0);
      if (table)
        tables.push({ ...table, startLine: first - 1, endLine: last - 1 });
      lineNumber = last + 1;
    }
  }
  tables.sort((a, b) => a.startLine - b.startLine);
  for (const table of tables) {
    const from = state.doc.line(table.startLine + 1).from;
    const to = state.doc.line(table.endLine + 1).to;
    if (hasSkipAncestor(state, from)) continue;
    coverage.push({ from, to });
    const reason =
      active?.from === from
        ? null
        : livePreviewBlockReason(
            "table",
            to - from,
            logicalRowCount(table) * table.columnCount,
          );
    if (reason) {
      if (selectionTouchesRange(state, from, to)) continue;
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

  return { decorations: builder.finish(), coverage };
}

function expandTableChangedRanges(
  state: EditorState,
  ranges: readonly CoverageRange[],
): CoverageRange[] {
  const expanded: CoverageRange[] = [];
  for (const range of ranges) {
    try {
      let start = state.doc.lineAt(range.from).number;
      let end = state.doc.lineAt(
        Math.max(range.from, Math.min(range.to, state.doc.length)),
      ).number;
      while (start > 1 && isTablePartLine(state.doc.line(start - 1).text)) {
        start -= 1;
      }
      while (
        end < state.doc.lines &&
        isTablePartLine(state.doc.line(end + 1).text)
      ) {
        end += 1;
      }
      expanded.push({
        from: state.doc.line(start).from,
        to: state.doc.line(end).to,
      });
    } catch {
      expanded.push(range);
    }
  }
  return mergeCoverageRanges(expanded);
}

/** @deprecated Prefer buildTableDecorations(state); kept for existing tests. */
export function buildLivePreviewTableDecorations(
  view: EditorView,
): DecorationSet {
  return buildTableDecorations(view.state);
}

const tableDecorationsField = defineLivePreviewBlockDecorationField({
  rebuildDuringPointer: true,
  create: (state) => buildTableDecorationBuild(state),
  createInRanges: (state, ranges) => buildTableDecorationBuild(state, ranges),
  expandChangedRanges: expandTableChangedRanges,
  rebuildOn: (tr) =>
    tr.effects.some((effect) => effect.is(setActiveTableCellEffect)),
  rebuildOnContextChange: false,
});

const tableFocusPlugin = ViewPlugin.fromClass(
  class {
    private frame = 0;

    update(update: ViewUpdate) {
      const activeChanged =
        update.startState.field(activeTableCellField, false) !==
        update.state.field(activeTableCellField, false);
      if (activeChanged || update.docChanged) {
        if (this.frame) cancelAnimationFrame(this.frame);
        const { view } = update;
        const state = view.state;
        const ownerDocument = view.dom.ownerDocument;
        const activeElement = ownerDocument.activeElement;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          // 单元格重建会丢失原 DOM 焦点；只恢复这一次重建，不能抢回用户后来转移的焦点。
          const focusStayed =
            ownerDocument.activeElement === activeElement ||
            (activeElement &&
              !activeElement.isConnected &&
              ownerDocument.activeElement === ownerDocument.body);
          if (
            !view.dom.isConnected ||
            view.state.doc !== state.doc ||
            !view.state.selection.eq(state.selection) ||
            view.state.field(activeTableCellField, false) !==
              state.field(activeTableCellField, false) ||
            !focusStayed ||
            view.dom.closest('[aria-hidden="true"]')
          )
            return;
          focusActiveCell(view);
        });
      }
    }

    destroy() {
      if (this.frame) cancelAnimationFrame(this.frame);
    }
  },
);

export const livePreviewTables: Extension = [
  activeTableCellField,
  tableDecorationsField,
  tableFocusPlugin,
  Prec.high(
    keymap.of(
      ["ArrowDown", "ArrowUp", "Enter", "Tab"].map((key) => ({
        key,
        run: (view: EditorView) => {
          if (
            view.composing ||
            view.compositionStarted ||
            !view.state.selection.main.empty
          )
            return false;
          const head = view.state.selection.main.head;
          const line = view.state.doc.lineAt(head);
          let located = tableAtDocPos(view, head);
          let targetLine = line;
          if (!located && (key === "ArrowDown" || key === "ArrowUp")) {
            const n = line.number + (key === "ArrowDown" ? 1 : -1);
            if (
              n < 1 ||
              n > view.state.doc.lines ||
              (key === "ArrowDown" ? head !== line.to : head !== line.from)
            )
              return false;
            targetLine = view.state.doc.line(n);
            located = tableAtDocPos(view, targetLine.from);
          }
          if (
            !located ||
            hasSkipAncestor(view.state, located.from) ||
            livePreviewBlockReason(
              "table",
              located.to - located.from,
              logicalRowCount(located.table) * located.table.columnCount,
            )
          )
            return false;
          const row = Math.max(
            0,
            targetLine.number - located.table.startLine - 2,
          );
          const col =
            targetLine === line
              ? (locateCellInLine(line.text, line.from, head)?.col ?? 0)
              : 0;
          view.dispatch({
            selection: { anchor: located.from },
            effects: setActiveTableCellEffect.of({
              from: located.from,
              to: located.to,
              logicalRow: row,
              col,
            }),
            scrollIntoView: false,
          });
          return true;
        },
      })),
    ),
  ),
];
