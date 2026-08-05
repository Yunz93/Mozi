/** @vitest-environment happy-dom */

import React, { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useAppStore } from "../../store/appStore";
import type { PreviewPaneHandle } from "./PreviewPane";

const {
  mockNavigateToWikilink,
  mockNavigateToHashLink,
  mockHandleFileSelect,
  mockHandleRevealInExplorer,
  mockMountPdfPreview,
  mockResolveAttachmentTarget,
  mockSyncScrollTo,
  mockCancelScrollSync,
  mockRenderMermaidDiagrams,
  mockResetMermaidPlaceholders,
  mockOpenExternalUrl,
} = vi.hoisted(() => ({
  mockNavigateToWikilink: vi.fn(async () => true),
  mockNavigateToHashLink: vi.fn(() => true),
  mockHandleFileSelect: vi.fn(async () => {}),
  mockHandleRevealInExplorer: vi.fn(async () => {}),
  mockOpenExternalUrl: vi.fn(async () => {}),
  mockMountPdfPreview: vi.fn<
    (
      container: HTMLElement,
      src: string,
      title: string,
      pdfPath?: string,
    ) => () => void
  >(() => () => {}),
  mockResolveAttachmentTarget: vi.fn(),
  mockSyncScrollTo: vi.fn(),
  mockCancelScrollSync: vi.fn(),
  mockRenderMermaidDiagrams: vi.fn<
    (
      container: HTMLElement,
      options?: { themeMode?: "light" | "dark" },
    ) => Promise<void>
  >(async () => {}),
  mockResetMermaidPlaceholders: vi.fn<(container: HTMLElement) => void>(
    () => {},
  ),
}));

vi.mock("../../hooks/useFileOperations", () => ({
  useFileOperations: () => ({
    handleFileSelect: mockHandleFileSelect,
    handleRevealInExplorer: mockHandleRevealInExplorer,
  }),
}));

vi.mock("../../hooks/useFileSystem", () => ({
  useFileSystem: () => ({
    readFile: vi.fn(async () => ""),
  }),
}));

vi.mock("../../utils/attachmentResolver", () => ({
  createAttachmentResolverContext: vi.fn(() => ({})),
  resolveAttachmentTarget: mockResolveAttachmentTarget,
}));

vi.mock("../../utils/pdfPreview", () => ({
  mountPdfPreview: mockMountPdfPreview,
}));

vi.mock("../../utils/previewImageCache", () => ({
  warmPreviewImage: vi.fn(async (src: string) => src),
  resolvePreviewSource: vi.fn(async (src: string) => src),
  getCachedPreviewImageSrc: vi.fn(() => null),
  previewSourceNeedsMaterialization: vi.fn(() => false),
  mountLazyPreviewImageWarming: vi.fn(() => () => {}),
  hydrateCachedPreviewImageSources: vi.fn((html: string) => html),
}));

vi.mock("../../utils/markdown-extensions", () => ({
  renderMermaidDiagrams: mockRenderMermaidDiagrams,
  resetMermaidPlaceholders: mockResetMermaidPlaceholders,
}));

vi.mock("../../utils/performance", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/performance")>();
  return {
    ...actual,
    useThrottledResize: () => () => {},
  };
});

vi.mock("./hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks")>();
  return {
    ...actual,
    usePreviewRenderer: vi.fn(() => ({
      parsedContent: {
        frontmatter: {
          title: "Note",
          tags: ["a", "b"],
          link: "https://example.com/doc",
        },
        bodyHTML: `
          <p><a class="markdown-wikilink" href="#" data-wikilink="Other Note">Other</a></p>
          <p><a href="https://example.com/page">External</a></p>
          <p><a href="../papers/local.pdf">Local PDF</a></p>
          <p><a href="#Section">Section</a></p>
          <a class="preview-attachment-file" data-attachment-path="/vault/data.zip" data-attachment-name="data.zip">
            <span class="preview-attachment-file-name">data.zip</span>
          </a>
        `,
      },
      enhancedBodyHtml: "",
      sanitizedHtmlPreview: "<p>html preview</p>",
      requiresAsyncEnhancement: false,
    })),
    usePreviewScroll: vi.fn(() => ({
      handleScroll: vi.fn(),
      cancelScrollSync: mockCancelScrollSync,
      syncScrollTo: mockSyncScrollTo,
      flushPendingScrollSync: vi.fn(),
      isSyncing: vi.fn(() => false),
    })),
    useWikiLinkNavigation: vi.fn(() => ({
      navigateToWikilink: mockNavigateToWikilink,
      navigateToHashLink: mockNavigateToHashLink,
      registerPane: vi.fn(),
      unregisterPane: vi.fn(),
      scrollToReference: vi.fn(),
      findHeadingElement: vi.fn(),
      findBlockElement: vi.fn(),
      clearScrollRetries: vi.fn(),
    })),
  };
});

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

