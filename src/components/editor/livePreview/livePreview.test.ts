/** @vitest-environment happy-dom */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it, afterEach, vi } from "vitest";
import { livePreviewContextFacet } from "./context";
import {
  buildLivePreviewHideDecorations,
  livePreviewTheme,
} from "./hideFormattingMarks";
import { buildLivePreviewImageDecorations } from "./images";
import { buildLivePreviewMathDecorations, findMathRangesInText } from "./math";
import { buildLivePreviewTaskDecorations } from "./taskCheckboxes";
import { buildLivePreviewWikiDecorations, livePreviewWiki } from "./wiki";
import { buildLivePreviewTableDecorations, livePreviewTables } from "./tables";
import { findCalloutRanges, livePreviewCallouts } from "./callouts";
import { findHighlightRanges, findCommentRanges } from "./listAndHighlight";
import { buildLivePreviewLinkDecorations } from "./links";
import { livePreviewMermaid } from "./mermaid";
import { livePreviewMath } from "./math";

function createView(
  doc: string,
  cursor = 0,
  extras: import("@codemirror/state").Extension[] = [],
) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      livePreviewContextFacet.of({
        sourceFilePath: null,
        rootFolderPath: null,
        files: [],
      }),
      ...extras,
    ],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  return view;
}

describe("live preview hide formatting", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length) {
      const view = views.pop();
      view?.destroy();
      view?.dom.parentElement?.remove();
    }
  });

  function mount(
    doc: string,
    cursor = 0,
    extras: import("@codemirror/state").Extension[] = [],
  ) {
    const view = createView(doc, cursor, extras);
    views.push(view);
    return view;
  }

  it("hides emphasis marks when the cursor is away", () => {
    const view = mount("hello **world**\n\naway", 20);
    const deco = buildLivePreviewHideDecorations(view);
    const hidden: Array<[number, number]> = [];
    deco.between(0, view.state.doc.length, (from, to) => {
      hidden.push([from, to]);
    });
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    expect(
      hidden.some(
        ([from, to]) => view.state.doc.sliceString(from, to) === "**",
      ),
    ).toBe(true);
  });

  it("reveals emphasis marks when the selection is inside the emphasis", () => {
    const view = mount("hello **world**", 8);
    const deco = buildLivePreviewHideDecorations(view);
    const hidden: Array<[number, number]> = [];
    deco.between(0, view.state.doc.length, (from, to) => {
      hidden.push([from, to]);
    });
    expect(hidden).toEqual([]);
  });

  it("hides heading marks on inactive lines", () => {
    const view = mount("# Title\n\nbody", 12);
    const deco = buildLivePreviewHideDecorations(view);
    const hiddenTexts: string[] = [];
    deco.between(0, view.state.doc.length, (from, to) => {
      hiddenTexts.push(view.state.doc.sliceString(from, to));
    });
    expect(hiddenTexts.some((text) => text.includes("#"))).toBe(true);
  });

  it("replaces task markers with widgets when inactive", () => {
    const view = mount("- [ ] todo\n\naway", 14);
    const deco = buildLivePreviewTaskDecorations(view);
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(1);
  });

  it("keeps task markers visible on the active line", () => {
    const view = mount("- [ ] todo", 2);
    const deco = buildLivePreviewTaskDecorations(view);
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(0);
  });

  it("replaces remote markdown images when inactive", () => {
    const doc = "see ![cat](https://example.com/cat.png)\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewImageDecorations(
      view,
      new Map(),
      () => undefined,
    );
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(1);
  });

  it("image widgets expose source URL ranges for click-to-reveal", () => {
    const doc = "see ![cat](https://example.com/cat.png)\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewImageDecorations(
      view,
      new Map(),
      () => undefined,
    );
    let widget: {
      from: number;
      to: number;
      urlFrom: number;
      urlTo: number;
      ignoreEvent: (event: Event) => boolean;
    } | null = null;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        widget = value.spec.widget as typeof widget;
      }
    });
    expect(widget).not.toBeNull();
    expect(doc.slice(widget!.from, widget!.to)).toBe(
      "![cat](https://example.com/cat.png)",
    );
    expect(doc.slice(widget!.urlFrom, widget!.urlTo)).toBe(
      "https://example.com/cat.png",
    );
    expect(widget!.ignoreEvent(new MouseEvent("click"))).toBe(false);
    expect(widget!.ignoreEvent(new MouseEvent("mousedown"))).toBe(false);
  });

  it("replaces inactive math with widgets", () => {
    const view = mount("area $E=mc^2$ done\n\naway", 22);
    const deco = buildLivePreviewMathDecorations(view);
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(1);
  });

  it("allows block decorations via StateField extensions without crashing", () => {
    const doc = [
      "$$E=mc^2$$",
      "",
      "```mermaid",
      "graph TD; A-->B",
      "```",
      "",
      "> [!note] Title",
      "> body",
      "",
      "![[Embedded Note]]",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "away",
    ].join("\n");

    expect(() =>
      mount(doc, doc.length - 1, [
        livePreviewMath,
        livePreviewMermaid,
        livePreviewCallouts,
        livePreviewWiki,
        livePreviewTables,
      ]),
    ).not.toThrow();
  });

  it("replaces wiki links with widgets when inactive", () => {
    const view = mount("see [[Note]] please\n\naway", 22);
    const deco = buildLivePreviewWikiDecorations(view, new Map());
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(1);
  });

  it("replaces inactive tables with widgets", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewTableDecorations(view);
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(1);
  });

  it("keeps the table widget when the selection is inside the table", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\naway";
    const view = mount(doc, 2, [livePreviewTables]);
    const deco = buildLivePreviewTableDecorations(view);
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(1);
    expect(view.dom.querySelector(".cm-live-preview-table")).not.toBeNull();
  });

  it("sizes CJK table columns to content instead of crushing short headers", () => {
    const doc = [
      "| 模块 | 需求 | 优先级 | 说明 |",
      "| --- | --- | --- | --- |",
      "| 资源概览 | 首页总览页 | P0 | 展示项目规模、进度与风险汇总 |",
      "",
      "away",
    ].join("\n");
    const view = mount(doc, doc.length - 1, [
      livePreviewTheme,
      livePreviewTables,
    ]);
    const table = view.dom.querySelector(
      ".cm-live-preview-table",
    ) as HTMLTableElement | null;
    expect(table).not.toBeNull();

    const headerTexts = Array.from(table!.querySelectorAll("th")).map(
      (th) => th.textContent?.replace(/\s+/g, "") ?? "",
    );
    expect(headerTexts).toEqual(["模块", "需求", "优先级", "说明"]);

    // Theme must opt out of `.cm-lineWrapping { overflow-wrap: anywhere }`,
    // which otherwise stacks CJK one glyph per line in squeezed columns.
    // Scroll belongs on the wrap — table itself must not be max-width:100%.
    const sheetText = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(sheetText).toMatch(
      /cm-live-preview-table-wrap[^}]*overflow-x:\s*auto/,
    );
    expect(sheetText).toMatch(/cm-live-preview-table[^}]*max-content/);
    expect(sheetText).not.toMatch(
      /\.cm-live-preview-table\s*\{[^}]*max-width:\s*100%/,
    );
    expect(sheetText).toMatch(/word-break:\s*keep-all/);
    expect(sheetText).toMatch(
      /cm-live-preview-table th\s*\{[^}]*white-space:\s*nowrap/,
    );
  });

  it("remasures the editor when an editing table cell wraps on input", async () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\naway";
    const view = mount(doc, doc.length - 1, [
      livePreviewTheme,
      livePreviewTables,
    ]);
    const spy = vi.spyOn(view, "requestMeasure");
    const cell = view.dom.querySelector(
      'td[data-mp-row="1"][data-mp-col="1"]',
    ) as HTMLElement | null;
    expect(cell).not.toBeNull();

    cell!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const editing = view.dom.querySelector(
      ".cm-live-preview-table-cell-editing",
    ) as HTMLElement | null;
    expect(editing).not.toBeNull();
    spy.mockClear();

    editing!.textContent =
      "很长很长的需求描述内容需要换行显示完整，不能被裁切掉";
    editing!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });
  it("edits a table cell in place without revealing pipe source", async () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\naway";
    const view = mount(doc, doc.length - 1, [livePreviewTables]);
    const cell = view.dom.querySelector(
      'td[data-mp-row="1"][data-mp-col="0"]',
    ) as HTMLElement | null;
    expect(cell).not.toBeNull();

    cell!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const editing = view.dom.querySelector(
      ".cm-live-preview-table-cell-editing",
    ) as HTMLElement | null;
    expect(editing).not.toBeNull();
    expect(view.dom.querySelector(".cm-live-preview-table")).not.toBeNull();

    editing!.textContent = "hello";
    editing!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(view.state.doc.toString()).toContain("| hello |");
    expect(view.dom.querySelector(".cm-live-preview-table")).not.toBeNull();
    const next = view.dom.querySelector(
      ".cm-live-preview-table-cell-editing",
    ) as HTMLElement | null;
    expect(next?.dataset.mpCol).toBe("1");
  });

  it("adds and deletes rows/columns from the live table context menu", async () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\naway";
    const view = mount(doc, doc.length - 1, [
      livePreviewTheme,
      livePreviewTables,
    ]);
    const cell = view.dom.querySelector(
      'td[data-mp-row="1"][data-mp-col="0"]',
    ) as HTMLElement | null;
    expect(cell).not.toBeNull();

    cell!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const menu = document.querySelector(
      ".cm-live-preview-table-menu",
    ) as HTMLElement | null;
    expect(menu).not.toBeNull();

    const insertCol = Array.from(
      menu!.querySelectorAll(".cm-live-preview-table-menu-item"),
    ).find(
      (el) =>
        el.textContent?.includes("插入列") ||
        el.textContent?.includes("Insert column right"),
    );
    expect(insertCol).toBeTruthy();
    (insertCol as HTMLButtonElement).click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(view.state.doc.toString()).toMatch(/\|\s*a\s*\|\s*b\s*\|\s*\|/);

    const cell2 = view.dom.querySelector(
      'td[data-mp-row="1"][data-mp-col="0"]',
    ) as HTMLElement | null;
    cell2!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const menu2 = document.querySelector(".cm-live-preview-table-menu");
    const insertRow = Array.from(
      menu2!.querySelectorAll(".cm-live-preview-table-menu-item"),
    ).find(
      (el) =>
        el.textContent?.includes("下方插入行") ||
        el.textContent?.includes("Insert row below"),
    );
    (insertRow as HTMLButtonElement).click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const lines = view.state.doc.toString().split("\n");
    const tableLines = lines.filter((line) => line.trim().startsWith("|"));
    expect(tableLines.length).toBeGreaterThanOrEqual(4);
  });

  it("replaces inactive markdown links with widgets", () => {
    const doc = "go [here](https://example.com)\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewLinkDecorations(view);
    let widgetCount = 0;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) widgetCount += 1;
    });
    expect(widgetCount).toBe(1);
  });
});

describe("findMathRangesInText", () => {
  it("finds inline and display math", () => {
    const ranges = findMathRangesInText("a $x$ b\n$$\ny\n$$\n");
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({
      content: "x",
      displayMode: false,
    });
    expect(ranges[1]).toMatchObject({
      content: "\ny\n",
      displayMode: true,
    });
  });

  it("skips empty math", () => {
    expect(findMathRangesInText("$$  $$\n$ $")).toEqual([]);
  });

  it("keeps scanning after an unclosed display fence", () => {
    const ranges = findMathRangesInText("$$\nunclosed\n\nlater $x^2$ ok\n");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      content: "x^2",
      displayMode: false,
    });
  });
});

describe("callouts / highlight / comments", () => {
  it("parses callout blocks", () => {
    const text = "> [!note] Title\n> body\n\npara";
    const ranges = findCalloutRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      type: "note",
      title: "Title",
      bodyMarkdown: "body",
    });
  });

  it("finds highlights and comments", () => {
    expect(findHighlightRanges("a ==hi== b", 0, 10)).toEqual([
      { from: 2, to: 8, content: "hi" },
    ]);
    expect(findCommentRanges("a %%hidden%% b", 0, 14)).toEqual([
      { from: 2, to: 12 },
    ]);
  });
});
