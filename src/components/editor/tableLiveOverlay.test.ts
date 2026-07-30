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

    const addRow = view.dom.querySelector(
      ".mp-live-table-tool-btn[aria-label]",
    ) as HTMLButtonElement | null;
    expect(addRow).not.toBeNull();
    // First toolbar button is +R (insert row below)
    addRow!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(view.state.doc.toString()).toContain("|  |  |");
    expect(view.dom.querySelectorAll(".mp-live-table tr").length).toBe(3);

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
