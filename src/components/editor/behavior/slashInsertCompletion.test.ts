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
  it("offers the slash catalog on a line-start slash", () => {
    const result = completionAt("/");
    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels[0]).toBe("插入表格");
    expect(labels).toContain("插入说明");
    expect(labels).toContain("插入待办项");
    expect(labels).not.toContain("插入警告");
    expect(labels).not.toContain("插入注意");
    expect(labels).toContain("插入流程图");
    expect(labels).toContain("插入公式");
    expect(labels).toContain("插入代码块");
    expect(labels).toContain("嵌入笔记");
    expect(labels).toContain("插入脚注");
    expect(
      result?.options.some((option) => /^\d+×\d+$/.test(option.detail ?? "")),
    ).toBe(false);
  });

  it("inserts a note callout from /说明", () => {
    const result = completionAt("/说明");
    expect(result?.options).toHaveLength(1);
    const view = viewAt("/说明");
    const apply = result?.options[0]?.apply;
    expect(typeof apply).toBe("function");
    if (typeof apply === "function") {
      apply(view, result!.options[0]!, 0, 3);
    }
    expect(view.state.doc.toString()).toContain("> [!note] 说明");
    view.destroy();
  });

  it("inserts a task item from /待办", () => {
    const result = completionAt("/待办");
    expect(result?.options).toHaveLength(1);
    const view = viewAt("/待办");
    const apply = result?.options[0]?.apply;
    expect(typeof apply).toBe("function");
    if (typeof apply === "function") {
      apply(view, result!.options[0]!, 0, 3);
    }
    expect(view.state.doc.toString()).toBe("- [ ] 内容");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("内容");
    view.destroy();
  });

  it("inserts a footnote ref and definition", () => {
    const result = completionAt("正文\n/脚注");
    const view = viewAt("正文\n/脚注");
    const apply = result?.options[0]?.apply;
    expect(typeof apply).toBe("function");
    if (typeof apply === "function") {
      apply(view, result!.options[0]!, 3, 6);
    }
    const text = view.state.doc.toString();
    expect(text).toContain("[^1]");
    expect(text).toContain("[^1]: ");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("");
    expect(
      view.state.doc.sliceString(
        view.state.selection.main.from - 2,
        view.state.selection.main.from,
      ),
    ).toBe(": ");
    view.destroy();
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
