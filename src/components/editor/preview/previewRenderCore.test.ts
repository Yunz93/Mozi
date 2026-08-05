/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as markdownModule from "../../../utils/markdown";
import {
  getBasePreviewHtml,
  renderMarkdownPreview,
  sanitizeHtmlPreview,
  shouldUseAsyncPreviewEnhancement,
} from "./previewRenderCore";
import { clearMarkdownCache } from "../../../utils/markdown";
import { warmPreviewImage } from "../../../utils/previewImageCache";

(globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ ??= false;

describe("shouldUseAsyncPreviewEnhancement", () => {
  it("is false for empty html", () => {
    expect(shouldUseAsyncPreviewEnhancement("", true)).toBe(false);
  });

  it("skips async enhancement for html-file preview (iframe srcdoc keeps document CSS)", () => {
    expect(shouldUseAsyncPreviewEnhancement('<img src="x">', false)).toBe(
      false,
    );
    expect(
      shouldUseAsyncPreviewEnhancement(
        "<html><head><style>body{color:red}</style></head><body><p>x</p></body></html>",
        false,
      ),
    ).toBe(false);
  });

  it("is true when markdown html contains images", () => {
    expect(
      shouldUseAsyncPreviewEnhancement('<p><img src="a.png" /></p>', true),
    ).toBe(true);
  });

  it("is true when markdown html contains video, source, or iframe tags", () => {
    expect(
      shouldUseAsyncPreviewEnhancement('<video src="a.mp4"></video>', true),
    ).toBe(true);
    expect(shouldUseAsyncPreviewEnhancement('<source src="a.mp4">', true)).toBe(
      true,
    );
    expect(
      shouldUseAsyncPreviewEnhancement(
        '<iframe src="https://example.com"></iframe>',
        true,
      ),
    ).toBe(true);
  });

  it("is true for wiki embed placeholders", () => {
    expect(
      shouldUseAsyncPreviewEnhancement(
        '<a data-wiki-embed href="#" class="markdown-embed"></a>',
        true,
      ),
    ).toBe(true);
  });

  it("is true for embeddable YouTube and Bilibili links", () => {
    expect(
      shouldUseAsyncPreviewEnhancement(
        '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">watch</a>',
        true,
      ),
    ).toBe(true);
    expect(
      shouldUseAsyncPreviewEnhancement(
        '<a href="https://www.bilibili.com/video/BV1xx411c7mD">watch</a>',
        true,
      ),
    ).toBe(true);
  });

  it("is false for plain markdown without async media", () => {
    expect(
      shouldUseAsyncPreviewEnhancement(
        '<p>hello</p><a href="#top">top</a>',
        true,
      ),
    ).toBe(false);
  });
});

describe("sanitizeHtmlPreview", () => {
  it("returns empty string when html preview is disabled or content is empty", () => {
    expect(sanitizeHtmlPreview("", true)).toBe("");
    expect(sanitizeHtmlPreview("<p>x</p>", false)).toBe("");
  });

  it("keeps allowed iframe markup for html preview mode", () => {
    const html = sanitizeHtmlPreview(
      '<iframe src="about:blank" allow="autoplay" title="demo"></iframe>',
      true,
    );
    expect(html).toContain("<iframe");
    expect(html).toContain('allow="autoplay"');
    expect(html).toContain('title="demo"');
  });

  it("sanitizes unsafe html preview content", () => {
    expect(sanitizeHtmlPreview("<p>safe</p>", true)).toContain("safe");
    expect(
      sanitizeHtmlPreview("<script>alert(1)</script>", true),
    ).not.toContain("<script");
  });

  it("keeps document head styles for full html files", () => {
    const html = sanitizeHtmlPreview(
      '<!DOCTYPE html><html><head><style>.hero{color:tomato}</style></head><body><div class="hero">Hi</div></body></html>',
      true,
    );
    expect(html).toContain(".hero{color:tomato}");
    expect(html).toContain("Hi");
  });
});

describe("getBasePreviewHtml", () => {
  it("prefers markdown body html in markdown preview mode", () => {
    expect(getBasePreviewHtml(true, "<p>md</p>", "<p>html</p>")).toBe(
      "<p>md</p>",
    );
  });

  it("prefers sanitized html in html preview mode", () => {
    expect(getBasePreviewHtml(false, "<p>md</p>", "<p>html</p>")).toBe(
      "<p>html</p>",
    );
  });
});

describe("renderMarkdownPreview", () => {
  beforeEach(() => {
    clearMarkdownCache();
  });

  it("returns empty output when markdown preview is disabled or content is empty", () => {
    expect(
      renderMarkdownPreview({
        content: "# Title",
        isMarkdownPreview: false,
        themeMode: "light",
      }),
    ).toEqual({ frontmatter: null, bodyHTML: "" });

    expect(
      renderMarkdownPreview({
        content: "",
        isMarkdownPreview: true,
        themeMode: "light",
      }),
    ).toEqual({ frontmatter: null, bodyHTML: "" });
  });

  it("renders markdown body and parses frontmatter", () => {
    const result = renderMarkdownPreview({
      content: "---\ntitle: Note\n---\n\nHello **world**",
      isMarkdownPreview: true,
      themeMode: "light",
    });

    expect(result.frontmatter).toEqual({ title: "Note" });
    expect(result.bodyHTML).toContain("<strong>world</strong>");
  });

  it("returns a safe fallback when markdown rendering throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(markdownModule, "renderMarkdown").mockImplementation(() => {
      throw new Error("boom");
    });

    const result = renderMarkdownPreview({
      content: "# boom",
      isMarkdownPreview: true,
      themeMode: "light",
    });

    expect(result.bodyHTML).toBe("<p>Error rendering markdown</p>");
    consoleError.mockRestore();
    vi.restoreAllMocks();
  });

  it("hydrates warmed preview image cache entries into rendered html", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    await warmPreviewImage("assets/poster.png", "/vault/notes/a.md");

    const result = renderMarkdownPreview({
      content: "![](assets/poster.png)",
      currentFilePath: "/vault/notes/a.md",
      isMarkdownPreview: true,
      themeMode: "light",
    });

    expect(result.bodyHTML).toContain("assets/poster.png");
    expect(result.bodyHTML).toMatch(/src="[^"]*poster\.png/);

    fetchSpy.mockRestore();
  });

  it("renders nested unordered lists into queryable preview DOM", () => {
    const { bodyHTML } = renderMarkdownPreview({
      content: "- parent\n    - child\n        - leaf",
      isMarkdownPreview: true,
      themeMode: "light",
    });

    const root = document.createElement("div");
    root.className = "preview-pane-document markdown-body";
    root.innerHTML = bodyHTML;

    const nestedItems = root.querySelectorAll("ul ul li");
    expect(nestedItems.length).toBeGreaterThanOrEqual(2);
    expect(root.querySelector("ul ul ul li")?.textContent).toContain("leaf");
  });

  it("renders nested alpha ordered lists with ol type attributes in preview DOM", () => {
    const { bodyHTML } = renderMarkdownPreview({
      content: ["A. parent", "    A. child"].join("\n"),
      isMarkdownPreview: true,
      themeMode: "light",
      orderedListMode: "strict",
    });

    const root = document.createElement("div");
    root.className = "preview-pane-document markdown-body";
    root.innerHTML = bodyHTML;

    expect(root.querySelectorAll('ol[type="A"]').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(root.textContent).toContain("child");
  });

  it("renders blockquote nested lists with nested ul inside blockquote", () => {
    const { bodyHTML } = renderMarkdownPreview({
      content: ["> - parent", ">     - child"].join("\n"),
      isMarkdownPreview: true,
      themeMode: "light",
    });

    const root = document.createElement("div");
    root.className = "preview-pane-document markdown-body";
    root.innerHTML = bodyHTML;

    const blockquote = root.querySelector("blockquote");
    expect(blockquote).toBeTruthy();
    expect(blockquote?.querySelectorAll("ul").length).toBeGreaterThanOrEqual(2);
    expect(blockquote?.textContent).toContain("child");
  });
});
