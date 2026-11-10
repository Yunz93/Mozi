/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShikiHighlighter } from "../hooks/useShikiHighlighter";
import {
  hasWikiEmbedsInHtml,
  hasEmbeddableMediaLinksInHtml,
  isPdfAttachment,
  isImageAttachment,
  isVideoAttachment,
  isMarkdownNote,
  resolveExternalVideoEmbed,
  createPreviewPdfContainer,
  isLocalPreviewLinkHref,
  getLocalPreviewLinkTarget,
} from "../components/editor/preview/previewMedia";
import {
  protectShikiPresInHtmlString,
  restoreShikiPresFromSnapshots,
} from "./shikiHtmlSnapshots";
import { renderMarkdown, clearMarkdownCache } from "./markdown";
import { shouldUseAsyncPreviewEnhancement } from "../components/editor/preview/previewRenderCore";

const fixturePath = resolve(
  import.meta.dirname,
  "__fixtures__/release-parity-markdown.md",
);

function createMockHighlighter(): ShikiHighlighter {
  const codeToHtml = vi.fn((code: string, _opts?: { lang?: string }) => {
    return (
      `<pre class="shiki markdown-press-light" style="background-color:#1e1e2e;color:#cdd6f4">` +
      `<code><span class="line"><span style="color:#89B4FA">${code}</span></span></code></pre>`
    );
  });
  return {
    codeToHtml,
    getLoadedLanguages: () => ["typescript", "python", "rust", "json"],
    supportsLanguage: () => true,
  };
}

function createErrorHighlighter(): ShikiHighlighter {
  const codeToHtml = vi.fn(() => {
    throw new Error("Shiki crashed");
  });
  return {
    codeToHtml,
    getLoadedLanguages: () => [],
    supportsLanguage: () => false,
  };
}

describe("release smoke — Shiki fenced code", () => {
  let highlighter: ShikiHighlighter;

  beforeEach(() => {
    clearMarkdownCache();
    (globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ = true;
    highlighter = createMockHighlighter();
  });

  it("renders fenced code blocks with Shiki markup", () => {
    const md = "```typescript\nconst x: number = 1;\n```";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain('class="shiki');
    expect(html).toContain('class="mp-shiki-block"');
    expect(html).toContain("const x: number = 1;");
  });

  it("renders code without language as plain text", () => {
    const md = "```\nplain text here\n```";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain("plain text here");
  });

  it("falls back when highlighter is null", () => {
    const md = "```rust\nlet x = 1;\n```";
    const html = renderMarkdown(md, { highlighter: null });

    expect(html).toContain('<code class="language-rust">');
  });

  it("survives highlighter crash without throwing", () => {
    const bad = createErrorHighlighter();
    const md = "```python\nprint('hello')\n```";

    expect(() => renderMarkdown(md, { highlighter: bad })).not.toThrow();
  });
});

describe("release smoke — Shiki snapshot round-trip (WKWebView)", () => {
  it("preserves inline token styles after protect + restore", () => {
    const original =
      '<div class="mp-shiki-block"><pre class="shiki markdown-press-light" style="background-color:#1e1e2e;color:#cdd6f4"><code><span class="line"><span style="color:#89B4FA">const x = 1;</span></span></code></pre></div>';
    const snapshots: string[] = [];
    const protected_ = protectShikiPresInHtmlString(original, snapshots);

    expect(snapshots.length).toBe(1);
    expect(protected_).toContain('data-mp-shiki-slot="0"');
    expect(protected_).toContain("data-mp-shiki-h=");
    expect(protected_).not.toContain('<pre class="shiki');

    const restored = restoreShikiPresFromSnapshots(protected_, snapshots);
    expect(restored).toBe(original);
  });

  it("restores with different hash (WKWebView may normalize hex casing)", () => {
    const original =
      '<div class="mp-shiki-block"><pre class="shiki markdown-press-light" style="background-color:#1e1e2e;color:#cdd6f4"><code><span class="line"><span style="color:#89B4FA">code</span></span></code></pre></div>';
    const snapshots: string[] = [];
    const protected_ = protectShikiPresInHtmlString(original, snapshots);

    // WKWebView may re-serialize the hash attribute with different casing
    const hashChanged = protected_.replace(
      /data-mp-shiki-h="([^"]*)"/g,
      (_, h) => `data-mp-shiki-h="${h.toUpperCase()}"`,
    );

    const restored = restoreShikiPresFromSnapshots(hashChanged, snapshots);
    expect(restored).toBe(original);
  });

  it("handles empty snapshots array", () => {
    expect(restoreShikiPresFromSnapshots("<p>noop</p>", [])).toBe(
      "<p>noop</p>",
    );
  });

  it("handles multiple Shiki blocks in one pass", () => {
    const block1 =
      '<div class="mp-shiki-block"><pre class="shiki"><code><span>a</span></code></pre></div>';
    const block2 =
      '<div class="mp-shiki-block"><pre class="shiki"><code><span>b</span></code></pre></div>';
    const html = `<p>before</p>${block1}<p>mid</p>${block2}<p>after</p>`;
    const snapshots: string[] = [];

    const protected_ = protectShikiPresInHtmlString(html, snapshots);
    expect(snapshots.length).toBe(2);

    const restored = restoreShikiPresFromSnapshots(protected_, snapshots);
    expect(restored).toBe(html);
  });
});