vi.mock("../../utils/externalLinks", () => ({
  openExternalUrl: mockOpenExternalUrl,
}));

import { PreviewPane } from "./PreviewPane";

function seedMarkdownStore(
  overrides: Partial<ReturnType<typeof useAppStore.getState>> = {},
) {
  useAppStore.setState({
    settings: {
      language: "en",
      themeMode: "light",
      fontSize: 16,
      markdownStylePreset: "nord",
      orderedListMode: "strict",
      previewFontFamily: "system",
      codeFontFamily: "system",
    } as never,
    currentFilePath: "/vault/notes/a.md",
    rootFolderPath: "/vault",
    files: [
      {
        id: "/vault/notes/a.md",
        name: "a.md",
        path: "/vault/notes/a.md",
        type: "file",
      },
    ],
    activeTabId: "/vault/notes/a.md",
    fileContents: {
      "/vault/notes/a.md":
        "---\ntitle: Note\ntags:\n  - a\n  - b\nlink: https://example.com/doc\n---\n\n# Hello",
    },
    showNotification: vi.fn(),
    ...overrides,
  } as never);
}

describe("PreviewPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    seedMarkdownStore();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAppStore.setState({
      files: [],
      currentFilePath: null,
      activeTabId: null,
      fileContents: {},
    } as never);
  });

  it("renders markdown preview article and frontmatter properties", async () => {
    render(<PreviewPane previewRenderActive previewLayoutActive />);

    expect(await screen.findByText("Properties")).toBeTruthy();
    expect(
      await waitFor(() =>
        document.querySelector(".preview-pane-document.markdown-body"),
      ),
    ).toBeTruthy();
    expect(
      document.querySelector(".preview-pane-properties-multi-value-item")
        ?.textContent,
    ).toBe("a");
    expect(
      document.querySelector('a[href="https://example.com/doc"]'),
    ).toBeTruthy();
  });

  it("routes click events to wikilink, external, local, and hash handlers", async () => {
    mockResolveAttachmentTarget.mockResolvedValue({
      path: "/vault/papers/local.pdf",
      name: "local.pdf",
    });

    render(<PreviewPane previewRenderActive previewLayoutActive />);

    fireEvent.click(await screen.findByText("Other"));
    expect(mockNavigateToWikilink).toHaveBeenCalledWith("Other Note");

    fireEvent.click(screen.getByText("External"));
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://example.com/page",
    );

    fireEvent.click(screen.getByText("Local PDF"));
    await waitFor(() => {
      expect(mockHandleFileSelect).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/vault/papers/local.pdf" }),
      );
    });

    fireEvent.click(screen.getByText("Section"));
    expect(mockNavigateToHashLink).toHaveBeenCalledWith("Section");
  });

  it("reveals attachments on double-click", async () => {
    render(<PreviewPane previewRenderActive previewLayoutActive />);

    const attachment = await waitFor(
      () => document.querySelector("[data-attachment-path]") as HTMLElement,
    );
    fireEvent.doubleClick(attachment);
    expect(mockHandleRevealInExplorer).toHaveBeenCalledWith("/vault/data.zip");
  });

  it("renders asset tabs for image, video, pdf, html, and unsupported files", async () => {
    const cases = [
      {
        path: "/vault/img/photo.png",
        selector: "img.preview-attachment-image",
      },
      {
        path: "/vault/media/clip.mp4",
        selector: "video.preview-pane-video-player",
      },
      {
        path: "/vault/papers/paper.pdf",
        selector: ".preview-pdfjs[data-pdf-src]",
      },
      { path: "/vault/page.html", selector: ".preview-html-document" },
      {
        path: "/vault/readme.txt",
        text: "Preview is not supported for this file type.",
      },
    ] as const;

    for (const testCase of cases) {
      cleanup();
      seedMarkdownStore({
        currentFilePath: testCase.path,
        activeTabId: testCase.path,
      });
      render(<PreviewPane previewRenderActive previewLayoutActive />);
      if ("selector" in testCase) {
        await waitFor(() => {
          expect(document.querySelector(testCase.selector)).toBeTruthy();
        });
      } else {
        expect(await screen.findByText(testCase.text)).toBeTruthy();
      }
    }
  });

  it("exposes imperative scroll helpers on the ref handle", () => {
    const ref = createRef<PreviewPaneHandle>();
    render(
      <PreviewPane
        ref={ref}
        previewRenderActive
        previewLayoutActive
        syncedPercentage={0.25}
      />,
    );

    ref.current?.syncScrollTo(0.5, { immediate: true });
    expect(mockSyncScrollTo).toHaveBeenCalled();

    ref.current?.cancelScrollSync();
    expect(mockCancelScrollSync).toHaveBeenCalled();

    ref.current?.scrollToTop();
    ref.current?.restoreScrollPosition({ top: 120, left: 0 });
    expect(ref.current?.getScrollPosition().top).toBeGreaterThanOrEqual(0);
  });

  it("mounts pdf.js preview containers discovered in markdown", async () => {
    const { usePreviewRenderer } = await import("./hooks");
    vi.mocked(usePreviewRenderer).mockReturnValueOnce({
      parsedContent: {
        frontmatter: null,
        bodyHTML:
          '<div class="preview-pdfjs" data-pdf-src="blob:pdf" data-pdf-title="Paper"></div>',
      },
      enhancedBodyHtml:
        '<div class="preview-pdfjs" data-pdf-src="blob:pdf" data-pdf-title="Paper"></div>',
      sanitizedHtmlPreview: "",
      requiresAsyncEnhancement: false,
    });

    render(<PreviewPane previewRenderActive previewLayoutActive />);
    await waitFor(() => {
      expect(mockMountPdfPreview).toHaveBeenCalled();
    });
  });

  it("renders mermaid diagrams after markdown paint when preview layout is active", async () => {
    const { usePreviewRenderer } = await import("./hooks");
    vi.mocked(usePreviewRenderer).mockReturnValue({
      parsedContent: {
        frontmatter: null,
        bodyHTML: '<div class="mermaid">graph TD; A-->B;</div>',
      },
      enhancedBodyHtml: '<div class="mermaid">graph TD; A-->B;</div>',
      sanitizedHtmlPreview: "",
      requiresAsyncEnhancement: false,
    });

    render(<PreviewPane previewRenderActive previewLayoutActive />);

    await waitFor(() => {
      expect(mockRenderMermaidDiagrams).toHaveBeenCalled();
    });
  });

  it("skips mermaid rendering when the preview column has zero layout width", async () => {
    const { usePreviewRenderer } = await import("./hooks");
    vi.mocked(usePreviewRenderer).mockReturnValue({
      parsedContent: {
        frontmatter: null,
        bodyHTML: '<div class="mermaid">graph TD; A-->B;</div>',
      },
      enhancedBodyHtml: '<div class="mermaid">graph TD; A-->B;</div>',
      sanitizedHtmlPreview: "",
      requiresAsyncEnhancement: false,
    });

    render(<PreviewPane previewRenderActive previewLayoutActive={false} />);

    await waitFor(() => {
      expect(document.querySelector(".mermaid")).toBeTruthy();
    });
    expect(mockRenderMermaidDiagrams).not.toHaveBeenCalled();
  });

  it("does not attempt mermaid rendering when there are too many diagrams", async () => {
    const manyMermaidNodes = Array.from(
      { length: 21 },
      (_, index) =>
        `<div class="mermaid">graph TD; A${index}-->B${index};</div>`,
    ).join("");

    const { usePreviewRenderer } = await import("./hooks");
    vi.mocked(usePreviewRenderer).mockReturnValue({
      parsedContent: {
        frontmatter: null,
        bodyHTML: manyMermaidNodes,
      },
      enhancedBodyHtml: manyMermaidNodes,
      sanitizedHtmlPreview: "",
      requiresAsyncEnhancement: false,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<PreviewPane previewRenderActive previewLayoutActive />);

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Too many Mermaid diagrams"),
      );
    });
    expect(mockRenderMermaidDiagrams).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
