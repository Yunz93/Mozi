/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownSlashInsertCompletion } from "./slashInsertCompletion";
import {
  closeTableInsertPicker,
  openTableInsertPicker,
} from "./tableInsertPicker";
import { insertMarkdownTable } from "./tables";

function completionAt(doc: string, pos = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
  });
  return markdownSlashInsertCompletion(new CompletionContext(state, pos, true));
}

function viewAt(doc: string, pos = doc.length): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: pos },
    }),
    parent,
  });
}

describe("markdownSlashInsertCompletion", () => {
  it("offers a table picker on a line-start slash", () => {
    const result = completionAt("/");
    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    expect(result?.options[0]?.label).toBe("插入表格");
    expect(result?.options.some((option) => option.detail === "3×3")).toBe(
      true,
    );
  });

  it("inserts a sized table from /3x4", () => {
    const result = completionAt("/3x4");
    expect(result?.options[0]?.label).toContain("3×4");
    const view = viewAt("/3x4");
    const apply = result?.options[0]?.apply;
    expect(typeof apply).toBe("function");
    if (typeof apply === "function") {
      apply(view, result!.options[0]!, 0, 4);
    }
    const text = view.state.doc.toString();
    expect(text).toContain("| 列1 | 列2 | 列3 | 列4 |");
    expect(
      text.split("\n").filter((line) => line.startsWith("|")),
    ).toHaveLength(4);
    view.destroy();
  });

  it("does not trigger in the middle of a paragraph", () => {
    expect(completionAt("hello /table", 12)).toBeNull();
  });
});

describe("insertMarkdownTable", () => {
  it("inserts a custom visual size and selects the first header cell", () => {
    const view = viewAt("");
    const handled = insertMarkdownTable(view.state, (tr) => view.dispatch(tr), {
      visualRows: 4,
      cols: 2,
      headers: ["A", "B"],
    });
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toContain("| A | B |");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("A");
    view.destroy();
  });

  it("replaces a slash query range", () => {
    const view = viewAt("/表格");
    insertMarkdownTable(view.state, (tr) => view.dispatch(tr), {
      visualRows: 3,
      cols: 3,
      replaceFrom: 0,
      replaceTo: view.state.doc.length,
    });
    expect(view.state.doc.toString().startsWith("|")).toBe(true);
    expect(view.state.doc.toString()).not.toContain("/表格");
    view.destroy();
  });
});

describe("openTableInsertPicker", () => {
  afterEach(() => {
    closeTableInsertPicker();
  });

  it("inserts the hovered size on click", () => {
    const view = viewAt("");
    openTableInsertPicker(view);
    const cell = document.querySelector<HTMLButtonElement>(
      '.cm-table-insert-picker-cell[data-row="4"][data-col="5"]',
    );
    expect(cell).toBeTruthy();
    cell?.click();
    const lines = view.state.doc
      .toString()
      .split("\n")
      .filter((line) => line.startsWith("|"));
    expect(lines[0]?.split("|").filter(Boolean)).toHaveLength(5);
    expect(lines).toHaveLength(5);
    view.destroy();
  });
});
