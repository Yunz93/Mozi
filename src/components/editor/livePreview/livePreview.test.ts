/** @vitest-environment happy-dom */

import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { describe, expect, it, afterEach, vi } from "vitest";
import { createEditorMarkdownLanguage } from "../editorMarkdown";
import { livePreviewContextFacet } from "./context";
import {
  buildLivePreviewHideDecorations,
  livePreviewTheme,
} from "./hideFormattingMarks";
import { buildLivePreviewImageDecorations } from "./images";
import {
  rememberCachedPreviewImageSrc,
  invalidateCachedPreviewImageSrc,
} from "../../../utils/previewImageCache";
import { buildLivePreviewMathDecorations, findMathRangesInText } from "./math";
import {
  buildLivePreviewTaskDecorations,
  livePreviewTaskCheckboxes,
} from "./taskCheckboxes";
import {
  buildLivePreviewWikiDecorations,
  collectWikiAsyncJobs,
  livePreviewWiki,
  clearLivePreviewWikiCaches,
} from "./wiki";
import { buildLivePreviewTableDecorations, livePreviewTables } from "./tables";
import {
  buildCalloutDecorations,
  findCalloutRanges,
  livePreviewCallouts,
} from "./callouts";
import { markdownListDecorations } from "../decorations";
import { indentationGuides } from "../hooks/indentationGuides";
import {
  buildLivePreviewBlockquoteDecorations,
  buildLivePreviewListMarkerDecorations,
  buildHighlightDecorations,
  buildHighlightDecorationsInScanRanges,
  findHighlightRanges,
  findCommentRanges,
  livePreviewBlockquotes,
  livePreviewHighlights,
  livePreviewListMarkerReplaceFrom,
  livePreviewListMarkers,
  livePreviewListNestLevelFromIndent,
} from "./listAndHighlight";
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
      createEditorMarkdownLanguage(),
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

