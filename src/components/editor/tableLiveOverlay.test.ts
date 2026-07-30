/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { tableLiveOverlay } from "./tableLiveOverlay";

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

function toolbarButton(
  view: EditorView,
  label: string,
): HTMLButtonElement | null {
  const buttons = Array.from(
    view.dom.querySelectorAll<HTMLButtonElement>(".mp-live-table-tool-btn"),
  );
  return buttons.find((button) => button.textContent === label) ?? null;
}

function clickToolbar(view: EditorView, label: string): void {
  const button = toolbarButton(view, label);
  expect(button).not.toBeNull();
  button!.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
}

function focusBodyCell(view: EditorView, row: number, col: number): void {
  const cell = view.dom.querySelector<HTMLElement>(
    `.mp-live-table-cell[data-row="${row}"][data-col="${col}"]`,
  );
  expect(cell).not.toBeNull();
  cell!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  cell!.focus();
}

describe("tableLiveOverlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders an editable HTML table over GFM pipe source", () => {
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |"].join("\n"),
    );

    const wrap = view.dom.querySelector(".mp-live-table-wrap");
    expect(wrap).not.toBeNull();
    expect(view.dom.querySelectorAll(".mp-live-table-cell").length).toBe(4);
    expect(view.dom.textContent).toContain("Ada");
    expect(view.dom.textContent).toContain("36");

    view.destroy();
  });

  it("inserts a row via the toolbar button", () => {
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |"].join("\n"),
    );

    clickToolbar(view, "+R");

    expect(view.state.doc.toString()).toContain("|  |  |");
    expect(view.dom.querySelectorAll(".mp-live-table tr").length).toBe(3);

    view.destroy();
  });

  it("inserts and deletes columns via toolbar buttons", () => {
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |"].join("\n"),
    );

    clickToolbar(view, "+C");
    // +C inserts to the right of the default header cell (col 0)
    expect(view.state.doc.toString().split("\n")[0]).toBe("| Name |  | Age |");
    expect(view.dom.querySelectorAll(".mp-live-table-cell").length).toBe(6);

    // Widget rebuild resets activeCell; focus the empty column before −C
    focusBodyCell(view, 0, 1);
    clickToolbar(view, "−C");
    expect(view.state.doc.toString().split("\n")[0]).toBe("| Name | Age |");
    expect(view.dom.querySelectorAll(".mp-live-table-cell").length).toBe(4);

    view.destroy();
  });

  it("deletes a body row via the toolbar after focusing that row", () => {
    const view = createView(
      ["| Name | Age |", "| --- | --- |", "| Ada | 36 |", "| Bob | 28 |"].join(
        "\n",
      ),
    );

    focusBodyCell(view, 1, 0);
    clickToolbar(view, "−R");

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
