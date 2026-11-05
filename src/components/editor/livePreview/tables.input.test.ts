/** @vitest-environment happy-dom */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import { createEditorMarkdownLanguage } from "../editorMarkdown";
import { livePreviewTables } from "./tables";

const views: EditorView[] = [];
const frame = () => new Promise(requestAnimationFrame);

async function editCell() {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "| 项目 | 状态 |\n| --- | --- |\n| 写作 | 草稿 |\n\n正文",
      extensions: [
        createEditorMarkdownLanguage(),
        history(),
        livePreviewTables,
      ],
    }),
  });
  views.push(view);
  view.dom
    .querySelector("td")!
    .dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  await frame();
  await frame();
  return {
    view,
    cell: view.dom.querySelector<HTMLElement>(
      ".cm-live-preview-table-cell-editing",
    )!,
  };
}

afterEach(() => {
  views.splice(0).forEach((view) => {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  });
});

describe("表格输入与正文事务一致", () => {
  it("新增末列后撤销仍在还原后的最后一列编辑", async () => {
    const { view } = await editCell();
    view.dom.querySelectorAll("td")[1].dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    await frame();
    const cell = view.dom.querySelector<HTMLElement>(
      ".cm-live-preview-table-cell-editing",
    )!;
    cell.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        metaKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    await frame();
    const added = view.dom.querySelector<HTMLElement>(
      ".cm-live-preview-table-cell-editing",
    )!;
    expect(added.dataset.mpCol).toBe("2");
    added.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    await frame();
    const restored = view.dom.querySelector<HTMLElement>(
      ".cm-live-preview-table-cell-editing",
    );
    expect(restored?.dataset.mpCol).toBe("1");
    expect(document.activeElement).toBe(restored);
  });
  it("新增末行后撤销仍聚焦到合法单元格，并能继续输入", async () => {
    const { view, cell } = await editCell();
    cell.focus();
    cell.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    await frame();
    const added = view.dom.querySelector<HTMLElement>(
      ".cm-live-preview-table-cell-editing",
    )!;
    expect(added.dataset.mpRow).toBe("2");
    added.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await frame();
    await frame();
    const restored = view.dom.querySelector<HTMLElement>(
      ".cm-live-preview-table-cell-editing",
    );
    expect(restored?.dataset.mpRow).toBe("1");
    expect(document.activeElement).toBe(restored);
    restored!.textContent = "继续写作";
    restored!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("| 继续写作 | 草稿 |");
  });
  it("超过单元格预算的粘贴保留全部正文，并转到源码", async () => {
    const { view, cell } = await editCell();
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      Array.from({ length: 510 }, () =>
        Array.from({ length: 20 }, () => "数据").join("\t"),
      ).join("\n"),
    );
    cell.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.state.doc.lines).toBe(514);
    expect(view.state.doc.line(512).text.match(/数据/g)).toHaveLength(20);
    expect(
      view.dom.querySelector(".cm-live-preview-table-cell-editing"),
    ).toBeNull();
    expect(view.dom.querySelectorAll("td").length).toBe(0);
  });
  it("全选仅选择当前单元格，格式快捷键不会写入整篇正文", async () => {
    const { view, cell } = await editCell();
    cell.focus();
    const selectAll = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    cell.dispatchEvent(selectAll);
    expect(selectAll.defaultPrevented).toBe(true);
    expect(cell.ownerDocument.getSelection()?.toString()).toBe("写作");
    cell.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.state.doc.toString()).toContain("| **写作** | 草稿 |");
    cell.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.state.doc.toString()).toContain("| 写作 | 草稿 |");
    expect(view.dom.querySelectorAll("th")).toHaveLength(2);
  });
  it("未切格即写入正文，同时保留正在输入的单元格 DOM", async () => {
    const { view, cell } = await editCell();
    cell.textContent = "最新内容";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("| 最新内容 | 草稿 |");
    expect(view.dom.querySelector(".cm-live-preview-table-cell-editing")).toBe(
      cell,
    );
    expect(cell.isConnected).toBe(true);
  });

  it("中文组合输入不重建节点，最终输入进入共享撤销历史", async () => {
    const { view, cell } = await editCell();
    cell.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    cell.textContent = "正在输入";
    cell.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true }),
    );
    expect(view.dom.querySelector(".cm-live-preview-table-cell-editing")).toBe(
      cell,
    );
    cell.textContent = "输入完成";
    cell.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(view.state.doc.toString()).toContain("| 输入完成 | 草稿 |");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toContain("| 写作 | 草稿 |");
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toContain("| 输入完成 | 草稿 |");
  });

  it("表格之前插入文字后保留单元格节点，继续输入写入映射后的位置", async () => {
    const { view, cell } = await editCell();
    view.dispatch({ changes: { from: 0, insert: "前言\n\n" } });
    expect(view.dom.querySelector(".cm-live-preview-table-cell-editing")).toBe(
      cell,
    );
    cell.textContent = "继续写作";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("前言\n\n| 项目 | 状态 |");
    expect(view.state.doc.toString()).toContain("| 继续写作 | 草稿 |");
  });
});
