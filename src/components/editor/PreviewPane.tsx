/**
 * PreviewPane - 简化重构版
 *
 * 使用新提取的 hooks：
 * - usePreviewRenderer: Markdown/HTML 渲染
 * - usePreviewScroll: 滚动同步
 * - useWikiLinkNavigation: WikiLink 导航
 */

import React, {
  forwardRef,
  useRef,
  useMemo,
  useImperativeHandle,
  useLayoutEffect,
  useCallback,
  useState,
  useEffect,
  useDeferredValue,
} from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore, selectContent } from "../../store/appStore";
import {
  getPaneLayoutMetrics,
  scalePaneLayoutMetrics,
  type PaneDensity,
} from "./paneLayout";
import { useFileOperations } from "../../hooks/useFileOperations";
import { useFileSystem } from "../../hooks/useFileSystem";
import {
  getResolvedCodeFontFamily,
  getResolvedPreviewFontFamily,
} from "../../utils/fontSettings";
import {
  getScaledCodeFontSize,
  getScaledEditorFontSize,
  getUiFontScale,
} from "../../utils/uiFontSize";
import {
  usePreviewRenderer,
  usePreviewScroll,
  useWikiLinkNavigation,
} from "./hooks";
import {
  getLocalPreviewLinkTarget,
  getPreviewFileType,
  isImageAttachment,
  isLocalPreviewLinkHref,
} from "./preview/previewMedia";
import { mountPdfPreview } from "../../utils/pdfPreview";
import { debounce, throttle } from "../../utils/throttle";
import { useThrottledResize } from "../../utils/performance";
import {
  mountLazyPreviewImageWarming,
  resolvePreviewSource,
  warmPreviewImage,
} from "../../utils/previewImageCache";
import {
  createAttachmentResolverContext,
  resolveAttachmentTarget,
} from "../../utils/attachmentResolver";
import { renderMermaidDiagrams } from "../../utils/markdown-extensions";
import { flattenHeadingNodes, parseHeadings } from "../../utils/outline";
import { applyPreviewBlockSpacing } from "../../utils/previewBlockSpacing";
import { applyPreviewHeadingAttributes } from "../../utils/previewHeadingAttributes";
import { parseFrontmatter } from "../../utils/frontmatter";
import { openExternalUrl } from "../../utils/externalLinks";
import { isWindowsPlatform } from "../../utils/platform";
import { decodeUserFacingPath } from "../../utils/pathHelpers";
import { useI18n } from "../../hooks/useI18n";
import type { ShikiHighlighter } from "../../hooks/useShikiHighlighter";
import {
  getFrontmatterDisplayItems,
  isExternalLink,
  isValidExternalUrl,
  type FrontmatterValue,
} from "./preview/previewPaneHelpers";
import { useLargeDocDebouncedValue } from "./preview/useLargeDocDebouncedValue";
import { usePreviewScrollSpy } from "./preview/usePreviewScrollSpy";
import { HtmlPreviewFrame } from "./preview/HtmlPreviewFrame";

interface PreviewPaneProps {
  highlighter?: ShikiHighlighter | null;
  onScroll?: (percentage: number) => void;
  density?: PaneDensity;
  syncedPercentage?: number | null;
  /** False when SplitView gives the preview column 0 width (e.g. editor-only). Synced to layout, not just store viewMode. */
  previewLayoutActive?: boolean;
  /** False when the preview pane should keep mounted state but avoid expensive render work. */
  previewRenderActive?: boolean;
}

export interface PreviewPaneHandle {
  cancelScrollSync: () => void;
  syncScrollTo: (percentage: number, options?: { immediate?: boolean }) => void;
  getScrollPosition: () => { top: number; left: number };
  restoreScrollPosition: (position: { top: number; left: number }) => void;
  scrollToTop: () => void;
}

