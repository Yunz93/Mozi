/**
 * Preview Renderer Hook
 *
 * 处理预览面板的渲染逻辑：
 * - Markdown 渲染
 * - HTML 增强（图片、嵌入）
 * - 资源解析
 */

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useMarkdownRenderer,
  clearMarkdownCache,
} from "../../../utils/markdown";
import { createAttachmentResolverContext } from "../../../utils/attachmentResolver";
import type { FileNode } from "../../../types";
import type { MarkdownStylePreset, OrderedListMode } from "../../../types";
import type { ShikiHighlighter } from "../../../hooks/useShikiHighlighter";
import {
  getBasePreviewHtml,
  renderMarkdownPreview,
  sanitizeHtmlPreview,
  shouldUseAsyncPreviewEnhancement,
} from "../preview/previewRenderCore";
import { enhancePreviewHtml } from "../preview/enhancePreviewHtml";

export interface UsePreviewRendererOptions {
  content: string;
  currentFilePath?: string | null;
  isMarkdownPreview: boolean;
  isHtmlPreview: boolean;
  highlighter?: ShikiHighlighter | null;
  themeMode?: "light" | "dark";
  markdownStylePreset?: MarkdownStylePreset;
  orderedListMode?: OrderedListMode;
  files: FileNode[];
  rootFolderPath?: string | null;
  fileContents: Record<string, string>;
  activeTabId?: string | null;
  readFile: (file: FileNode) => Promise<string>;
  enabled?: boolean;
}

export interface UsePreviewRendererReturn {
  // 渲染结果
  parsedContent: {
    frontmatter: Record<string, unknown> | null;
    bodyHTML: string;
  };
  enhancedBodyHtml: string;
  sanitizedHtmlPreview: string;
  requiresAsyncEnhancement: boolean;
}

