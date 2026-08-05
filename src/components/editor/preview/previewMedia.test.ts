/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import {
  buildIframeEmbed,
  configurePreviewImageElement,
  createPreviewHtmlContainer,
  createPreviewPdfContainer,
  getLocalPreviewLinkTarget,
  hasEmbeddableMediaLinksInHtml,
  hasUriScheme,
  hasWikiEmbedsInHtml,
  isHtmlDocument,
  isImageAttachment,
  isLocalPreviewLinkHref,
  isMarkdownNote,
  isExcalidrawAttachment,
  isPdfAttachment,
  isVideoAttachment,
  normalizeExistingIframe,
  resolveExternalVideoEmbed,
} from "./previewMedia";

describe("hasWikiEmbedsInHtml", () => {
  it("detects embed markup regardless of class token order", () => {
    expect(
      hasWikiEmbedsInHtml(
        '<a class="markdown-embed markdown-link" href="#" data-wiki-embed="true"></a>',
      ),
    ).toBe(true);
  });

  it('detects data-wiki-embed without requiring ="true" substring', () => {
    expect(
      hasWikiEmbedsInHtml(
        '<a data-wiki-embed href="#" class="markdown-link markdown-embed"></a>',
      ),
    ).toBe(true);
  });

  it("is false for plain wikilinks", () => {
    expect(
      hasWikiEmbedsInHtml(
        '<a class="markdown-wikilink" data-wikilink="X"></a>',
      ),
    ).toBe(false);
  });
});

describe("configurePreviewImageElement", () => {
  it("uses lazy async image defaults for preview images", () => {
    const image = document.createElement("img");

    configurePreviewImageElement(image, "resolved.png", "poster.png");

    expect(image.getAttribute("src")).toBe("resolved.png");
    expect(image.getAttribute("data-original-src")).toBe("poster.png");
    expect(image.getAttribute("data-preview-warmed")).toBe("true");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("fetchpriority")).toBe("auto");
  });

  it("marks pending images without a display src for viewport warming", () => {
    const image = document.createElement("img");

    configurePreviewImageElement(image, "", "/vault/photo.png", {
      warmed: false,
    });

    expect(image.hasAttribute("src")).toBe(false);
    expect(image.getAttribute("data-original-src")).toBe("/vault/photo.png");
    expect(image.getAttribute("data-preview-pending-src")).toBe(
      "/vault/photo.png",
    );
    expect(image.getAttribute("data-preview-warmed")).toBe("pending");
    expect(image.getAttribute("loading")).toBe("lazy");
  });
});

describe("local preview links", () => {
  it("detects relative PDF links as local links handled by the app", () => {
    expect(isLocalPreviewLinkHref("../papers/saycan.pdf")).toBe(true);
    expect(isLocalPreviewLinkHref("papers/saycan.pdf#page=2")).toBe(true);
  });

  it("uses hasUriScheme to reject external and protocol-prefixed hrefs", () => {
    expect(hasUriScheme("https://example.com")).toBe(true);
    expect(hasUriScheme("mailto:hi@example.com")).toBe(true);
    expect(hasUriScheme("../local/file.pdf")).toBe(false);
    expect(isLocalPreviewLinkHref("https://example.com/paper.pdf")).toBe(false);
  });

  it("does not treat external URLs or hash anchors as local files", () => {
    expect(isLocalPreviewLinkHref("https://example.com/paper.pdf")).toBe(false);
    expect(isLocalPreviewLinkHref("#references")).toBe(false);
    expect(isLocalPreviewLinkHref("//example.com/paper.pdf")).toBe(false);
  });

  it("strips PDF viewer hash and query suffixes before resolving the file", () => {
    expect(getLocalPreviewLinkTarget("../papers/saycan.pdf#page=2")).toBe(
      "../papers/saycan.pdf",
    );
    expect(getLocalPreviewLinkTarget("../papers/saycan.pdf?download=1")).toBe(
      "../papers/saycan.pdf",
    );
  });

  it("decodes percent-encoded Chinese filenames from markdown hrefs", () => {
    expect(
      getLocalPreviewLinkTarget(
        "%E5%85%B7%E8%BA%AB%E6%99%BA%E8%83%BD%E5%BC%80%E6%BA%90%E5%B9%B3%E5%8F%B0%E5%AE%8C%E6%95%B4%20PRD.md",
      ),
    ).toBe("具身智能开源平台完整 PRD.md");
  });
});

describe("hasEmbeddableMediaLinksInHtml", () => {
  it("detects YouTube and Bilibili watch links in rendered html", () => {
    expect(
      hasEmbeddableMediaLinksInHtml(
        '<a href="https://www.youtube.com/watch?v=abc">x</a>',
      ),
    ).toBe(true);
    expect(
      hasEmbeddableMediaLinksInHtml('<a href="https://youtu.be/abc">x</a>'),
    ).toBe(true);
    expect(
      hasEmbeddableMediaLinksInHtml(
        '<a href="https://www.bilibili.com/video/BV1xx411c7mD">x</a>',
      ),
    ).toBe(true);
    expect(
      hasEmbeddableMediaLinksInHtml(
        '<a href="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD">x</a>',
      ),
    ).toBe(true);
  });

  it("is false for unrelated links", () => {
    expect(
      hasEmbeddableMediaLinksInHtml(
        '<a href="https://example.com/watch?v=abc">x</a>',
      ),
    ).toBe(false);
    expect(hasEmbeddableMediaLinksInHtml("<p>no links</p>")).toBe(false);
  });
});

