/**
 * Hover-grid picker for inserting a GFM table (rows × columns, header included).
 */

import { EditorView } from "@codemirror/view";
import { useAppStore } from "../../../store/appStore";
import { t } from "../../../utils/i18n";
import {
  clampTableInsertSize,
  TABLE_INSERT_DEFAULT_COLS,
  TABLE_INSERT_DEFAULT_ROWS,
  TABLE_INSERT_PICKER_MAX_COLS,
  TABLE_INSERT_PICKER_MAX_ROWS,
} from "../../../utils/tableInsert";
import { insertMarkdownTable, isInMarkdownTable } from "./tables";
import { isInsideFencedCode } from "./core";

let openPicker: HTMLElement | null = null;
let removeListeners: (() => void) | null = null;

export function closeTableInsertPicker(): void {
  removeListeners?.();
  removeListeners = null;
  openPicker?.remove();
  openPicker = null;
}

function placePicker(picker: HTMLElement, view: EditorView): void {
  const pos = view.state.selection.main.head;
  const coords =
    view.coordsAtPos(pos) ?? view.contentDOM.getBoundingClientRect();
  const margin = 8;
  const width = picker.offsetWidth || 220;
  const height = picker.offsetHeight || 180;
  let left = coords.left;
  let top = coords.bottom + 6;
  left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, coords.top - height - 6);
  }
  picker.style.left = `${Math.round(left)}px`;
  picker.style.top = `${Math.round(top)}px`;
}

export function openTableInsertPicker(view: EditorView): void {
  closeTableInsertPicker();

  const pos = view.state.selection.main.head;
  if (
    isInsideFencedCode(view.state, pos) ||
    isInMarkdownTable(view.state, pos)
  ) {
    return;
  }

  const language = useAppStore.getState().settings.language;
  let selected = clampTableInsertSize(
    TABLE_INSERT_DEFAULT_ROWS,
    TABLE_INSERT_DEFAULT_COLS,
  );

  const picker = document.createElement("div");
  picker.className = "cm-table-insert-picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", t(language, "table_insert"));
  picker.tabIndex = -1;

  const title = document.createElement("div");
  title.className = "cm-table-insert-picker-title";
  title.textContent = t(language, "table_insert");

  const status = document.createElement("div");
  status.className = "cm-table-insert-picker-status";
  status.setAttribute("aria-live", "polite");

  const grid = document.createElement("div");
  grid.className = "cm-table-insert-picker-grid";
  grid.style.gridTemplateColumns = `repeat(${TABLE_INSERT_PICKER_MAX_COLS}, 1.15rem)`;

  const cells: HTMLButtonElement[] = [];

  const commit = (size = selected) => {
    const next = clampTableInsertSize(size.visualRows, size.cols);
    closeTableInsertPicker();
    insertMarkdownTable(view.state, (tr) => view.dispatch(tr), next);
    view.focus();
  };

  const paint = () => {
    status.textContent = t(language, "table_insertSize", {
      rows: selected.visualRows,
      cols: selected.cols,
    });
    for (const cell of cells) {
      const r = Number(cell.dataset.row);
      const c = Number(cell.dataset.col);
      cell.classList.toggle(
        "is-active",
        r <= selected.visualRows && c <= selected.cols,
      );
    }
  };

  for (let row = 1; row <= TABLE_INSERT_PICKER_MAX_ROWS; row += 1) {
    for (let col = 1; col <= TABLE_INSERT_PICKER_MAX_COLS; col += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cm-table-insert-picker-cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute(
        "aria-label",
        t(language, "table_insertSize", { rows: row, cols: col }),
      );
      cell.addEventListener("mouseenter", () => {
        selected = clampTableInsertSize(row, col);
        paint();
      });
      cell.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        commit(clampTableInsertSize(row, col));
      });
      cells.push(cell);
      grid.appendChild(cell);
    }
  }

  picker.append(title, grid, status);
  document.body.appendChild(picker);
  openPicker = picker;
  paint();
  placePicker(picker, view);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!openPicker) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeTableInsertPicker();
      view.focus();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    let rows = selected.visualRows;
    let cols = selected.cols;
    if (event.key === "ArrowRight") cols += 1;
    else if (event.key === "ArrowLeft") cols -= 1;
    else if (event.key === "ArrowDown") rows += 1;
    else if (event.key === "ArrowUp") rows -= 1;
    else return;
    event.preventDefault();
    selected = clampTableInsertSize(
      Math.min(rows, TABLE_INSERT_PICKER_MAX_ROWS),
      Math.min(cols, TABLE_INSERT_PICKER_MAX_COLS),
    );
    paint();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (openPicker?.contains(event.target as Node)) return;
    closeTableInsertPicker();
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("resize", closeTableInsertPicker);
  view.scrollDOM.addEventListener("scroll", closeTableInsertPicker, {
    passive: true,
  });

  removeListeners = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("resize", closeTableInsertPicker);
    view.scrollDOM.removeEventListener("scroll", closeTableInsertPicker);
  };

  requestAnimationFrame(() => {
    picker.focus();
  });
}