describe("release smoke — Mermaid diagrams", () => {
  let highlighter: ShikiHighlighter;

  beforeEach(() => {
    clearMarkdownCache();
    (globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ = true;
    highlighter = createMockHighlighter();
  });

  it("renders mermaid code blocks with mermaid class", () => {
    const md = "```mermaid\nflowchart TD\n  A --> B\n```";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD");
  });

  it("preserves mermaid content for client-side rendering", () => {
    const md = "```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain("sequenceDiagram");
    expect(html).toContain("Alice");
  });
});

describe("release smoke — KaTeX math", () => {
  let highlighter: ShikiHighlighter;

  beforeEach(() => {
    clearMarkdownCache();
    (globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ = true;
    highlighter = createMockHighlighter();
  });

  it("renders inline KaTeX", () => {
    const md = "Inline math: $a^2 + b^2 = c^2$";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain('class="katex"');
  });

  it("renders display KaTeX", () => {
    const md = "$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain('class="katex-display"');
  });

  it("survives malformed math expressions", () => {
    const md = "Broken math: $a + b^$";
    expect(() => renderMarkdown(md, { highlighter })).not.toThrow();
  });
});

describe("release smoke — wiki embeds and links", () => {
  let highlighter: ShikiHighlighter;

  beforeEach(() => {
    clearMarkdownCache();
    (globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ = true;
    highlighter = createMockHighlighter();
  });

  it("renders wiki links with data-wikilink attribute", () => {
    const md = "See [[Other Note]] for details.";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain("data-wikilink");
    expect(html).toContain("markdown-wikilink");
    expect(html).toContain("Other Note");
  });

  it("renders wiki links with aliases", () => {
    const md = "See [[Long Note Name|alias]] for details.";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain("alias");
  });

  it("renders heading wiki links", () => {
    const md = "Jump to [[#section-name]]";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain("data-wikilink");
  });

  it("renders image embeds with data-wiki-embed", () => {
    const md = "![[photo.png|320]]";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain('data-wiki-embed="true"');
    expect(html).toContain("photo.png");
  });

  it("renders PDF embeds with dimensions", () => {
    const md = "![[report.pdf|480x640]]";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain('data-wiki-embed="true"');
    expect(html).toContain("report.pdf");
  });

  it("renders generic attachment links", () => {
    const md = "Download: [[archive.zip]]";
    const html = renderMarkdown(md, { highlighter });

    expect(html).toContain("archive.zip");
  });
});

describe("release smoke — hasWikiEmbedsInHtml detection", () => {
  it("detects embed markers even with DOMPurify-reordered attributes", () => {
    // DOMPurify may normalize "data-wiki-embed" position — test we detect it
    const html =
      '<a class="markdown-embed" data-wiki-embed="true" data-wiki-target="test.pdf">test.pdf</a>';
    expect(hasWikiEmbedsInHtml(html)).toBe(true);
  });

  it("detects embeds when data-wiki-embed appears anywhere in markup", () => {
    const html =
      '<div data-wiki-embed="true" class="markdown-link markdown-embed">file.png</div>';
    expect(hasWikiEmbedsInHtml(html)).toBe(true);
  });

  it("returns false for plain links", () => {
    expect(hasWikiEmbedsInHtml('<a href="test.md">link</a>')).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasWikiEmbedsInHtml("")).toBe(false);
  });

  it("returns false for plain wikilinks (no embed marker)", () => {
    // data-wikilink is NOT data-wiki-embed — plain links don't need async enhancement
    const html =
      '<a data-wikilink="Other Note" class="markdown-wikilink">Other Note</a>';
    expect(hasWikiEmbedsInHtml(html)).toBe(false);
  });
});

describe("release smoke — external video embeds", () => {
  it("detects YouTube links in HTML", () => {
    const html =
      '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">video</a>';
    expect(hasEmbeddableMediaLinksInHtml(html)).toBe(true);
  });

  it("detects Bilibili links in HTML", () => {
    const html =
      '<a href="https://www.bilibili.com/video/BV1xx411c7mD">video</a>';
    expect(hasEmbeddableMediaLinksInHtml(html)).toBe(true);
  });

  it("resolves YouTube watch URLs to embed URLs", () => {
    const embed = resolveExternalVideoEmbed(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(embed).not.toBeNull();
    expect(embed!.provider).toBe("youtube");
    expect(embed!.src).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("resolves Bilibili BV URLs", () => {
    const embed = resolveExternalVideoEmbed(
      "https://www.bilibili.com/video/BV1xx411c7mD",
    );
    expect(embed).not.toBeNull();
    expect(embed!.provider).toBe("bilibili");
    expect(embed!.src).toContain("player.bilibili.com/player.html");
  });

  it("returns null for non-video URLs", () => {
    expect(resolveExternalVideoEmbed("https://example.com/page")).toBeNull();
  });
});

describe("release smoke — attachment type detection", () => {
  it("detects image attachments", () => {
    expect(isImageAttachment("photo.png")).toBe(true);
    expect(isImageAttachment("photo.jpg")).toBe(true);
    expect(isImageAttachment("photo.webp")).toBe(true);
    expect(isImageAttachment("photo.svg")).toBe(true);
    expect(isImageAttachment("document.pdf")).toBe(false);
  });

  it("detects PDF attachments", () => {
    expect(isPdfAttachment("report.pdf")).toBe(true);
    expect(isPdfAttachment("report.PDF")).toBe(true);
    expect(isPdfAttachment("photo.png")).toBe(false);
  });

  it("detects video attachments", () => {
    expect(isVideoAttachment("demo.mp4")).toBe(true);
    expect(isVideoAttachment("demo.webm")).toBe(true);
    expect(isVideoAttachment("readme.md")).toBe(false);
  });

  it("detects markdown notes", () => {
    expect(isMarkdownNote("readme.md")).toBe(true);
    expect(isMarkdownNote("readme.markdown")).toBe(true);
    expect(isMarkdownNote("script.js")).toBe(false);
  });
});

describe("release smoke — local preview links", () => {
  it("detects local file links", () => {
    expect(isLocalPreviewLinkHref("notes/other.md")).toBe(true);
    expect(isLocalPreviewLinkHref("attachments/file.pdf")).toBe(true);
    expect(isLocalPreviewLinkHref("https://example.com")).toBe(false);
    expect(isLocalPreviewLinkHref("#heading")).toBe(false);
    expect(isLocalPreviewLinkHref("")).toBe(false);
  });

  it("extracts local link target without hash/query", () => {
    expect(getLocalPreviewLinkTarget("notes/other.md#heading")).toBe(
      "notes/other.md",
    );
    expect(getLocalPreviewLinkTarget("notes/other.md")).toBe("notes/other.md");
    expect(getLocalPreviewLinkTarget("file.pdf?raw=true")).toBe("file.pdf");
  });
});

describe("release smoke — PDF preview container", () => {
  it("creates PDF container with correct dataset attributes", () => {
    const doc = document.implementation.createHTMLDocument();
    const container = createPreviewPdfContainer(
      doc,
      "/path/to/file.pdf",
      "Report",
      "/abs/path/to/file.pdf",
    );

    expect(container.className).toContain("preview-attachment-pdf");
    expect(container.className).toContain("preview-pdfjs");
    expect(container.dataset.pdfSrc).toBe("/path/to/file.pdf");
    expect(container.dataset.pdfTitle).toBe("Report");
    expect(container.dataset.pdfPath).toBe("/abs/path/to/file.pdf");
    expect(container.dataset.pdfjsState).toBe("pending");
    expect(container.textContent).toBe("Loading PDF...");
  });
});

describe("release smoke — full fixture parity", () => {
  let highlighter: ShikiHighlighter;

  beforeEach(() => {
    clearMarkdownCache();
    (globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ = true;
    highlighter = createMockHighlighter();
  });

  it("passes all release-critical invariants from fixture", () => {
    const markdown = readFileSync(fixturePath, "utf8");
    const html = renderMarkdown(markdown, { highlighter });

    // Shiki code blocks
    expect(html).toContain('class="shiki');
    expect(html).toContain("const answer = 42;");

    // Mermaid diagrams
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD");

    // KaTeX math
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');

    // Wiki links
    expect(html).toContain("data-wikilink");
    expect(html).toContain("markdown-wikilink");
    expect(html).toContain("Other Note");

    // Wiki embeds
    expect(html).toContain('data-wiki-embed="true"');
    expect(html).toContain("report.pdf");
    expect(html).toContain("attachments/archive.zip");

    // Async enhancement detection
    expect(shouldUseAsyncPreviewEnhancement(html, true)).toBe(true);
  });
});