describe("resolveExternalVideoEmbed", () => {
  it("resolves YouTube watch, shorts, and youtu.be links", () => {
    expect(
      resolveExternalVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toEqual({
      provider: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      title: "YouTube video",
    });

    expect(resolveExternalVideoEmbed("https://youtu.be/abc123?t=30s")).toEqual({
      provider: "youtube",
      src: "https://www.youtube-nocookie.com/embed/abc123?start=30",
      title: "YouTube video",
    });

    expect(
      resolveExternalVideoEmbed("https://www.youtube.com/shorts/short123"),
    ).toEqual({
      provider: "youtube",
      src: "https://www.youtube-nocookie.com/embed/short123",
      title: "YouTube video",
    });
  });

  it("resolves Bilibili BV and av links", () => {
    expect(
      resolveExternalVideoEmbed(
        "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
      ),
    ).toEqual({
      provider: "bilibili",
      src: "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=2",
      title: "Bilibili video",
    });

    expect(
      resolveExternalVideoEmbed("https://www.bilibili.com/video/av12345"),
    ).toEqual({
      provider: "bilibili",
      src: "https://player.bilibili.com/player.html?aid=12345",
      title: "Bilibili video",
    });
  });

  it("returns null for unsupported urls", () => {
    expect(resolveExternalVideoEmbed("https://example.com/video/1")).toBeNull();
    expect(resolveExternalVideoEmbed("not-a-url")).toBeNull();
  });
});

describe("buildIframeEmbed", () => {
  it("builds a provider-scoped iframe wrapper", () => {
    const embed = resolveExternalVideoEmbed("https://youtu.be/abc123");
    expect(embed).not.toBeNull();

    const wrapper = buildIframeEmbed(document, embed!);
    expect(wrapper.className).toBe("preview-external-video-embed is-youtube");

    const frame = wrapper.querySelector("iframe") as HTMLIFrameElement | null;
    expect(frame?.className).toBe("preview-external-video-frame");
    expect(frame?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(frame?.loading).toBe("lazy");
    expect(frame?.allowFullscreen).toBe(true);
  });
});

describe("normalizeExistingIframe", () => {
  it("fills in preview iframe defaults without overwriting existing attrs", () => {
    const frame = document.createElement("iframe");
    frame.setAttribute("loading", "eager");

    normalizeExistingIframe(frame);

    expect(frame.classList.contains("preview-external-video-frame")).toBe(true);
    expect(frame.getAttribute("loading")).toBe("eager");
    expect(frame.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(frame.getAttribute("allow")).toContain("picture-in-picture");
  });
});

describe("attachment type helpers", () => {
  it("classifies common preview attachment extensions", () => {
    expect(isImageAttachment("photo.JPG")).toBe(true);
    expect(isVideoAttachment("clip.webm")).toBe(true);
    expect(isPdfAttachment("paper.pdf")).toBe(true);
    expect(isMarkdownNote("note.markdown")).toBe(true);
    expect(isHtmlDocument("page.HTM")).toBe(true);
    expect(isExcalidrawAttachment("board.excalidraw")).toBe(true);
    expect(isExcalidrawAttachment("board.excalidraw.json")).toBe(true);
    expect(isImageAttachment("readme.txt")).toBe(false);
  });
});

describe("createPreviewPdfContainer", () => {
  it("creates a pending pdf.js mount container with metadata", () => {
    const container = createPreviewPdfContainer(
      document,
      "blob:pdf",
      "Paper",
      "/vault/paper.pdf",
    );

    expect(container.className).toContain("preview-pdfjs");
    expect(container.dataset.pdfSrc).toBe("blob:pdf");
    expect(container.dataset.pdfTitle).toBe("Paper");
    expect(container.dataset.pdfPath).toBe("/vault/paper.pdf");
    expect(container.dataset.pdfjsState).toBe("pending");
  });
});

describe("createPreviewHtmlContainer", () => {
  it("creates a plain-text HTML source host with metadata", () => {
    const source = "<p>Hello <strong>HTML</strong></p>";
    const container = createPreviewHtmlContainer(document, source, {
      title: "Snippet",
      path: "/vault/resources/page.html",
    });

    expect(container.className).toContain("preview-attachment-html");
    expect(container.className).toContain("preview-html-source");
    expect(container.dataset.htmlPath).toBe("/vault/resources/page.html");
    expect(container.dataset.htmlTitle).toBe("Snippet");
    const pre = container.querySelector("pre.preview-html-source-pre");
    expect(pre?.textContent).toBe(source);
    // Must not render markup as DOM — source stays escaped as text.
    expect(container.querySelector("strong")).toBeNull();
  });
});
