/** @vitest-environment happy-dom */

import React, { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { FileNode } from "../../../types";
import { usePreviewRenderer } from "./usePreviewRenderer";

(globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ ??= false;

const mockedResolvePreviewSource = vi.fn<
  (src: string, sourceFilePath?: string) => Promise<string>
>(async (src) => `resolved:${src}`);
const mockedWarmPreviewImage = vi.fn<
  (src: string, sourceFilePath?: string) => Promise<string>
>(async (src) => `warmed:${src}`);

vi.mock("../../../utils/previewImageCache", () => ({
  resolvePreviewSource: (src: string, sourceFilePath?: string) =>
    mockedResolvePreviewSource(src, sourceFilePath),
  warmPreviewImage: (src: string, sourceFilePath?: string) =>
    mockedWarmPreviewImage(src, sourceFilePath),
  getCachedPreviewImageSrc: vi.fn(() => null),
  previewSourceNeedsMaterialization: vi.fn(() => false),
  mountLazyPreviewImageWarming: vi.fn(() => () => {}),
  hydrateCachedPreviewImageSources: vi.fn((html: string) => html),
  isUsablePreviewDisplaySrc: (src: string) =>
    Boolean(src?.trim()) &&
    !src.trim().startsWith("asset:") &&
    !src.trim().startsWith("tauri:"),
}));

vi.mock("../../../utils/attachmentResolver", () => ({
  createAttachmentResolverContext: vi.fn(() => ({})),
  resolveAttachmentTarget: vi.fn(),
}));

import { resolveAttachmentTarget } from "../../../utils/attachmentResolver";

const mockedResolveAttachmentTarget = vi.mocked(resolveAttachmentTarget);

interface HarnessOptions {
  content: string;
  testId?: string;
  currentFilePath?: string;
  activeTabId?: string;
  fileContents?: Record<string, string>;
  readFile?: (file: FileNode) => Promise<string>;
}

function MarkdownHarness(props: HarnessOptions) {
  const renderer = usePreviewRenderer({
    content: props.content,
    currentFilePath: props.currentFilePath ?? "/vault/notes/a.md",
    isMarkdownPreview: true,
    isHtmlPreview: false,
    highlighter: null,
    themeMode: "light",
    files: [],
    rootFolderPath: "/vault",
    fileContents: props.fileContents ?? {},
    activeTabId: props.activeTabId ?? "tab-a",
    readFile: props.readFile ?? (async () => ""),
  });

  const [html, setHtml] = useState(() => renderer.enhancedBodyHtml);

  useEffect(() => {
    setHtml(renderer.enhancedBodyHtml);
  }, [renderer.enhancedBodyHtml]);

  return (
    <div
      data-testid={props.testId ?? "out"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function queryOut(testId: string): HTMLElement {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (!node) {
    throw new Error(`Missing test container: ${testId}`);
  }
  return node as HTMLElement;
}

describe("usePreviewRenderer wiki embed integration", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const { previewSourceNeedsMaterialization } =
      await import("../../../utils/previewImageCache");
    vi.mocked(previewSourceNeedsMaterialization).mockReturnValue(false);
    mockedResolvePreviewSource.mockImplementation(
      async (src: string) => `resolved:${src}`,
    );
    mockedWarmPreviewImage.mockImplementation(
      async (src: string) => `warmed:${src}`,
    );
  });

  it("replaces sized wiki image embeds with resolved preview images and bare width attributes", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/99-Attachments/img/test.jpg",
      name: "test.jpg",
    });

    render(
      <MarkdownHarness
        testId="wiki-image-embed"
        content="![[99-Attachments/img/test.jpg|200]]"
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-image-embed");
      const image = out.querySelector("img.preview-attachment-image");
      expect(image).toBeTruthy();
      expect(image?.getAttribute("data-wiki-embed-w")).toBe("200");
      expect(image?.getAttribute("data-wiki-embed-w")).not.toContain("px");
      expect(image?.getAttribute("src")).toBe(
        "resolved:/vault/99-Attachments/img/test.jpg",
      );
      expect(image?.getAttribute("data-original-src")).toBe(
        "/vault/99-Attachments/img/test.jpg",
      );
      expect(out.querySelector("[data-wiki-embed]")).toBeNull();
    });
  });

  it("materializes local wiki images during enhance instead of empty pending src", async () => {
    const { previewSourceNeedsMaterialization } =
      await import("../../../utils/previewImageCache");
    vi.mocked(previewSourceNeedsMaterialization).mockReturnValue(true);
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/resources/测试-123.png",
      name: "测试-123.png",
    });

    render(
      <MarkdownHarness
        testId="wiki-image-materialize"
        content="![[resources/测试-123.png]]"
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-image-materialize");
      const image = out.querySelector("img.preview-attachment-image");
      expect(image).toBeTruthy();
      expect(image?.getAttribute("src")).toBe(
        "warmed:/vault/resources/测试-123.png",
      );
      expect(image?.getAttribute("data-preview-warmed")).toBe("true");
      expect(image?.hasAttribute("data-preview-pending-src")).toBe(false);
      expect(mockedWarmPreviewImage).toHaveBeenCalled();
    });
  });

  it("keeps missing wiki image embeds as an inline missing placeholder", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue(null);

    render(
      <MarkdownHarness
        testId="wiki-missing-embed"
        content="![[missing.png|120]]"
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-missing-embed");
      expect(out.textContent).toContain("Missing attachment:");
      expect(
        out.querySelector(".preview-attachment-file-missing"),
      ).toBeTruthy();
      expect(out.querySelector("img.preview-attachment-image")).toBeNull();
    });
  });

  it("replaces standalone YouTube links in a paragraph with an iframe embed", async () => {
    render(
      <MarkdownHarness
        testId="youtube-embed"
        content="[clip](https://www.youtube.com/watch?v=dQw4w9WgXcQ)"
      />,
    );

    await waitFor(() => {
      const out = queryOut("youtube-embed");
      const wrapper = out.querySelector(
        ".preview-external-video-embed.is-youtube",
      );
      const frame = wrapper?.querySelector(
        "iframe.preview-external-video-frame",
      );
      expect(frame?.getAttribute("src")).toBe(
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      );
    });
  });

  it("embeds another markdown note with rendered body content", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/notes/other-note.md",
      name: "other-note.md",
    });

    render(
      <MarkdownHarness
        testId="wiki-note-embed"
        content="![[other-note.md]]"
        readFile={async () => "# Other Note\n\nEmbedded paragraph"}
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-note-embed");
      const noteEmbed = out.querySelector("section.preview-note-embed");
      expect(noteEmbed).toBeTruthy();
      expect(
        noteEmbed?.querySelector(".preview-note-embed-title")?.textContent,
      ).toContain("other-note");
      expect(
        noteEmbed?.querySelector(".preview-note-embed-body")?.textContent,
      ).toContain("Embedded paragraph");
    });
  });

  it("uses in-memory note content when embedding the active tab file", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/notes/a.md",
      name: "a.md",
    });

    render(
      <MarkdownHarness
        testId="wiki-active-note-embed"
        currentFilePath="/vault/notes/a.md"
        activeTabId="tab-a"
        content={"# Current\n\n![[a.md#Section]]\n\nTail"}
        fileContents={{
          "tab-a": "# Current\n\n## Section\n\nActive buffer body",
        }}
        readFile={async () => {
          throw new Error(
            "readFile should not be called for active tab content",
          );
        }}
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-active-note-embed");
      const body = out.querySelector(".preview-note-embed-body");
      expect(body?.textContent).toContain("Active buffer body");
    });
  });

  it("blocks embedding the entire current note into itself", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/notes/a.md",
      name: "a.md",
    });

    render(
      <MarkdownHarness
        testId="wiki-self-embed"
        currentFilePath="/vault/notes/a.md"
        content={"# Home\n\n![[a.md]]"}
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-self-embed");
      expect(out.textContent).toContain(
        "Cannot embed the entire current note into itself",
      );
      expect(out.querySelector(".preview-note-embed")).toBeNull();
    });
  });

  it("shows a read failure placeholder for note embeds", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/notes/broken.md",
      name: "broken.md",
    });

    render(
      <MarkdownHarness
        testId="wiki-note-read-fail"
        content="![[broken.md]]"
        readFile={async () => {
          throw new Error("disk read failed");
        }}
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-note-read-fail");
      expect(out.textContent).toContain("Failed to read:");
      expect(
        out.querySelector(".preview-attachment-file-missing"),
      ).toBeTruthy();
    });
  });

  it("replaces wiki video embeds with a preview video element", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/media/clip.mp4",
      name: "clip.mp4",
    });

    render(
      <MarkdownHarness
        testId="wiki-video-embed"
        content="![[media/clip.mp4|320]]"
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-video-embed");
      const video = out.querySelector(
        "video.preview-attachment-video",
      ) as HTMLVideoElement | null;
      expect(video).toBeTruthy();
      expect(video?.getAttribute("src")).toBe("resolved:/vault/media/clip.mp4");
      expect(video?.style.width).toBe("320px");
    });
  });

  it("replaces wiki pdf embeds with a pdf.js mount container", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/papers/saycan.pdf",
      name: "saycan.pdf",
    });

    render(
      <MarkdownHarness
        testId="wiki-pdf-embed"
        content="![[papers/saycan.pdf]]"
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-pdf-embed");
      const pdf = out.querySelector(
        ".preview-attachment-pdf.preview-pdfjs",
      ) as HTMLElement | null;
      expect(pdf).toBeTruthy();
      expect(pdf?.dataset.pdfSrc).toBe("resolved:/vault/papers/saycan.pdf");
      expect(pdf?.dataset.pdfPath).toBe("/vault/papers/saycan.pdf");
      expect(pdf?.dataset.pdfjsState).toBe("pending");
    });
  });

  it("replaces wiki html embeds with a sanitized HTML attachment host", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/resources/card.html",
      name: "card.html",
    });

    render(
      <MarkdownHarness
        testId="wiki-html-embed"
        content="![[resources/card.html|420]]"
        readFile={async () =>
          '<h1>Card</h1><p>Body <img src="x" onerror="alert(1)"></p>'
        }
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-html-embed");
      const html = out.querySelector(
        ".preview-attachment-html.preview-html-document",
      ) as HTMLElement | null;
      expect(html).toBeTruthy();
      expect(html?.dataset.htmlPath).toBe("/vault/resources/card.html");
      const frame = html?.querySelector(
        "iframe.preview-html-frame",
      ) as HTMLIFrameElement | null;
      expect(frame).toBeTruthy();
      const srcdoc = frame?.getAttribute("srcdoc") ?? frame?.srcdoc ?? "";
      expect(srcdoc).toContain("Card");
      expect(srcdoc).toContain("Body");
      expect(srcdoc).not.toContain("onerror");
      expect(html?.style.width).toBe("420px");
      expect(html?.parentElement?.tagName).not.toBe("P");
    });
  });

  it("replaces unknown wiki attachment embeds with a generic file chip", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/archive/data.zip",
      name: "data.zip",
    });

    render(
      <MarkdownHarness
        testId="wiki-generic-embed"
        content="![[archive/data.zip]]"
      />,
    );

    await waitFor(() => {
      const out = queryOut("wiki-generic-embed");
      const attachment = out.querySelector(
        "a.preview-attachment-file",
      ) as HTMLAnchorElement | null;
      expect(attachment).toBeTruthy();
      expect(attachment?.dataset.attachmentPath).toBe(
        "/vault/archive/data.zip",
      );
      expect(
        attachment?.querySelector(".preview-attachment-file-name")?.textContent,
      ).toBe("data.zip");
      expect(
        attachment?.querySelector(".preview-attachment-file-hint")?.textContent,
      ).toContain("Finder");
    });
  });
});
