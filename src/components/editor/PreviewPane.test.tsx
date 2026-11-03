/** @vitest-environment happy-dom */

import React, { createRef } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useAppStore } from "../../store/appStore";
import type { PreviewPaneHandle } from "./PreviewPane";
import { useWikiLinkNavigation as useNavigationHook } from "./hooks";
import {
  useWikiLinkNavigation as useRealWikiLinkNavigation,
  type UseWikiLinkNavigationOptions,
} from "./hooks/useWikiLinkNavigation";
import {
  __resetPreviewNavigationBridgeForTests,
  flushPendingPreviewHeadingScroll,
  registerPreviewPane,
  requestPreviewHeadingScroll,
  unregisterPreviewPane,
} from "../../utils/previewNavigationBridge";

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
  mockRegisterPane,
  mockUnregisterPane,
} = vi.hoisted(() => ({
  mockNavigateToWikilink: vi.fn(async () => true),
  mockNavigateToHashLink: vi.fn(() => true),
  mockHandleFileSelect: vi.fn(async () => {}),
  mockHandleRevealInExplorer: vi.fn(async () => {}),
  mockOpenExternalUrl: vi.fn(async () => {}),
  mockRegisterPane: vi.fn(),
  mockUnregisterPane: vi.fn(),
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
  isUsablePreviewDisplaySrc: (src: string) =>
    Boolean(src?.trim()) &&
    !src.trim().startsWith("asset:") &&
    !src.trim().startsWith("tauri:"),
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
      registerPane: mockRegisterPane,
      unregisterPane: mockUnregisterPane,
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

const defaultMockNavigation = vi
  .mocked(useNavigationHook)
  .getMockImplementation()!;
let realNavigation: ReturnType<typeof useRealWikiLinkNavigation> | null = null;

function useTrackedWikiLinkNavigation(options: UseWikiLinkNavigationOptions) {
  const navigation = useRealWikiLinkNavigation(options);
  realNavigation = navigation;
  return navigation;
}

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
    mockRegisterPane.mockReset();
    mockUnregisterPane.mockReset();
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    seedMarkdownStore();
  });

  afterEach(() => {
    cleanup();
    vi.mocked(useNavigationHook).mockImplementation(defaultMockNavigation);
    realNavigation = null;
    vi.unstubAllGlobals();
    useAppStore.setState({
      files: [],
      currentFilePath: null,
      activeTabId: null,
      fileContents: {},
    } as never);
  });

  it.each([false, true])(
    "keeps real local Wiki retries across a rerender, with document change=%s",
    async (changeDocument) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          callback(0);
          return 1;
        },
      );
      vi.mocked(useNavigationHook).mockImplementation(
        useTrackedWikiLinkNavigation,
      );
      seedMarkdownStore({
        fileContents: {
          "/vault/notes/a.md": "# Hello\n\n## Late target\nPending section",
        },
      });
      try {
        const mounted = render(<PreviewPane />);
        const pane = document.querySelector<HTMLElement>(
          ".preview-scroll-container",
        )!;
        Object.defineProperties(pane, {
          clientHeight: { value: 400 },
          scrollHeight: { value: 3000 },
        });
        pane.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
        const scrollTo = vi.fn();
        pane.scrollTo = scrollTo;
        await act(async () => {
          expect(await realNavigation!.navigateToWikilink("#Late target")).toBe(
            true,
          );
        });
        expect(scrollTo).not.toHaveBeenCalled();
        mockCancelScrollSync.mockClear();

        if (changeDocument) {
          act(() =>
            useAppStore.setState({
              activeTabId: "/vault/notes/b.md",
              currentFilePath: "/vault/notes/b.md",
              fileContents: { "/vault/notes/b.md": "# Another note" },
            }),
          );
        } else {
          mounted.rerender(<PreviewPane density="compact" />);
        }
        const heading = document.createElement("h2");
        heading.id = "late-target";
        heading.textContent = "Late target";
        heading.getBoundingClientRect = () =>
          ({ top: 1600, height: 40 }) as DOMRect;
        pane.querySelector("article.markdown-body")!.appendChild(heading);
        act(() => vi.advanceTimersByTime(48));

        if (changeDocument) {
          expect(scrollTo).not.toHaveBeenCalled();
          expect(mockCancelScrollSync).toHaveBeenCalled();
        } else {
          expect(scrollTo).toHaveBeenCalledWith({
            top: 1420,
            behavior: "smooth",
          });
          expect(mockCancelScrollSync).not.toHaveBeenCalled();
        }
      } finally {
        cleanup();
        vi.useRealTimers();
      }
    },
  );

  it("keeps real pending heading retries through a normal pane rerender", () => {
    __resetPreviewNavigationBridgeForTests();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const tabId = "/vault/notes/a.md";
    mockRegisterPane.mockImplementation((element: HTMLElement) => {
      registerPreviewPane(tabId, element);
      flushPendingPreviewHeadingScroll(tabId);
    });
    mockUnregisterPane.mockImplementation((element: HTMLElement) => {
      unregisterPreviewPane(tabId, element);
    });
    try {
      const mounted = render(<PreviewPane />);
      const pane = document.querySelector<HTMLElement>(
        ".preview-scroll-container",
      )!;
      Object.defineProperties(pane, {
        clientHeight: { value: 400 },
        scrollHeight: { value: 3000 },
      });
      pane.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      const scrollTo = vi.fn();
      pane.scrollTo = scrollTo;
      expect(requestPreviewHeadingScroll(tabId, "late-target")).toBe(false);

      mounted.rerender(<PreviewPane density="compact" />);
      const heading = document.createElement("h2");
      heading.id = "late-target";
      heading.textContent = "Late target";
      heading.getBoundingClientRect = () =>
        ({ top: 1600, height: 40 }) as DOMRect;
      pane.querySelector("article.markdown-body")!.appendChild(heading);
      vi.advanceTimersByTime(16);

      expect(scrollTo).toHaveBeenCalledWith({ top: 1528, behavior: "auto" });
      expect(mockRegisterPane).toHaveBeenCalledOnce();
      expect(mockUnregisterPane).not.toHaveBeenCalled();
    } finally {
      __resetPreviewNavigationBridgeForTests();
      vi.useRealTimers();
    }
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

  it.each([
    [true, "comfortable"],
    [false, "comfortable"],
    [true, "compact"],
    [false, "compact"],
  ] as const)(
    "shares prose insets with properties when readable width is %s and density is %s",
    async (readableLineLength, density) => {
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, readableLineLength },
      });
      const style = document.createElement("style");
      const layoutSelectors = new Set([
        ".editor-pane-layout",
        ".editor-pane-frame",
        ".editor-pane-sheet",
        ".editor-pane-width-constrained",
        ".preview-pane-properties-layout",
        ".preview-pane-document.markdown-body",
      ]);
      // 只检查横向布局，排除模拟器不支持的选择器与底部留白嵌套变量。
      style.textContent = ["editor.css", "preview.css"]
        .flatMap((name) => {
          const rules: string[] = [];
          postcss
            .parse(
              readFileSync(resolve(process.cwd(), "src/styles", name), "utf8"),
            )
            .walkRules((rule) => {
              if (
                layoutSelectors.has(rule.selector) &&
                rule.parent?.type === "root"
              ) {
                rules.push(rule.toString());
              }
            });
          return rules;
        })
        .join("\n")
        .replace(
          "var(--preview-content-bottom, var(--pane-content-bottom))",
          "0px",
        );
      document.head.appendChild(style);
      try {
        render(
          <PreviewPane
            density={density}
            previewRenderActive
            previewLayoutActive
          />,
        );
        await screen.findByText("Properties");
        const properties = document.querySelector(".preview-pane-properties")!;
        const article = document.querySelector(".preview-pane-document")!;
        const propertiesLayout = getComputedStyle(properties.parentElement!);
        const sheetLayout = getComputedStyle(article.parentElement!);
        const proseLayout = getComputedStyle(article);
        expect(propertiesLayout.maxWidth).toBe(sheetLayout.maxWidth);
        expect(sheetLayout.maxWidth).toBe("100%");
        expect(propertiesLayout.paddingLeft).toBe(proseLayout.paddingLeft);
        expect(propertiesLayout.paddingRight).toBe(proseLayout.paddingRight);
        expect(parseFloat(propertiesLayout.paddingLeft)).toBeGreaterThan(0);
      } finally {
        style.remove();
      }
    },
  );

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
      {
        path: "/vault/page.html",
        selector:
          ".preview-html-document-frame iframe.preview-html-frame, .preview-html-document iframe.preview-html-frame",
      },
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

  it("preserves hydrated images and heading targets across layout rerenders", async () => {
    const { usePreviewRenderer } = await import("./hooks");
    const bodyHTML =
      '<h2>Excalidraw 画板</h2><img data-preview-pending-src="resources/board.png">';
    vi.mocked(usePreviewRenderer).mockReturnValue({
      parsedContent: { frontmatter: null, bodyHTML },
      enhancedBodyHtml: bodyHTML,
      sanitizedHtmlPreview: "",
      requiresAsyncEnhancement: false,
    });
    seedMarkdownStore({
      fileContents: { "/vault/notes/a.md": "## Excalidraw 画板" },
    });
    const pane = render(
      <PreviewPane previewRenderActive previewLayoutActive />,
    );
    const heading = pane.container.querySelector("article h2")!;
    const image = pane.container.querySelector("article img")!;
    expect(heading.id).toBe("excalidraw-画板");
    image.setAttribute("src", "blob:hydrated-drawing");
    image.removeAttribute("data-preview-pending-src");

    pane.rerender(
      <PreviewPane density="compact" previewRenderActive previewLayoutActive />,
    );
    expect(pane.container.querySelector("article h2")).toBe(heading);
    expect(pane.container.querySelector("article h2")?.id).toBe(
      "excalidraw-画板",
    );
    expect(
      pane.container.querySelector("article img")?.getAttribute("src"),
    ).toBe("blob:hydrated-drawing");

    act(() =>
      seedMarkdownStore({
        activeTabId: "/vault/notes/b.md",
        currentFilePath: "/vault/notes/b.md",
        fileContents: { "/vault/notes/b.md": "## Excalidraw 画板" },
      }),
    );
    expect(pane.container.querySelector("article img")).not.toBe(image);
    expect(
      pane.container.querySelector("article img")?.getAttribute("src"),
    ).toBeNull();

    vi.mocked(usePreviewRenderer).mockReturnValue({
      parsedContent: { frontmatter: null, bodyHTML: "<p>Updated content</p>" },
      enhancedBodyHtml: "<p>Updated content</p>",
      sanitizedHtmlPreview: "",
      requiresAsyncEnhancement: false,
    });
    pane.rerender(
      <PreviewPane density="compact" previewRenderActive previewLayoutActive />,
    );
    expect(pane.container.querySelector("article")?.textContent).toBe(
      "Updated content",
    );
    expect(pane.container.querySelector("article img")).toBeNull();
  });
});