describe("livePreviewListMarkerReplaceFrom", () => {
  it("includes nested indent but not blockquote prefixes", () => {
    expect(livePreviewListMarkerReplaceFrom(0, 0, "")).toBe(0);
    expect(livePreviewListMarkerReplaceFrom(10, 14, "    ")).toBe(10);
    expect(livePreviewListMarkerReplaceFrom(0, 2, "  ")).toBe(0);
    expect(livePreviewListMarkerReplaceFrom(0, 4, ">   ")).toBe(1);
  });

  it("maps source indent to live nest levels", () => {
    expect(livePreviewListNestLevelFromIndent("")).toBe(1);
    expect(livePreviewListNestLevelFromIndent("  ")).toBe(2);
    expect(livePreviewListNestLevelFromIndent("    ")).toBe(2);
    expect(livePreviewListNestLevelFromIndent("        ")).toBe(3);
  });
});

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

  it("does not hide subscript/superscript markers (~...~ / ^...^) when cursor is away", () => {
    const view = mount("H~2~O", 4);
    const deco = buildLivePreviewHideDecorations(view);
    let hidesTilde = false;
    deco.between(0, view.state.doc.length, (from, to) => {
      if (view.state.doc.sliceString(from, to) === "~") {
        hidesTilde = true;
      }
    });
    expect(hidesTilde).toBe(false);
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

  it("hides the space after ATX hashes so heading text lines up with body text", () => {
    const view = mount("## 需求列表\n\n正文", 10);
    const deco = buildLivePreviewHideDecorations(view);
    const hiddenTexts: string[] = [];
    deco.between(0, view.state.doc.length, (from, to) => {
      hiddenTexts.push(view.state.doc.sliceString(from, to));
    });
    expect(hiddenTexts).toContain("## ");
  });

  it("hides the space after quote marks so wrapped quote text stays off the bar", () => {
    const doc = "> quoted line\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewHideDecorations(view);
    const hiddenTexts: string[] = [];
    deco.between(0, view.state.doc.length, (from, to) => {
      hiddenTexts.push(view.state.doc.sliceString(from, to));
    });
    expect(hiddenTexts).toContain("> ");
  });

  it("does not hide autolink or bare URLs when the cursor is away", () => {
    const hiddenOf = (doc: string) => {
      const view = mount(doc, doc.length - 1);
      const hiddenTexts: string[] = [];
      buildLivePreviewHideDecorations(view).between(
        0,
        view.state.doc.length,
        (from, to) => {
          hiddenTexts.push(view.state.doc.sliceString(from, to));
        },
      );
      return hiddenTexts.join("|");
    };

    expect(hiddenOf("see <https://example.com/path>\n\naway")).not.toContain(
      "https://example.com/path",
    );
    expect(hiddenOf("see https://example.com/path\n\naway")).not.toContain(
      "https://example.com/path",
    );
    expect(
      hiddenOf("```\ncurl https://example.com/path \\\\\n```\n\naway"),
    ).not.toContain("https://example.com/path");
    expect(
      hiddenOf(
        "curl https://maasapi.robbyant.com/v1/depth/generations \\\\\n\naway",
      ),
    ).not.toContain("https://maasapi.robbyant.com/v1/depth/generations");
  });

  it("still hides autolink angle brackets when the cursor is away", () => {
    const doc = "see <https://example.com/path>\n\naway";
    const view = mount(doc, doc.length - 1);
    const hiddenTexts: string[] = [];
    buildLivePreviewHideDecorations(view).between(
      0,
      view.state.doc.length,
      (from, to) => {
        hiddenTexts.push(view.state.doc.sliceString(from, to));
      },
    );
    expect(hiddenTexts).toEqual(expect.arrayContaining(["<", ">"]));
    expect(hiddenTexts.join("|")).not.toContain("https://example.com/path");
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
    expect(widget!.ignoreEvent(new MouseEvent("click"))).toBe(true);
    expect(widget!.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
  });

  it("applies Obsidian pipe size from markdown image alt", () => {
    const doc =
      "see ![墨知正式版-1787670846943|300](https://example.com/ink.png)\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewImageDecorations(
      view,
      new Map(),
      () => undefined,
    );
    let widget: { alt: string; width?: number; height?: number } | null = null;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        widget = value.spec.widget as typeof widget;
      }
    });
    expect(widget).not.toBeNull();
    expect(widget!.alt).toBe("墨知正式版-1787670846943");
    expect(widget!.width).toBe(300);
    expect(widget!.height).toBeUndefined();
    const dom = (
      widget as unknown as { toDOM: (view: EditorView) => HTMLElement }
    ).toDOM(view);
    expect(dom.querySelector("img")?.style.width).toBe("300px");
  });

  it("keeps markdown image display urls after the global preview cache drops", () => {
    rememberCachedPreviewImageSrc(
      "墨知正式版-1.png",
      undefined,
      "blob:live-image",
    );
    const cache = new Map<string, string>();
    const doc = "![shot](墨知正式版-1.png)\n\naway";
    const view = mount(doc, doc.length - 1);
    const first = buildLivePreviewImageDecorations(
      view,
      cache,
      () => undefined,
    );
    let resolvedSrc: string | null = null;
    first.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        resolvedSrc = (value.spec.widget as { resolvedSrc: string | null })
          .resolvedSrc;
      }
    });
    expect(resolvedSrc).toBe("blob:live-image");
    expect(cache.get("::墨知正式版-1.png")).toBe("blob:live-image");

    invalidateCachedPreviewImageSrc();
    view.dispatch({ selection: { anchor: 0, head: 12 } });
    const hidden = buildLivePreviewImageDecorations(
      view,
      cache,
      () => undefined,
    );
    let hiddenCount = 0;
    hidden.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) hiddenCount += 1;
    });
    expect(hiddenCount).toBe(0);

    view.dispatch({ selection: { anchor: doc.length - 1 } });
    const restored = buildLivePreviewImageDecorations(
      view,
      cache,
      () => undefined,
    );
    let restoredSrc: string | null = null;
    restored.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        restoredSrc = (value.spec.widget as { resolvedSrc: string | null })
          .resolvedSrc;
      }
    });
    expect(restoredSrc).toBe("blob:live-image");
    invalidateCachedPreviewImageSrc();
  });

  it("previews markdown images whose URLs contain spaces", () => {
    const doc =
      "![M 記](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1.png)\n\naway";
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
      resolvedSrc: string | null;
      rawSrc: string;
    } | null = null;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        widget = value.spec.widget as typeof widget;
      }
    });
    expect(widget).not.toBeNull();
    expect(doc.slice(widget!.from, widget!.to)).toBe(
      "![M 記](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1.png)",
    );
    expect(widget!.rawSrc).toContain("M 記-1.png");
    expect(widget!.resolvedSrc).toContain("M%20%E8%A8%98-1.png");
  });

  it("previews markdown images whose destination starts with a space", () => {
    const doc = "![M 記]( 記-1776170252301.png)\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewImageDecorations(
      view,
      new Map(),
      () => undefined,
    );
    let widget: { rawSrc: string } | null = null;
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        widget = value.spec.widget as { rawSrc: string };
      }
    });
    expect(widget).not.toBeNull();
    expect(widget!.rawSrc).toBe("記-1776170252301.png");
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

  it("marks display math as a Reading-matched block widget", () => {
    const doc = "$$E=mc^2$$\n\naway";
    const view = mount(doc, doc.length - 1, [livePreviewMath]);
    const el = view.dom.querySelector(
      ".cm-live-preview-math",
    ) as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el!.classList.contains("is-display")).toBe(true);
    expect(el!.classList.contains("cm-live-preview-math-display")).toBe(true);
  });

  it("insets live block widgets to the Reading text column", () => {
    mount("x", 0, [livePreviewTheme]);
    const sheetText = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(sheetText).toMatch(
      /cm-live-preview-callout[^}]*margin-inline:\s*var\(--pane-content-px\)/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-mermaid[^}]*margin-inline:\s*var\(--pane-content-px\)/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-mermaid[^}]*width:\s*fit-content/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-note-embed[^}]*margin-inline:\s*var\(--pane-content-px\)/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-hr[^}]*margin-inline:\s*var\(--pane-content-px\)/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-math-display[^}]*margin-inline:\s*var\(--pane-content-px\)/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-math-display[^}]*text-align:\s*center/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-callout-body\.markdown-body\s*\{[^}]*line-height:\s*inherit/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-callout-body\.markdown-body p\s*\{[^}]*margin-bottom:\s*0/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-mermaid[^}]*text-align:\s*center/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-mermaid \.mermaid\s*\{[^}]*justify-content:\s*center/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-mermaid \.mermaid > svg\s*\{[^}]*margin-inline:\s*auto/,
    );
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

  it("keeps wiki image display urls after the global preview cache drops", () => {
    rememberCachedPreviewImageSrc(
      "墨知正式版.png",
      undefined,
      "blob:wiki-image",
    );
    const cache = new Map<string, string>();
    const embed = "![[墨知正式版.png]]";
    const doc = `${embed}\n\naway`;
    const view = mount(doc, doc.length - 1);
    const first = buildLivePreviewWikiDecorations(view, cache);
    let resolvedSrc: string | null = null;
    first.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        resolvedSrc = (value.spec.widget as { resolvedSrc: string | null })
          .resolvedSrc;
      }
    });
    expect(resolvedSrc).toBe("blob:wiki-image");
    expect(cache.get("wiki::::墨知正式版.png")).toBe("blob:wiki-image");

    invalidateCachedPreviewImageSrc();
    view.dispatch({ selection: { anchor: 0, head: embed.length } });
    const hidden = buildLivePreviewWikiDecorations(view, cache);
    let hiddenCount = 0;
    hidden.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) hiddenCount += 1;
    });
    expect(hiddenCount).toBe(0);

    view.dispatch({ selection: { anchor: doc.length - 1 } });
    const restored = buildLivePreviewWikiDecorations(view, cache);
    let restoredSrc: string | null = null;
    restored.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        restoredSrc = (value.spec.widget as { resolvedSrc: string | null })
          .resolvedSrc;
      }
    });
    expect(restoredSrc).toBe("blob:wiki-image");
    invalidateCachedPreviewImageSrc();
    clearLivePreviewWikiCaches();
  });

  it("does not skip wiki image resolves until the display url is copied into cache", () => {
    rememberCachedPreviewImageSrc("cat.png", undefined, "blob:wiki-copy");
    const view = mount("![[cat.png]]\n\naway", 14);
    const jobs = collectWikiAsyncJobs(view.state);
    expect(jobs.filter((job) => job.kind === "image")).toEqual([]);
    invalidateCachedPreviewImageSrc();
    clearLivePreviewWikiCaches();
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

  it("keeps table cell fills translucent so selection paints evenly", () => {
    // Mount theme once so baseTheme rules are present.
    mount("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0, [livePreviewTheme]);
    const text = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(text).toMatch(
      /cm-live-preview-table th\s*\{[^}]*color-mix\([\s\S]*?transparent/,
    );
    expect(text).toMatch(
      /cm-live-preview-table tbody tr:nth-child\(even\) td\s*\{[^}]*color-mix\([\s\S]*?transparent/,
    );
  });

  it("spans full width like Reading while keeping CJK-friendly wrapping", () => {
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

    // Same column width as headings/paragraphs; cells wrap instead of
    // shrinking the table. Header/body share left alignment by default.
    const sheetText = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(sheetText).toMatch(
      /cm-live-preview-table-wrap[^}]*overflow-x:\s*auto/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-table-wrap[^}]*contain:\s*inline-size/,
    );
    expect(sheetText).toMatch(/\.cm-live-preview-table\s*\{[^}]*width:\s*100%/);
    expect(sheetText).toMatch(
      /\.cm-live-preview-table\s*\{[^}]*max-width:\s*100%/,
    );
    expect(sheetText).toMatch(
      /\.cm-live-preview-table\s*\{[^}]*table-layout:\s*fixed/,
    );
    expect(sheetText).not.toMatch(
      /\.cm-live-preview-table\s*\{[^}]*width:\s*max-content/,
    );
    expect(sheetText).toMatch(/word-break:\s*break-word/);
    expect(sheetText).toMatch(
      /cm-live-preview-table td[^}]*text-align:\s*left/,
    );
    expect(sheetText).toMatch(
      /cm-live-preview-table th\s*\{[^}]*white-space:\s*normal/,
    );

    const firstHeader = table!.querySelector("th") as HTMLElement | null;
    const firstBody = table!.querySelector("td") as HTMLElement | null;
    expect(firstHeader?.style.textAlign).toBe("left");
    expect(firstBody?.style.textAlign).toBe("left");
  });

  it("honors GFM column alignment on live table cells", () => {
    const doc = [
      "| left | mid | right |",
      "| :--- | :---: | ---: |",
      "| a | b | c |",
      "",
      "away",
    ].join("\n");
    const view = mount(doc, doc.length - 1, [livePreviewTables]);
    const table = view.dom.querySelector(
      ".cm-live-preview-table",
    ) as HTMLTableElement | null;
    expect(table).not.toBeNull();
    const headers = Array.from(table!.querySelectorAll("th")) as HTMLElement[];
    expect(headers.map((cell) => cell.style.textAlign)).toEqual([
      "left",
      "center",
      "right",
    ]);
    const body = Array.from(table!.querySelectorAll("td")) as HTMLElement[];
    expect(body.map((cell) => cell.style.textAlign)).toEqual([
      "left",
      "center",
      "right",
    ]);
  });

  it("escapes pipes and newlines when committing a live table cell", async () => {
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
    editing!.textContent = "a | b\nc";
    editing!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const text = view.state.doc.toString();
    expect(text).toContain("| a \\| b c |");
    // Still a 2-column table — pipe in the cell must not invent a column.
    const bodyLine = text.split("\n").find((line) => line.includes("\\|"));
    expect(bodyLine).toBeDefined();
    expect(bodyLine!.split(/(?<!\\)\|/).length).toBeGreaterThanOrEqual(3);
  });

  it("does not yank the caret back to the table on blur commit", async () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\naway";
    const away = doc.length - 1;
    const view = mount(doc, away, [livePreviewTables]);
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
    editing!.textContent = "hello";

    // Click elsewhere first, then blur the cell (as a real click would).
    view.dispatch({ selection: { anchor: away } });
    editing!.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(view.state.doc.toString()).toContain("| hello |");
    // Selection must stay past the table (mapped through the rewrite), not
    // jump back to the table start.
    const head = view.state.selection.main.head;
    expect(head).toBeGreaterThan(doc.indexOf("\n\naway"));
    expect(head).not.toBe(0);
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
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
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

  it("replaces inactive markdown links whose URLs contain spaces", () => {
    const doc = "go [PRD](docs/完整 PRD.md)\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewLinkDecorations(view);
    let href = "";
    deco.between(0, view.state.doc.length, (_from, _to, value) => {
      const widget = value.spec.widget as { href?: string } | undefined;
      if (widget?.href) href = widget.href;
    });
    expect(href).toBe("docs/完整 PRD.md");
  });

  it("does not replace frontmatter fences with HR widgets", () => {
    const doc = [
      "---",
      "category:",
      "tags:",
      "status: draft",
      "---",
      "",
      "body",
      "",
      "---",
      "",
      "away",
    ].join("\n");
    const view = mount(doc, doc.length - 1, [livePreviewCallouts]);
    const { decorations } = buildCalloutDecorations(view.state);
    const replaced: Array<{ from: number; to: number; text: string }> = [];
    decorations.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.widget) {
        replaced.push({
          from,
          to,
          text: view.state.doc.sliceString(from, to).trim(),
        });
      }
    });
    // Opening/closing YAML fences must stay as source text.
    expect(replaced.some((item) => item.from === 0)).toBe(false);
    expect(
      replaced.some((item) => {
        const line = view.state.doc.lineAt(item.from);
        return (
          line.number === 5 && line.text.trim() === "---" && item.text === "---"
        );
      }),
    ).toBe(false);
    // A thematic break in the body should still become an HR widget.
    expect(replaced.some((item) => item.text === "---")).toBe(true);
    expect(view.dom.querySelectorAll(".cm-live-preview-hr").length).toBe(1);
  });

  it("does not turn frontmatter YAML list items into live bullets", () => {
    const doc = [
      "---",
      "tags:",
      "- alpha",
      "- beta",
      "status: draft",
      "---",
      "",
      "- body item",
      "",
      "away",
    ].join("\n");
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewListMarkerDecorations(view);
    const widgetRanges: Array<[number, number]> = [];
    deco.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.widget) widgetRanges.push([from, to]);
    });
    expect(widgetRanges).toHaveLength(1);
    expect(
      view.state.doc.sliceString(widgetRanges[0][0], widgetRanges[0][1]),
    ).toMatch(/^-\s?$/);
    const bodyLine = view.state.doc.line(8);
    expect(widgetRanges[0][0]).toBe(bodyLine.from);
  });

  it("replaces nested list indent and markers with bullets when the cursor is away", () => {
    const doc = [
      "- 新增只读「机器人构型」字段",
      "  - 测试",
      "  - 测试",
      "    - 更深",
      "",
      "away",
    ].join("\n");
    const view = mount(doc, doc.length - 1, [livePreviewListMarkers]);
    const deco = buildLivePreviewListMarkerDecorations(view);
    const widgetSlices: string[] = [];
    const lineClasses: string[] = [];
    deco.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.widget) {
        widgetSlices.push(view.state.doc.sliceString(from, to));
      }
      const className = value.spec.class as string | undefined;
      if (className?.includes("cm-live-preview-list-line")) {
        lineClasses.push(className);
      }
    });
    expect(widgetSlices).toEqual(["- ", "  - ", "  - ", "    - "]);
    expect(
      lineClasses.some((cls) => cls.includes("cm-live-preview-list-level-2")),
    ).toBe(true);
    expect(
      lineClasses.some((cls) => cls.includes("cm-live-preview-list-level-3")),
    ).toBe(true);

    const nestedLines = Array.from(view.dom.querySelectorAll(".cm-line")).slice(
      1,
      4,
    );
    for (const line of nestedLines) {
      expect(line.textContent ?? "").not.toMatch(/^\s*-/);
      expect(
        line.querySelector(".cm-live-preview-list-marker.is-bullet"),
      ).not.toBeNull();
    }
    expect(
      view.dom.querySelectorAll(".cm-live-preview-list-marker"),
    ).toHaveLength(4);
  });

  it("keeps sibling nested bullets when the cursor is on one nested item", () => {
    const doc = ["- parent", "  - 测试", "  - 测试", "  - "].join("\n");
    const lastLine = doc.split("\n")[3]!;
    const cursor = doc.length - lastLine.length + 2;
    const view = mount(doc, cursor, [livePreviewListMarkers]);
    const deco = buildLivePreviewListMarkerDecorations(view);
    const widgetSlices: string[] = [];
    deco.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.widget) {
        widgetSlices.push(view.state.doc.sliceString(from, to));
      }
    });
    expect(widgetSlices).toEqual(["- ", "  - ", "  - "]);
    const lines = Array.from(view.dom.querySelectorAll(".cm-line"));
    expect(lines[1]?.textContent ?? "").not.toMatch(/-/);
    expect(lines[2]?.textContent ?? "").not.toMatch(/-/);
    expect(lines[3]?.textContent ?? "").toMatch(/-/);
  });

  it("replaces four-space nested markers used by Tab indent", () => {
    const doc = "- parent\n    - child\n    - child2\n\naway";
    const view = mount(doc, doc.length - 1, [livePreviewListMarkers]);
    const deco = buildLivePreviewListMarkerDecorations(view);
    const widgetSlices: string[] = [];
    deco.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.widget) {
        widgetSlices.push(view.state.doc.sliceString(from, to));
      }
    });
    expect(widgetSlices).toEqual(["- ", "    - ", "    - "]);
    const childLine = Array.from(view.dom.querySelectorAll(".cm-line"))[1];
    expect(childLine?.textContent ?? "").not.toMatch(/-/);
    expect(
      childLine?.querySelector(".cm-live-preview-list-marker.is-bullet"),
    ).not.toBeNull();
  });

  it("renders Tab-indented second and third level bullets next to hang-indent decorations", () => {
    const doc = [
      "- 一级列表",
      "    - 二级列表",
      "        - 三级列表",
      "        - ",
    ].join("\n");
    const cursor = doc.length;
    const view = mount(doc, cursor, [
      markdownListDecorations,
      ...indentationGuides(),
      livePreviewListMarkers,
    ]);
    const lines = Array.from(view.dom.querySelectorAll(".cm-line"));
    expect(
      lines[0]?.querySelector(".cm-live-preview-list-marker"),
    ).not.toBeNull();
    expect(lines[1]?.textContent ?? "").not.toMatch(/-/);
    expect(lines[2]?.textContent ?? "").not.toMatch(/-/);
    expect(
      lines[1]?.querySelector(".cm-live-preview-list-marker.is-bullet"),
    ).not.toBeNull();
    expect(
      lines[2]?.querySelector(".cm-live-preview-list-marker.is-bullet"),
    ).not.toBeNull();
    expect(lines[3]?.textContent ?? "").toMatch(/-/);
    expect(lines[2]?.className.includes("cm-live-preview-list-level-3")).toBe(
      true,
    );
  });

  it("does not eat blockquote marks when replacing nested quote lists", () => {
    const doc = "> - parent\n>   - child\n\naway";
    const view = mount(doc, doc.length - 1);
    const deco = buildLivePreviewListMarkerDecorations(view);
    const widgetSlices: string[] = [];
    deco.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.widget) {
        widgetSlices.push(view.state.doc.sliceString(from, to));
      }
    });
    expect(widgetSlices.every((slice) => !slice.includes(">"))).toBe(true);
    expect(widgetSlices.some((slice) => slice.includes("-"))).toBe(true);
  });

  it("hides the list hyphen on inactive task items instead of drawing a bullet", () => {
    const doc =
      "- [ ] 产品详情运动控制映射 Tab 展示版本卡片\n  - [ ] nested\n\naway";
    const view = mount(doc, doc.length - 1, [
      livePreviewListMarkers,
      livePreviewTaskCheckboxes,
    ]);
    const listDeco = buildLivePreviewListMarkerDecorations(view);
    const hiddenMarks: string[] = [];
    let bulletCount = 0;
    listDeco.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.widget) {
        bulletCount += 1;
        return;
      }
      if (from < to) {
        hiddenMarks.push(view.state.doc.sliceString(from, to));
      }
    });
    expect(bulletCount).toBe(0);
    expect(hiddenMarks).toEqual(["- ", "  - "]);

    const taskDeco = buildLivePreviewTaskDecorations(view);
    let taskCount = 0;
    taskDeco.between(0, view.state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) taskCount += 1;
    });
    expect(taskCount).toBe(2);

    const lines = Array.from(view.dom.querySelectorAll(".cm-line"));
    expect(lines[0]?.querySelector(".cm-live-preview-task")).not.toBeNull();
    expect(lines[0]?.querySelector(".cm-live-preview-list-marker")).toBeNull();
    expect(lines[0]?.textContent ?? "").not.toMatch(/^\s*-/);
    expect(lines[1]?.textContent ?? "").not.toMatch(/-/);
  });

  it("still hides the hyphen for checked and ordered task items", () => {
    const doc = "- [x] done\n1. [ ] numbered\n\naway";
    const view = mount(doc, doc.length - 1, [
      livePreviewListMarkers,
      livePreviewTaskCheckboxes,
    ]);
    const listDeco = buildLivePreviewListMarkerDecorations(view);
    const hiddenMarks: string[] = [];
    listDeco.between(0, view.state.doc.length, (from, to, value) => {
      if (!value.spec.widget && from < to) {
        hiddenMarks.push(view.state.doc.sliceString(from, to));
      }
    });
    expect(hiddenMarks).toEqual(["- ", "1. "]);
    expect(view.dom.querySelectorAll(".cm-live-preview-task")).toHaveLength(2);
    for (const line of Array.from(view.dom.querySelectorAll(".cm-line")).slice(
      0,
      2,
    )) {
      expect(line.textContent ?? "").not.toMatch(/^\s*[-*\d]/);
    }
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

  it("treats inline $$ as non-math", () => {
    expect(findMathRangesInText("文字 $$x$$ 文字")).toEqual([]);
  });

  it("finds display $$ only when fences align to line start/end", () => {
    const ranges = findMathRangesInText("$$\nx\n$$");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      content: "\nx\n",
      displayMode: true,
    });
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

  it("parses callouts with leading whitespace", () => {
    const text = "  > [!note] 标题\n  > 内容";
    const ranges = findCalloutRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      type: "note",
      title: "标题",
      bodyMarkdown: "内容",
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

  it("highlights/comments don't cross paragraph boundaries", () => {
    expect(
      findHighlightRanges(
        "if a == b and c == d",
        0,
        "if a == b and c == d".length,
      ),
    ).toEqual([]);

    const crossParagraph = "x == y\n\n中间正文\n\np == q";
    expect(
      findHighlightRanges(crossParagraph, 0, crossParagraph.length),
    ).toEqual([]);

    const escaped = "\\==xx==";
    expect(findHighlightRanges(escaped, 0, escaped.length)).toEqual([]);

    const commentCrossParagraph = "a %%b\n\nc%% d";
    expect(
      findCommentRanges(commentCrossParagraph, 0, commentCrossParagraph.length),
    ).toEqual([]);
  });

  it("skips highlight matches whose end lands inside inline code", () => {
    const doc = "正文==说明 `x==y`";
    const cursor = 0;
    const view = createView(doc, cursor, [livePreviewHighlights]);
    try {
      expect(
        view.dom.querySelectorAll(".cm-live-preview-highlight"),
      ).toHaveLength(0);
      // Source should stay visible (no replacement happened).
      expect(view.dom.textContent).toContain("正文");
      expect(view.dom.textContent).toContain("x==y");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("keeps multi-line replacements paragraph-safe", () => {
    const doc = "before\n%%\nmulti\nline comment\n%%\nafter";
    // Previously this could swallow across paragraphs via a single block replace.
    expect(() => {
      const view = createView(doc, doc.length - 1, [livePreviewHighlights]);
      view.destroy();
      view.dom.parentElement?.remove();
    }).not.toThrow();
  });

  it("keeps highlight decorations consistent for incremental paragraph scans", () => {
    const doc = "para start ==a\nb== para end\n\nnext";
    const view = createView(doc, doc.length - 1);
    try {
      const full = buildHighlightDecorations(view.state);
      const paragraphTo = doc.indexOf("\n\n");
      const incremental = buildHighlightDecorationsInScanRanges(view.state, [
        { from: 0, to: paragraphTo },
      ]);

      const collect = (set: DecorationSet) => {
        const out: Array<{ from: number; to: number; widgetText?: string }> =
          [];
        set.between(0, 1e9, (from: number, to: number, value: Decoration) => {
          const widget = value.spec.widget as { text?: string } | undefined;
          out.push({ from, to, widgetText: widget?.text });
        });
        return out;
      };

      expect(full.coverage).toEqual(incremental.coverage);
      expect(collect(full.decorations)).toEqual(
        collect(incremental.decorations),
      );
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("highlight/bullet widgets place caret and set contenteditable=false", () => {
    // 高亮：光标在别处时 widget 挂载，点击后光标应落到 `==` 起点（此时源码会显示出来）
    const highlightDoc = "a ==hi== b";
    const highlightView = createView(highlightDoc, highlightDoc.length, [
      livePreviewHighlights,
    ]);
    const markEl = highlightView.dom.querySelector(
      ".cm-live-preview-highlight",
    ) as HTMLElement | null;
    expect(markEl).not.toBeNull();
    expect(markEl!.getAttribute("contenteditable")).toBe("false");
    markEl!.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(highlightView.state.selection.main.anchor).toBe(
      highlightDoc.indexOf("=="),
    );
    highlightView.destroy();
    highlightView.dom.parentElement?.remove();

    // 列表符号：点击后光标应落到列表内容起点（`- ` 之后）
    const bulletDoc = "- item\n\naway";
    const bulletView = createView(bulletDoc, bulletDoc.length - 1, [
      livePreviewListMarkers,
    ]);
    const bulletEl = bulletView.dom.querySelector(
      ".cm-live-preview-list-marker",
    ) as HTMLElement | null;
    expect(bulletEl).not.toBeNull();
    expect(bulletEl!.getAttribute("contenteditable")).toBe("false");
    bulletEl!.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(bulletView.state.selection.main.anchor).toBe("- ".length);
    bulletView.destroy();
    bulletView.dom.parentElement?.remove();
  });

  it("allows multi-line highlight/comment replaces via StateField without crashing", () => {
    const docs = [
      "before\n%%\nmulti\nline comment\n%%\nafter",
      "before\n==hi\nthere==\nafter",
    ];
    for (const doc of docs) {
      expect(() => {
        const view = createView(doc, doc.length - 1, [livePreviewHighlights]);
        try {
          expect(view.dom.isConnected).toBe(true);
        } finally {
          view.destroy();
          view.dom.parentElement?.remove();
        }
      }).not.toThrow();
    }
  });

  it("marks plain blockquote lines for Reading-matched chrome", () => {
    const doc = "> quoted line\n> second\n\npara";
    const view = createView(doc, doc.length - 1, [livePreviewBlockquotes]);
    try {
      const set = buildLivePreviewBlockquoteDecorations(view);
      expect(set.size).toBeGreaterThanOrEqual(2);
      const quoteLines = view.dom.querySelectorAll(
        ".cm-live-preview-blockquote",
      );
      expect(quoteLines.length).toBeGreaterThanOrEqual(2);
      expect(
        view.dom.querySelector(".cm-live-preview-blockquote-first"),
      ).not.toBeNull();
      expect(
        view.dom.querySelector(".cm-live-preview-blockquote-last"),
      ).not.toBeNull();
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });
});
