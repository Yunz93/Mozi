/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { tableLiveOverlay } from "./tableLiveOverlay";
import { useAppStore } from "../../store/appStore";

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown(), tableLiveOverlay],
    }),
    parent,
  });
}

function focusBodyCell(
  view: EditorView,
  row: number,
  col: number,
): HTMLElement {
  const cell = view.dom.querySelector<HTMLElement>(
    `.mp-live-table-cell[data-row="${row}"][data-col="${col}"]`,
  );
  expect(cell).not.toBeNull();
  cell!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  cell!.focus();
  return cell!;
}

function openContextMenu(cell: HTMLElement): void {
  cell.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }),
  );
}

function clickContextMenuItem(label: string): void {
  const items = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".mp-live-table-menu-item"),
  );
  const item = items.find((button) => button.textContent === label) ?? null;
  expect(item).not.toBeNull();
  item!.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
}

describe("tableLiveOverlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders an editable HTML table over GFM pipe source without a toolbar", () => {
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |"].join("\n"),
    );

    const wrap = view.dom.querySelector(".mp-live-table-wrap");
    expect(wrap).not.toBeNull();
    expect(view.dom.querySelector(".mp-live-table-toolbar")).toBeNull();
    expect(view.dom.querySelector(".mp-live-table-tool-btn")).toBeNull();
    expect(view.dom.querySelector(".mp-live-table-hint")).toBeNull();
    expect(view.dom.querySelectorAll(".mp-live-table-cell").length).toBe(4);
    expect(view.dom.textContent).toContain("Ada");
    expect(view.dom.textContent).toContain("36");

    view.destroy();
  });

  it("inserts a row via the context menu", () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, language: "en" },
    }));
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |"].join("\n"),
    );

    const cell = focusBodyCell(view, 1, 0);
    openContextMenu(cell);
    clickContextMenuItem("Insert row below");

    expect(view.state.doc.toString()).toContain("|  |  |");
    expect(view.dom.querySelectorAll(".mp-live-table tr").length).toBe(3);

    view.destroy();
  });

  it("inserts and deletes columns via the context menu", () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, language: "en" },
    }));
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |"].join("\n"),
    );

    const header = focusBodyCell(view, 0, 0);
    openContextMenu(header);
    clickContextMenuItem("Insert column right");
    expect(view.state.doc.toString().split("\n")[0]).toBe("| Name |  | Age |");
    expect(view.dom.querySelectorAll(".mp-live-table-cell").length).toBe(6);

    const emptyCol = focusBodyCell(view, 0, 1);
    openContextMenu(emptyCol);
    clickContextMenuItem("Delete column");
    expect(view.state.doc.toString().split("\n")[0]).toBe("| Name | Age |");
    expect(view.dom.querySelectorAll(".mp-live-table-cell").length).toBe(4);

    view.destroy();
  });

  it("deletes a body row via the context menu after focusing that row", () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, language: "en" },
    }));
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |", "| Bob | 28 |"].join(
        "\n",
      ),
    );

    const cell = focusBodyCell(view, 1, 0);
    openContextMenu(cell);
    clickContextMenuItem("Delete row");

    const doc = view.state.doc.toString();
    expect(doc).not.toContain("Ada");
    expect(doc).toContain("Bob");
    expect(view.dom.querySelectorAll(".mp-live-table tr").length).toBe(2);

    view.destroy();
  });

  it("does not overlay tables inside fenced code", () => {
    const view = createView(
      ["```", "| A | B |", "| --- | --- |", "| 1 | 2 |", "```"].join("\n"),
    );

    expect(view.dom.querySelector(".mp-live-table-wrap")).toBeNull();
    view.destroy();
  });
});