export const PreviewPane = forwardRef<PreviewPaneHandle, PreviewPaneProps>(
  (
    {
      highlighter,
      onScroll,
      density = "comfortable" as PaneDensity,
      syncedPercentage = null,
      previewLayoutActive = true,
      previewRenderActive = true,
    },
    ref,
  ) => {
    const { t } = useI18n();
    const settings = useAppStore((state) => state.settings);
    const currentFilePath = useAppStore((state) => state.currentFilePath);
    const rootFolderPath = useAppStore((state) => state.rootFolderPath);
    const files = useAppStore((state) => state.files);
    const showNotification = useAppStore((state) => state.showNotification);
    const activeTabId = useAppStore((state) => state.activeTabId);
    const content = useAppStore(selectContent);
    const fileContents = useAppStore((state) => state.fileContents);
    // Large documents: debounce before deferring so each keystroke does not
    // re-run the full markdown render pipeline.
    const debouncedContent = useLargeDocDebouncedValue(content, activeTabId);
    const previewContent = useDeferredValue(debouncedContent);
    const previewFontFamily = useMemo(
      () => getResolvedPreviewFontFamily(settings),
      [settings.previewFontFamily],
    );
    const codeFontFamily = useMemo(
      () => getResolvedCodeFontFamily(settings),
      [settings.codeFontFamily],
    );
    const previewRef = useRef<HTMLDivElement>(null);
    const layoutRef = useRef<HTMLDivElement>(null);

    const { handleFileSelect, handleRevealInExplorer } = useFileOperations();
    const { readFile } = useFileSystem();

    const isCompact = density === "compact";
    const isWindows = useMemo(() => isWindowsPlatform(), []);
    const hasActiveFile = Boolean(activeTabId);
    const previewFileType = useMemo(
      () => getPreviewFileType(currentFilePath),
      [currentFilePath],
    );
    const isMarkdownPreview = previewFileType === "markdown";
    const isHtmlPreview = previewFileType === "html";
    const flattenedHeadings = useMemo(
      () =>
        isMarkdownPreview && previewRenderActive
          ? flattenHeadingNodes(parseHeadings(previewContent))
          : [],
      [isMarkdownPreview, previewContent, previewRenderActive],
    );

    // Pane layout state - use ref to avoid re-render
    const [layoutMetrics, setLayoutMetrics] = useState(() =>
      getPaneLayoutMetrics(0, density),
    );
    const metricsRef = useRef(layoutMetrics);

    const uiFontScale = getUiFontScale(settings.uiFontSize);
    const scaledPreviewFontSize = getScaledEditorFontSize(
      settings.fontSize,
      settings.uiFontSize,
    );
    const scaledCodeFontSize = getScaledCodeFontSize(
      settings.fontSize,
      settings.uiFontSize,
    );

    // Optimized resize handling
    const observeResize = useThrottledResize((width) => {
      const newMetrics = scalePaneLayoutMetrics(
        getPaneLayoutMetrics(width, density),
        uiFontScale,
      );
      metricsRef.current = newMetrics;
      setLayoutMetrics(newMetrics);
    }, 16);

    // Pane layout style - memoized with stable deps
    const layoutStyle = useMemo(
      () =>
        ({
          "--pane-backdrop-px": `${layoutMetrics.backdropPaddingX}px`,
          "--pane-backdrop-py": `${layoutMetrics.backdropPaddingY}px`,
          "--pane-frame-max-width": `${layoutMetrics.frameMaxWidth}px`,
          "--pane-sheet-max-width": settings.readableLineLength
            ? `${layoutMetrics.sheetMaxWidth}px`
            : "100%",
          "--pane-sheet-radius": `${layoutMetrics.sheetRadius}px`,
          "--pane-content-px": `${layoutMetrics.contentPaddingX}px`,
          "--pane-content-top": `${layoutMetrics.contentPaddingTop}px`,
          "--pane-content-bottom": `${layoutMetrics.contentPaddingBottom}px`,
          "--preview-content-bottom": `max(${layoutMetrics.contentPaddingBottom}px, 40vh)`,
          "--preview-font-family": previewFontFamily,
          "--preview-font-size": `${scaledPreviewFontSize}px`,
          "--preview-code-font-family": codeFontFamily,
          "--preview-code-font-size": `${scaledCodeFontSize}px`,
        }) as React.CSSProperties,
      [
        layoutMetrics,
        previewFontFamily,
        scaledPreviewFontSize,
        scaledCodeFontSize,
        codeFontFamily,
        settings.readableLineLength,
      ],
    );

    // Optimized pane resize tracking
    useLayoutEffect(() => {
      observeResize(layoutRef.current);
    }, [observeResize]);

    // Preview renderer hook
    const renderer = usePreviewRenderer({
      content: previewContent,
      currentFilePath,
      isMarkdownPreview,
      isHtmlPreview,
      highlighter,
      markdownStylePreset: settings.markdownStylePreset,
      orderedListMode: settings.orderedListMode,
      themeMode: settings.themeMode as "light" | "dark",
      files,
      rootFolderPath,
      fileContents,
      activeTabId,
      readFile,
      enabled: previewRenderActive,
    });

    /** Same string the markdown `<article>` uses via `dangerouslySetInnerHTML` (sync + async paths). */
    const markdownPreviewMarkup = useMemo(() => {
      if (!isMarkdownPreview) return "";
      return renderer.requiresAsyncEnhancement
        ? renderer.enhancedBodyHtml
        : renderer.parsedContent.bodyHTML;
    }, [
      isMarkdownPreview,
      renderer.enhancedBodyHtml,
      renderer.parsedContent.bodyHTML,
      renderer.requiresAsyncEnhancement,
    ]);
    // 保持同一份 HTML 对象，避免无关重渲染清掉图片地址、图表和标题定位标识。
    const markdownPreviewInnerHtml = useMemo(
      () => ({ __html: markdownPreviewMarkup }),
      [markdownPreviewMarkup],
    );

    // Scroll sync hook
    const scroll = usePreviewScroll({ onScroll });

    // WikiLink navigation hook
    const navigation = useWikiLinkNavigation({
      content: previewContent,
      currentFilePath,
      rootFolderPath,
      files,
      activeTabId,
      isMarkdownPreview,
      showNotification,
      handleFileSelect,
    });

    // Register/unregister preview pane
    const { registerPane, unregisterPane } = navigation;
    useEffect(() => {
      const container = previewRef.current;
      if (!container || !activeTabId) return;

      registerPane(container);
      return () => unregisterPane(container);
    }, [activeTabId, registerPane, unregisterPane]);

    // Expose imperative handle
    useImperativeHandle(
      ref,
      () => ({
        cancelScrollSync: scroll.cancelScrollSync,
        syncScrollTo: (
          percentage: number,
          options?: { immediate?: boolean },
        ) => {
          const element = previewRef.current;
          if (!element) return;
          scroll.syncScrollTo(element, percentage, options);
        },
        getScrollPosition: () => {
          const element = previewRef.current;
          return {
            top: element?.scrollTop ?? 0,
            left: element?.scrollLeft ?? 0,
          };
        },
        restoreScrollPosition: (position: { top: number; left: number }) => {
          const element = previewRef.current;
          if (!element) return;
          scroll.cancelScrollSync();
          element.scrollTo(position);
        },
        scrollToTop: () => {
          const element = previewRef.current;
          if (!element) return;
          element.scrollTo({ top: 0, behavior: "auto" });
        },
      }),
      [scroll],
    );

    useEffect(() => {
      const element = previewRef.current;
      if (!element || syncedPercentage === null) return;
      scroll.syncScrollTo(element, syncedPercentage);
    }, [scroll, syncedPercentage]);

    // Per-tab scroll restoration is handled by SplitView via syncedPercentage /
    // imperative syncScrollTo; avoid resetting preview scroll on every tab switch.
    useLayoutEffect(() => {
      const element = previewRef.current;
      if (!element || !previewRenderActive) return;
      scroll.flushPendingScrollSync(element);
    }, [
      scroll,
      renderer.enhancedBodyHtml,
      renderer.parsedContent.bodyHTML,
      activeTabId,
      previewRenderActive,
    ]);

    useEffect(() => {
      const element = previewRef.current;
      if (!element || !previewRenderActive) return;
      const ro = new ResizeObserver(() => {
        scroll.flushPendingScrollSync(element);
      });
      ro.observe(element);
      return () => ro.disconnect();
    }, [scroll, previewRenderActive]);

    // Handle scroll events
    const handleScroll = useCallback(
      (event: React.UIEvent<HTMLDivElement>) => {
        scroll.handleScroll(event.currentTarget);
      },
      [scroll],
    );

    // Keep the outline highlight following the reading position
    usePreviewScrollSpy(
      previewRef,
      isMarkdownPreview && previewRenderActive && hasActiveFile,
    );

    // Cancel sync on user scroll intent
    useEffect(() => {
      const element = previewRef.current;
      if (!element) return;

      const handleUserScroll = () => scroll.cancelScrollSync();

      element.addEventListener("wheel", handleUserScroll, { passive: true });
      element.addEventListener("touchstart", handleUserScroll, {
        passive: true,
      });
      element.addEventListener("pointerdown", handleUserScroll, {
        passive: true,
      });

      return () => {
        element.removeEventListener("wheel", handleUserScroll);
        element.removeEventListener("touchstart", handleUserScroll);
        element.removeEventListener("pointerdown", handleUserScroll);
      };
    }, [scroll]);

    // Stamp heading ids before paint so outline / wiki jumps can find targets
    // on the first click instead of racing requestIdleCallback.
    useLayoutEffect(() => {
      if (!isMarkdownPreview || !previewRenderActive) return;
      const container = previewRef.current;
      if (!container) return;

      applyPreviewBlockSpacing(container);
      applyPreviewHeadingAttributes(container, flattenedHeadings, activeTabId);
    }, [
      activeTabId,
      flattenedHeadings,
      isMarkdownPreview,
      markdownPreviewMarkup,
      previewRenderActive,
    ]);

    const mermaidRenderRunningRef = useRef(false);
    const mermaidRenderQueuedRef = useRef(false);

    const runMermaidInPreview = useCallback(() => {
      if (
        !isMarkdownPreview ||
        !previewRenderActive ||
        previewLayoutActive === false
      )
        return;
      const container = previewRef.current;
      if (!container) return;

      const mermaidCount = container.querySelectorAll(".mermaid").length;
      if (mermaidCount > 20) {
        console.warn(
          `[PreviewPane] Too many Mermaid diagrams (${mermaidCount}), skipping render`,
        );
        return;
      }

      if (mermaidRenderRunningRef.current) {
        mermaidRenderQueuedRef.current = true;
        return;
      }

      mermaidRenderRunningRef.current = true;

      const flush = async () => {
        try {
          // Hard cap re-render passes so a diagram that keeps re-queueing
          // itself (render → DOM mutation → observer → queue) can never spin
          // this loop forever and freeze the page.
          const MAX_RENDER_PASSES = 5;
          let passes = 0;
          do {
            mermaidRenderQueuedRef.current = false;
            await renderMermaidDiagrams(container, {
              themeMode: settings.themeMode as "light" | "dark",
            });
            passes += 1;
          } while (
            mermaidRenderQueuedRef.current &&
            passes < MAX_RENDER_PASSES
          );
        } finally {
          mermaidRenderRunningRef.current = false;
        }
      };

      void flush();
    }, [
      isMarkdownPreview,
      previewLayoutActive,
      previewRenderActive,
      settings.themeMode,
    ]);

    // 已完成的图表随预览 DOM 保留；重新显示时仅渲染尚未就绪的图表。
    // Second pass after paint: Shiki/highlighter hydration and first-paint batching can leave the
    // first layout effect without diagram nodes; rAF runs after the current frame settles.
    useEffect(() => {
      let cancelled = false;
      const frame = requestAnimationFrame(() => {
        if (!cancelled && previewRenderActive) runMermaidInPreview();
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    }, [
      markdownPreviewMarkup,
      previewLayoutActive,
      previewRenderActive,
      runMermaidInPreview,
    ]);

    // Width animates after view mode changes; first flex pass can still be 0px — keep polling layout.
    useEffect(() => {
      const el = layoutRef.current;
      if (
        !el ||
        !isMarkdownPreview ||
        !previewRenderActive ||
        previewLayoutActive === false
      )
        return;

      // Debounce during width transitions so we render Mermaid once after layout settles.
      const schedule = debounce(() => {
        runMermaidInPreview();
      }, 220);

      const ro = new ResizeObserver(() => {
        schedule();
      });
      ro.observe(el);
      schedule();
      return () => {
        ro.disconnect();
      };
    }, [
      isMarkdownPreview,
      previewLayoutActive,
      previewRenderActive,
      runMermaidInPreview,
    ]);

    // Some preview flows asynchronously rewrite the article subtree after Mermaid has rendered
    // (e.g. attachment/media enhancement). Watch for Mermaid placeholders reappearing and heal them.
    useEffect(() => {
      const container = previewRef.current;
      if (
        !container ||
        !isMarkdownPreview ||
        !previewRenderActive ||
        previewLayoutActive === false
      )
        return;

      const schedule = throttle(() => {
        const hasPendingMermaid = Array.from(
          container.querySelectorAll<HTMLElement>(".mermaid"),
        ).some((el) => {
          // "error" is a settled state: re-rendering a failed diagram mutates
          // the DOM again and would loop this observer forever. A source edit
          // replaces the article HTML (fresh nodes without dataset), so real
          // changes still re-render.
          if (el.dataset.mermaidRendered === "error") return false;
          return (
            !el.querySelector("svg") || el.dataset.mermaidRendered !== "true"
          );
        });

        if (hasPendingMermaid) {
          runMermaidInPreview();
        }
      }, 120);

      const observer = new MutationObserver((mutations) => {
        const touchedMermaid = mutations.some((mutation) => {
          if (
            mutation.target instanceof HTMLElement &&
            mutation.target.closest(".mermaid")
          ) {
            return true;
          }

          return Array.from(mutation.addedNodes).some(
            (node) =>
              node instanceof HTMLElement &&
              (node.matches(".mermaid") ||
                Boolean(node.querySelector(".mermaid"))),
          );
        });

        if (touchedMermaid) {
          schedule();
        }
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
      });

      return () => {
        observer.disconnect();
      };
    }, [
      isMarkdownPreview,
      previewLayoutActive,
      previewRenderActive,
      runMermaidInPreview,
    ]);

    // Lazily materialize preview images as they approach the viewport so
    // image-heavy notes do not read every attachment into memory up front.
    useEffect(() => {
      const container = previewRef.current;
      if (!container || !previewRenderActive || !isMarkdownPreview) return;

      return mountLazyPreviewImageWarming(container, {
        sourceFilePath: currentFilePath,
        root: container,
        rootMargin: "360px 0px",
        concurrency: 2,
      });
    }, [
      currentFilePath,
      isMarkdownPreview,
      previewRenderActive,
      renderer.enhancedBodyHtml,
      renderer.parsedContent.bodyHTML,
    ]);

    // 同一文档重渲染保留在途定位，仅切换文档或卸载时清理。
    const { cancelScrollSync } = scroll;
    const { clearScrollRetries } = navigation;
    useEffect(() => {
      return () => {
        mermaidRenderQueuedRef.current = false;
        mermaidRenderRunningRef.current = false;
        cancelScrollSync();
        clearScrollRetries();
      };
    }, [activeTabId, cancelScrollSync, clearScrollRetries]);

    // Asset preview (image/video/PDF)
    const [assetPreviewSrc, setAssetPreviewSrc] = useState("");

    useEffect(() => {
      let cancelled = false;

      if (
        !previewRenderActive ||
        isMarkdownPreview ||
        isHtmlPreview ||
        previewFileType === "unsupported"
      ) {
        setAssetPreviewSrc("");
        return;
      }

      void (async () => {
        if (!currentFilePath) return;
        try {
          const src =
            previewFileType === "image"
              ? await warmPreviewImage(currentFilePath, currentFilePath)
              : await resolvePreviewSource(currentFilePath, currentFilePath);
          if (!cancelled) setAssetPreviewSrc(src);
        } catch {
          if (!cancelled) setAssetPreviewSrc("");
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [
      currentFilePath,
      isHtmlPreview,
      isMarkdownPreview,
      previewFileType,
      previewRenderActive,
    ]);

    useEffect(() => {
      const container = previewRef.current;
      if (!container || !previewRenderActive || previewLayoutActive === false)
        return;

      const mountedPreviews = new Map<HTMLElement, () => void>();

      const mountDiscoveredPdfPreviews = () => {
        const pdfNodes = Array.from(
          container.querySelectorAll<HTMLElement>(
            ".preview-pdfjs[data-pdf-src]",
          ),
        );
        for (const node of pdfNodes) {
          if (mountedPreviews.has(node)) continue;

          const src = node.dataset.pdfSrc?.trim() ?? "";
          const title =
            node.dataset.pdfTitle?.trim() ||
            currentFilePath?.split(/[\\/]/).pop() ||
            t("preview_pdfTitle");
          const pdfPath = node.dataset.pdfPath?.trim() || undefined;
          if (!src) continue;

          mountedPreviews.set(node, mountPdfPreview(node, src, title, pdfPath));
        }
      };

      mountDiscoveredPdfPreviews();

      const observer =
        typeof MutationObserver !== "undefined"
          ? new MutationObserver(mountDiscoveredPdfPreviews)
          : null;
      observer?.observe(container, { childList: true, subtree: true });

      return () => {
        observer?.disconnect();
        mountedPreviews.forEach((cleanup) => cleanup());
        mountedPreviews.clear();
      };
    }, [
      assetPreviewSrc,
      currentFilePath,
      isMarkdownPreview,
      markdownPreviewMarkup,
      previewFileType,
      previewLayoutActive,
      previewRenderActive,
      t,
    ]);

    // Handle click events
    const handlePreviewClick = useCallback(
      async (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;

        // Ignore embed link clicks
        const embedLink = target?.closest(
          "a[data-wiki-embed], a.markdown-embed",
        ) as HTMLAnchorElement | null;
        if (embedLink) {
          event.preventDefault();
          return;
        }

        // Excalidraw embed click → open drawing for edit/preview
        const excalidrawEmbed = target?.closest(
          ".preview-attachment-excalidraw[data-attachment-path]",
        ) as HTMLElement | null;
        const excalidrawPath = excalidrawEmbed?.dataset.attachmentPath?.trim();
        if (excalidrawPath) {
          event.preventDefault();
          await handleFileSelect({
            id: excalidrawPath,
            name:
              excalidrawEmbed?.dataset.attachmentName?.trim() ||
              excalidrawPath.split(/[/\\]/).pop() ||
              excalidrawPath,
            type: "file",
            path: excalidrawPath,
            isTrash: false,
          });
          return;
        }

        // WikiLink click
        const wikilink = target?.closest(
          "a[data-wikilink]",
        ) as HTMLAnchorElement | null;
        if (wikilink) {
          event.preventDefault();
          const wikiTarget = wikilink.getAttribute("data-wikilink");
          if (!wikiTarget) return;
          await navigation.navigateToWikilink(wikiTarget);
          return;
        }

        // External link click
        const externalLink = target?.closest(
          "a[href]",
        ) as HTMLAnchorElement | null;
        const href = externalLink?.getAttribute("href")?.trim() ?? "";
        if (
          externalLink &&
          href &&
          !href.startsWith("#") &&
          isExternalLink(href) &&
          isValidExternalUrl(href)
        ) {
          event.preventDefault();
          try {
            // Use the shared helper so external links also open in browser dev mode,
            // where the Tauri shell plugin is unavailable (open in a new tab instead).
            await openExternalUrl(href);
          } catch (error) {
            console.error("Failed to open external link:", href, error);
            showNotification(
              t("notifications_failedOpenLinkInBrowser"),
              "error",
            );
          }
          return;
        }

        if (externalLink && isLocalPreviewLinkHref(href)) {
          const localTarget = getLocalPreviewLinkTarget(href);
          if (!localTarget) return;

          event.preventDefault();
          const attachmentContext = createAttachmentResolverContext(
            files,
            rootFolderPath,
            currentFilePath,
          );
          const resolvedAttachment = await resolveAttachmentTarget(
            attachmentContext,
            localTarget,
          );
          if (!resolvedAttachment) {
            showNotification(
              t("notifications_linkedFileNotFound", { target: localTarget }),
              "error",
            );
            return;
          }

          await handleFileSelect({
            id: resolvedAttachment.path,
            name: resolvedAttachment.name,
            type: "file",
            path: resolvedAttachment.path,
            isTrash: false,
          });
          return;
        }

        // Anchor link click
        const anchorLink = target?.closest(
          'a[href^="#"]',
        ) as HTMLAnchorElement | null;
        if (!anchorLink) return;

        const rawHash = anchorLink.getAttribute("href");
        if (!rawHash || rawHash === "#") return;

        const normalizedHash = decodeURIComponent(rawHash.slice(1)).trim();
        if (!normalizedHash) return;

        event.preventDefault();
        navigation.navigateToHashLink(normalizedHash);
      },
      [
        currentFilePath,
        files,
        handleFileSelect,
        navigation,
        rootFolderPath,
        showNotification,
        t,
      ],
    );

    // Handle double click events
    const handlePreviewDoubleClick = useCallback(
      async (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;

        // Embed link double click
        const embedLink = target?.closest(
          "a[data-wiki-embed], a.markdown-embed",
        ) as HTMLAnchorElement | null;
        const embedTarget =
          embedLink?.dataset.wikiTarget?.trim() ||
          embedLink?.dataset.wikilink?.trim();
        if (embedTarget) {
          event.preventDefault();
          const attachmentContext = createAttachmentResolverContext(
            files,
            rootFolderPath,
            currentFilePath,
          );
          const resolvedAttachment = await resolveAttachmentTarget(
            attachmentContext,
            embedTarget,
          );
          if (!resolvedAttachment) {
            showNotification(
              t("notifications_linkedFileNotFound", {
                target: decodeUserFacingPath(embedTarget),
              }),
              "error",
            );
            return;
          }
          if (!isImageAttachment(resolvedAttachment.name)) {
            await handleRevealInExplorer(resolvedAttachment.path);
          }
          return;
        }

        // WikiLink double click
        const wikilink = target?.closest(
          "a[data-wikilink]",
        ) as HTMLAnchorElement | null;
        const wikiTarget = wikilink?.getAttribute("data-wikilink");
        if (wikiTarget) {
          event.preventDefault();
          await navigation.navigateToWikilink(wikiTarget);
          return;
        }

        // Anchor link double click
        const anchorLink = target?.closest(
          'a[href^="#"]',
        ) as HTMLAnchorElement | null;
        const rawHash = anchorLink?.getAttribute("href");
        if (rawHash && rawHash !== "#") {
          event.preventDefault();
          navigation.navigateToHashLink(
            decodeURIComponent(rawHash.slice(1)).trim(),
          );
          return;
        }

        // Attachment double click
        const attachment = target?.closest(
          "[data-attachment-path]",
        ) as HTMLElement | null;
        const attachmentPath = attachment?.dataset.attachmentPath;
        if (!attachmentPath) return;

        event.preventDefault();
        await handleRevealInExplorer(attachmentPath);
      },
      [
        currentFilePath,
        files,
        handleRevealInExplorer,
        navigation,
        rootFolderPath,
        showNotification,
        t,
      ],
    );

    // Parse frontmatter for display
    const parsedFrontmatter = useMemo(() => {
      if (!isMarkdownPreview || !previewRenderActive || !previewContent)
        return null;
      const { frontmatter } = parseFrontmatter(previewContent);
      return frontmatter;
    }, [isMarkdownPreview, previewContent, previewRenderActive]);
    const frontmatterEntries = useMemo(
      () =>
        parsedFrontmatter
          ? (Object.entries(parsedFrontmatter) as Array<
              [string, FrontmatterValue]
            >)
          : [],
      [parsedFrontmatter],
    );

    return (
      <div
        ref={(node) => {
          previewRef.current = node;
          layoutRef.current = node;
        }}
        onScroll={handleScroll}
        onClick={handlePreviewClick}
        onDoubleClick={handlePreviewDoubleClick}
        className={`editor-pane-layout preview-scroll-container h-full min-w-0 ${
          previewFileType === "html" ? "overflow-hidden" : "overflow-y-auto"
        } ${hasActiveFile ? "" : "preview-pane-empty-state"}`}
        style={{ pointerEvents: "auto", ...layoutStyle }}
      >
        <div
          className={`editor-pane-backdrop min-h-full ${
            previewFileType === "html" ? "preview-pane-backdrop-html" : ""
          } ${hasActiveFile && previewFileType !== "html" ? "" : "h-full"}`}
        >
          <div
            className={`editor-pane-frame w-full ${
              previewFileType === "html" ? "preview-pane-frame-html" : ""
            } ${hasActiveFile && previewFileType !== "html" ? "" : "h-full"}`}
          >
            {isMarkdownPreview &&
              parsedFrontmatter &&
              settings.showReadingProperties !== false && (
                <div className="preview-pane-properties-layout editor-pane-width-constrained mx-auto mb-4">
                  <details
                    key={activeTabId}
                    open
                    className="preview-pane-properties w-full rounded-xl overflow-hidden bg-gray-50/50 dark:bg-white/5 animate-fade-in group/metadata"
                  >
                    <summary className="preview-pane-properties-header px-4 py-2 bg-gray-100/50 dark:bg-white/5 font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                      <ChevronRight
                        className="preview-pane-properties-chevron shrink-0"
                        size={13}
                        aria-hidden
                      />
                      <span>{t("preview_properties")}</span>
                    </summary>
                    <div className="preview-pane-properties-fields p-1.5 table w-full">
                      {frontmatterEntries.map(([key, value]) => (
                        <div
                          key={key}
                          className="table-row hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        >
                          <div className="preview-pane-properties-cell table-cell py-1.5 px-2 w-32 whitespace-nowrap text-gray-500 dark:text-gray-400 font-medium align-top">
                            {key}
                          </div>
                          <div className="preview-pane-properties-cell table-cell py-1.5 px-2 text-gray-800 dark:text-gray-200 align-top">
                            {key === "link" &&
                            typeof value === "string" &&
                            isExternalLink(value) &&
                            isValidExternalUrl(value) ? (
                              <a
                                href={value}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full break-all py-0.5 text-accent-DEFAULT underline underline-offset-2 hover:opacity-80"
                              >
                                {value}
                              </a>
                            ) : Array.isArray(value) ? (
                              <div className="preview-pane-properties-multi-value">
                                {getFrontmatterDisplayItems(value).map(
                                  (item, index) => (
                                    <span
                                      key={`${key}-${index}-${item}`}
                                      className={`preview-pane-properties-multi-value-item ${item ? "" : "is-empty"}`}
                                    >
                                      {item || "\u2014"}
                                    </span>
                                  ),
                                )}
                              </div>
                            ) : (
                              <div className="preview-pane-properties-static whitespace-pre-wrap break-words py-0.5">
                                {getFrontmatterDisplayItems(value)[0] ||
                                  "\u2014"}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

            <div
              className={`editor-pane-sheet preview-pane-sheet w-full ${
                previewFileType === "html" ? "preview-pane-sheet-html" : ""
              } ${
                hasActiveFile && previewFileType !== "html"
                  ? ""
                  : "h-full min-h-0"
              }`}
            >
              {previewFileType === "image" && assetPreviewSrc ? (
                <div className="editor-pane-width-constrained mx-auto flex min-h-[320px] w-full items-center justify-center py-6">
                  <img
                    src={assetPreviewSrc}
                    alt={
                      currentFilePath?.split(/[\\/]/).pop() ||
                      t("preview_imageAlt")
                    }
                    className="preview-attachment-image max-h-[75vh] w-auto"
                  />
                </div>
              ) : previewFileType === "video" && assetPreviewSrc ? (
                <div className="editor-pane-width-constrained mx-auto w-full py-6">
                  <video
                    src={assetPreviewSrc}
                    controls
                    playsInline
                    preload="metadata"
                    className="preview-pane-video-player w-full"
                  />
                </div>
              ) : previewFileType === "pdf" && assetPreviewSrc ? (
                <div className="editor-pane-width-constrained mx-auto w-full h-full flex flex-col py-3">
                  <div
                    className="preview-attachment-pdf preview-pdfjs flex-1 min-h-0 w-full rounded-2xl bg-white dark:bg-black/30"
                    data-pdf-src={assetPreviewSrc}
                    data-pdf-title={
                      currentFilePath?.split(/[\\/]/).pop() ||
                      t("preview_pdfTitle")
                    }
                    data-pdf-path={currentFilePath ?? undefined}
                  >
                    {t("preview_loading")}
                  </div>
                </div>
              ) : previewFileType === "image" ||
                previewFileType === "video" ||
                previewFileType === "pdf" ? (
                <div className="editor-pane-width-constrained mx-auto flex min-h-[320px] w-full items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
                  {t("preview_loading")}
                </div>
              ) : previewFileType === "html" ? (
                <HtmlPreviewFrame
                  srcDoc={renderer.sanitizedHtmlPreview}
                  title={
                    currentFilePath?.split(/[\\/]/).pop() ||
                    t("preview_htmlTitle")
                  }
                  themeMode={settings.themeMode as "light" | "dark"}
                />
              ) : previewFileType === "unsupported" ? (
                <div className="editor-pane-width-constrained mx-auto flex min-h-[320px] w-full items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
                  {t("preview_unsupported")}
                </div>
              ) : (
                <article
                  key={currentFilePath ?? activeTabId}
                  className={`markdown-body preview-pane-document ${isWindows ? "preview-pane-document-windows" : ""} ${isCompact ? "preview-pane-document-compact" : ""} ${hasActiveFile ? "" : "h-full"}`}
                  dangerouslySetInnerHTML={markdownPreviewInnerHtml}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

PreviewPane.displayName = "PreviewPane";
