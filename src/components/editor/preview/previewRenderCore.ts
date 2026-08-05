import DOMPurify from "dompurify";
import { parseFrontmatter } from "../../../utils/frontmatter";
import { renderMarkdown } from "../../../utils/markdown";
import { hydrateCachedPreviewImageSources } from "../../../utils/previewImageCache";
import type { ShikiHighlighter } from "../../../hooks/useShikiHighlighter";
import type { MarkdownStylePreset, OrderedListMode } from "../../../types";
import {
  hasEmbeddableMediaLinksInHtml,
  hasWikiEmbedsInHtml,
} from "./previewMedia";

interface RenderMarkdownPreviewOptions {
  content: string;
  currentFilePath?: string | null;
  highlighter?: ShikiHighlighter | null;
  isMarkdownPreview: boolean;
  themeMode: "light" | "dark";
  markdownStylePreset?: MarkdownStylePreset;
  orderedListMode?: OrderedListMode;
}

export function renderMarkdownPreview(options: RenderMarkdownPreviewOptions) {
  const {
    content,
    currentFilePath,
    highlighter,
    isMarkdownPreview,
    markdownStylePreset,
    themeMode,
    orderedListMode,
  } = options;

  if (!isMarkdownPreview) {
    return { frontmatter: null, bodyHTML: "" };
  }

  if (!content) {
    return { frontmatter: null, bodyHTML: "" };
  }

  const { frontmatter, body } = parseFrontmatter(content);
  try {
    const bodyHTML = hydrateCachedPreviewImageSources(
      renderMarkdown(body, {
        highlighter,
        markdownStylePreset,
        themeMode,
        orderedListMode,
      }),
      currentFilePath || undefined,
    );
    return { frontmatter, bodyHTML };
  } catch (error) {
    console.error("Markdown rendering error:", error);
    return { frontmatter, bodyHTML: "<p>Error rendering markdown</p>" };
  }
}

/**
 * Sanitize HTML for preview. Uses WHOLE_DOCUMENT so `<head>` / `<style>` from
 * full HTML files survive for iframe `srcdoc` rendering (injecting into a div
 * drops document chrome and leaves unstyled plain text).
 */
export function sanitizeHtmlPreview(
  content: string,
  isHtmlPreview: boolean,
): string {
  if (!isHtmlPreview || !content) {
    return "";
  }

  return DOMPurify.sanitize(content, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["iframe", "style", "link", "meta"],
    ADD_ATTR: [
      "allow",
      "allowfullscreen",
      "charset",
      "class",
      "content",
      "frameborder",
      "href",
      "http-equiv",
      "id",
      "media",
      "name",
      "rel",
      "scrolling",
      "src",
      "style",
      "target",
      "title",
      "type",
    ],
  });
}

export function getBasePreviewHtml(
  isMarkdownPreview: boolean,
  markdownBodyHtml: string,
  sanitizedHtmlPreview: string,
): string {
  return isMarkdownPreview ? markdownBodyHtml : sanitizedHtmlPreview;
}

export function shouldUseAsyncPreviewEnhancement(
  basePreviewHtml: string,
  isMarkdownPreview: boolean,
): boolean {
  // HTML tab preview is rendered via iframe `srcdoc` with a whole document.
  // Running the markdown embed pipeline would re-parse it into a `<div>` and
  // strip `<head>` / `<style>` — exactly the unstyled-text bug we avoid.
  if (!isMarkdownPreview || !basePreviewHtml) {
    return false;
  }

  const hasWikiEmbeds = hasWikiEmbedsInHtml(basePreviewHtml);

  return (
    basePreviewHtml.includes("<img") ||
    basePreviewHtml.includes("<video") ||
    basePreviewHtml.includes("<source") ||
    basePreviewHtml.includes("<iframe") ||
    hasWikiEmbeds ||
    hasEmbeddableMediaLinksInHtml(basePreviewHtml)
  );
}