export function usePreviewRenderer(
  options: UsePreviewRendererOptions,
): UsePreviewRendererReturn {
  const {
    content,
    currentFilePath,
    isMarkdownPreview,
    isHtmlPreview,
    highlighter,
    themeMode = "light",
    markdownStylePreset = "nord",
    orderedListMode = "strict",
    files,
    rootFolderPath,
    fileContents,
    activeTabId,
    readFile,
    enabled = true,
  } = options;

  // Initialize markdown renderer
  useMarkdownRenderer(highlighter ?? null, themeMode);

  // Clear stale cache entries when the highlighter becomes available,
  // ensuring previously-cached unhighlighted renders don't persist.
  const hadHighlighterRef = useRef(Boolean(highlighter));
  useEffect(() => {
    const hasHighlighter = Boolean(highlighter);
    if (hasHighlighter && !hadHighlighterRef.current) {
      clearMarkdownCache();
    }
    hadHighlighterRef.current = hasHighlighter;
  }, [highlighter]);

  const parsedCacheRef = useRef<{
    content: string;
    path: typeof currentFilePath;
    tab: typeof activeTabId;
    highlighter: typeof highlighter;
    themeMode: typeof themeMode;
    markdownStylePreset: typeof markdownStylePreset;
    orderedListMode: typeof orderedListMode;
    isMarkdownPreview: boolean;
    value: ReturnType<typeof renderMarkdownPreview>;
  } | null>(null);

  const parsedContent = useMemo(() => {
    const cached = parsedCacheRef.current;
    const sameDocument =
      cached !== null &&
      cached.path === currentFilePath &&
      cached.tab === activeTabId;
    if (!enabled) {
      // 只保留当前文档的最后一次预览；隐藏期间不解析输入，也不清空已就绪 DOM。
      return sameDocument ? cached.value : { frontmatter: null, bodyHTML: "" };
    }
    if (
      sameDocument &&
      cached &&
      cached.content === content &&
      cached.highlighter === highlighter &&
      cached.themeMode === themeMode &&
      cached.markdownStylePreset === markdownStylePreset &&
      cached.orderedListMode === orderedListMode &&
      cached.isMarkdownPreview === isMarkdownPreview
    )
      return cached.value;
    const value = renderMarkdownPreview({
      content,
      currentFilePath,
      highlighter,
      isMarkdownPreview,
      themeMode,
      markdownStylePreset,
      orderedListMode,
    });
    parsedCacheRef.current = {
      content,
      path: currentFilePath,
      tab: activeTabId,
      highlighter,
      themeMode,
      markdownStylePreset,
      orderedListMode,
      isMarkdownPreview,
      value,
    };
    return value;
  }, [
    content,
    currentFilePath,
    activeTabId,
    enabled,
    highlighter,
    isMarkdownPreview,
    markdownStylePreset,
    orderedListMode,
    themeMode,
  ]);

  // Sanitize HTML for HTML preview
  const sanitizedHtmlPreview = useMemo(() => {
    if (!enabled) return "";
    return sanitizeHtmlPreview(content, isHtmlPreview);
  }, [content, enabled, isHtmlPreview]);

  const basePreviewHtml = useMemo(
    () =>
      getBasePreviewHtml(
        isMarkdownPreview,
        parsedContent.bodyHTML,
        sanitizedHtmlPreview,
      ),
    [isMarkdownPreview, parsedContent.bodyHTML, sanitizedHtmlPreview],
  );

  const requiresAsyncEnhancement = useMemo(
    () => shouldUseAsyncPreviewEnhancement(basePreviewHtml, isMarkdownPreview),
    [basePreviewHtml, isMarkdownPreview],
  );

  const [enhancedBodyHtml, setEnhancedBodyHtml] = useState(
    () => basePreviewHtml,
  );
  const basePreviewHtmlRef = useRef(basePreviewHtml);
  const enhancedBodyHtmlRef = useRef(enhancedBodyHtml);
  useEffect(() => {
    enhancedBodyHtmlRef.current = enhancedBodyHtml;
  }, [enhancedBodyHtml]);

  // When the article uses async-enhanced HTML, sync `enhancedBodyHtml` → `basePreviewHtml` in a
  // layout effect so the DOM matches before PreviewPane's Mermaid `useLayoutEffect`. When async
  // enhancement is off, the article uses `parsedContent.bodyHTML` only — do not push `basePreviewHtml`
  // into `enhancedBodyHtml` every keystroke (that caused regressions / extra churn).
  useLayoutEffect(() => {
    if (!isMarkdownPreview && !isHtmlPreview) {
      basePreviewHtmlRef.current = "";
      setEnhancedBodyHtml("");
      enhancedBodyHtmlRef.current = "";
      return;
    }

    if (!enabled) {
      return;
    }

    if (!basePreviewHtml || typeof document === "undefined") {
      basePreviewHtmlRef.current = basePreviewHtml;
      setEnhancedBodyHtml(basePreviewHtml);
      return;
    }

    if (
      requiresAsyncEnhancement &&
      basePreviewHtml !== basePreviewHtmlRef.current
    ) {
      basePreviewHtmlRef.current = basePreviewHtml;
      setEnhancedBodyHtml(basePreviewHtml);
    } else {
      basePreviewHtmlRef.current = basePreviewHtml;
    }
  }, [
    basePreviewHtml,
    enabled,
    isHtmlPreview,
    isMarkdownPreview,
    requiresAsyncEnhancement,
  ]);

  // Attachment resolver context
  const attachmentResolverContext = useMemo(
    () =>
      createAttachmentResolverContext(files, rootFolderPath, currentFilePath),
    [files, rootFolderPath, currentFilePath],
  );

  // Enhance HTML with embeds and images
  useEffect(() => {
    if (!isMarkdownPreview && !isHtmlPreview) {
      setEnhancedBodyHtml("");
      enhancedBodyHtmlRef.current = "";
      return;
    }

    if (!enabled) {
      return;
    }

    if (!basePreviewHtml || typeof document === "undefined") {
      basePreviewHtmlRef.current = basePreviewHtml;
      setEnhancedBodyHtml(basePreviewHtml);
      return;
    }

    if (!requiresAsyncEnhancement) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextHtml = await enhancePreviewHtml({
          basePreviewHtml,
          isMarkdownPreview,
          attachmentResolverContext,
          currentFilePath,
          highlighter,
          themeMode,
          markdownStylePreset,
          orderedListMode,
          activeTabId,
          fileContents,
          content,
          readFile,
        });
        if (!cancelled && nextHtml !== enhancedBodyHtmlRef.current) {
          setEnhancedBodyHtml(nextHtml);
        }
      } catch (error) {
        console.error("Preview renderer error:", error);
        if (!cancelled) {
          setEnhancedBodyHtml(basePreviewHtml);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTabId,
    attachmentResolverContext,
    content,
    currentFilePath,
    enabled,
    fileContents,
    highlighter,
    isHtmlPreview,
    isMarkdownPreview,
    basePreviewHtml,
    requiresAsyncEnhancement,
    readFile,
    themeMode,
    markdownStylePreset,
    orderedListMode,
  ]);

  return {
    parsedContent,
    enhancedBodyHtml,
    sanitizedHtmlPreview,
    requiresAsyncEnhancement,
  };
}
