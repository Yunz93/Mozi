/** @vitest-environment happy-dom */

import React, { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { clearMarkdownCache } from "../../../utils/markdown";
import type { ShikiHighlighter } from "../../../hooks/useShikiHighlighter";
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

function RendererHarness(props: {
  content: string;
  enabled?: boolean;
  highlighter?: ShikiHighlighter | null;
}) {
  const renderer = usePreviewRenderer({
    content: props.content,
    currentFilePath: "/vault/notes/a.md",
    isMarkdownPreview: true,
    isHtmlPreview: false,
    highlighter: props.highlighter ?? null,
    themeMode: "light",
    files: [],
    rootFolderPath: "/vault",
    fileContents: {},
    activeTabId: "tab-a",
    readFile: async () => "",
    enabled: props.enabled ?? true,
  });

  const [html, setHtml] = useState(() => renderer.enhancedBodyHtml);

  useEffect(() => {
    setHtml(renderer.enhancedBodyHtml);
  }, [renderer.enhancedBodyHtml]);

  return (
    <div
      data-testid="out"
      data-body={renderer.parsedContent.bodyHTML}
      data-requires-async={String(renderer.requiresAsyncEnhancement)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

describe("usePreviewRenderer additional coverage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearMarkdownCache();
    mockedResolvePreviewSource.mockImplementation(
      async (src: string) => `resolved:${src}`,
    );
    mockedWarmPreviewImage.mockImplementation(
      async (src: string) => `warmed:${src}`,
    );
  });

  it("skips parsing and async enhancement when disabled", async () => {
    render(<RendererHarness content="# Title" enabled={false} />);

    await waitFor(() => {
      const out = document.querySelector('[data-testid="out"]') as HTMLElement;
      expect(out.dataset.body).toBe("");
      expect(out.dataset.requiresAsync).toBe("false");
      expect(out.innerHTML).toBe("");
    });
  });

  it("replaces inline markdown images that resolve to video attachments", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/media/clip.mp4",
      name: "clip.mp4",
    });

    render(<RendererHarness content="![clip](media/clip.mp4)" />);

    await waitFor(() => {
      const out = document.querySelector('[data-testid="out"]') as HTMLElement;
      const video = out.querySelector(
        "video.preview-attachment-video",
      ) as HTMLVideoElement | null;
      expect(video).toBeTruthy();
      expect(video?.getAttribute("src")).toBe("resolved:/vault/media/clip.mp4");
      expect(out.querySelector("img")).toBeNull();
    });
  });

  it("applies Obsidian pipe size on standard markdown images", async () => {
    mockedResolveAttachmentTarget.mockResolvedValue(null);

    render(
      <RendererHarness content="![墨知正式版-1787670846943|300](https://example.com/ink.png)" />,
    );

    await waitFor(() => {
      const out = document.querySelector('[data-testid="out"]') as HTMLElement;
      const image = out.querySelector("img") as HTMLImageElement | null;
      expect(image).toBeTruthy();
      expect(image?.getAttribute("alt")).toBe("墨知正式版-1787670846943");
      expect(image?.getAttribute("width")).toBe("300");
      expect(image?.getAttribute("data-wiki-embed-w")).toBe("300");
      expect(image?.style.width).toBe("300px");
    });
  });

  it("clears markdown cache when the highlighter becomes available", async () => {
    const clearSpy = vi.spyOn(
      await import("../../../utils/markdown"),
      "clearMarkdownCache",
    );

    const mockHighlighter: ShikiHighlighter = {
      codeToHtml: () => "",
    };

    const { rerender } = render(
      <RendererHarness content="# One" highlighter={null} />,
    );
    rerender(<RendererHarness content="# One" highlighter={mockHighlighter} />);

    await waitFor(() => {
      expect(clearSpy).toHaveBeenCalled();
    });
  });
});
