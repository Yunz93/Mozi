/**
 * Async preview HTML enhancement pipeline.
 *
 * Extracted from usePreviewRenderer so the DOM transformation (resolving
 * images/videos/PDF/embeds, normalizing iframes, rendering wiki note embeds)
 * lives in one pure async function that can be reasoned about and tested in
 * isolation from React effect lifecycle concerns.
 */

import { renderMarkdown } from "../../../utils/markdown";
import {
  getCachedPreviewImageSrc,
  hydrateCachedPreviewImageSources,
  isUsablePreviewDisplaySrc,
  previewSourceNeedsMaterialization,
  resolvePreviewSource,
  warmPreviewImage,
} from "../../../utils/previewImageCache";
import {
  parseWikiLinkReference,
  extractWikiNoteFragment,
} from "../../../utils/wikiLinks";
import {
  resolveAttachmentTarget,
  type AttachmentResolverContext,
} from "../../../utils/attachmentResolver";
import type { MarkdownStylePreset, OrderedListMode } from "../../../types";
import type { ShikiHighlighter } from "../../../hooks/useShikiHighlighter";
import {
  buildIframeEmbed,
  configurePreviewImageElement,
  createPreviewHtmlContainer,
  createPreviewPdfContainer,
  hasUriScheme,
  isExcalidrawAttachment,
  isHtmlDocument,
  isImageAttachment,
  isMarkdownNote,
  isPdfAttachment,
  isVideoAttachment,
  normalizeExistingIframe,
  resolveExternalVideoEmbed,
} from "./previewMedia";
import {
  createExcalidrawEmbedContainer,
  renderExcalidrawEmbedSvg,
} from "../../../utils/excalidrawEmbed";
import { isObsidianExcalidrawMarkdown } from "../../../utils/excalidrawDocument";
import { sanitizeHtmlPreview } from "./previewRenderCore";
import {
  protectShikiPresInHtmlString,
  restoreShikiPresFromSnapshots,
} from "./shikiHtmlSnapshots";

/**
 * Replace a wiki-embed node, unwrapping a sole parent `<p>` when the
 * replacement is a block element (avoids invalid `<p><div>…</div></p>`).
 */
async function mountExcalidrawWikiEmbed(
  document: Document,
  embed: Element,
  drawingContent: string,
  options: {
    title: string;
    path: string;
    width?: number;
    height?: number;
  },
): Promise<void> {
  const drawingContainer = createExcalidrawEmbedContainer(document, options);
  replaceWikiEmbedNode(embed, drawingContainer);
  await renderExcalidrawEmbedSvg(drawingContainer, drawingContent, {
    title: options.title,
  });
}

function replaceWikiEmbedNode(embed: Element, replacement: Node): void {
  const parent = embed.parentElement;
  if (
    parent &&
    parent.tagName === "P" &&
    parent.childNodes.length === 1 &&
    parent.firstChild === embed
  ) {
    parent.replaceWith(replacement);
    return;
  }
  embed.replaceWith(replacement);
}

/**
 * Attach a displayable image `src` during async enhance.
 *
 * Local vault files must be materialized to object URLs here (not left as
 * empty-src "pending" placeholders). Deferring to IntersectionObserver made
 * pasted/wiki images flash once then stick on gray filename placeholders when
 * preview re-enhance cancelled the lazy warmer mid-flight.
 */
async function configureResolvedPreviewImage(
  image: HTMLImageElement,
  previewTarget: string,
  sourceFilePath?: string | null,
): Promise<void> {
  const cachedSrc = getCachedPreviewImageSrc(
    previewTarget,
    sourceFilePath || undefined,
  );
  if (cachedSrc && isUsablePreviewDisplaySrc(cachedSrc)) {
    configurePreviewImageElement(image, cachedSrc, previewTarget);
    return;
  }

  try {
    const displaySrc = previewSourceNeedsMaterialization(previewTarget)
      ? await warmPreviewImage(previewTarget, sourceFilePath || undefined)
      : await resolvePreviewSource(previewTarget, sourceFilePath || undefined);
    if (!isUsablePreviewDisplaySrc(displaySrc)) {
      configurePreviewImageElement(image, "", previewTarget, {
        warmed: false,
      });
      return;
    }
    configurePreviewImageElement(image, displaySrc, previewTarget);
  } catch {
    configurePreviewImageElement(image, "", previewTarget, {
      warmed: false,
    });
  }
}

export interface EnhancePreviewHtmlOptions {
  basePreviewHtml: string;
  isMarkdownPreview: boolean;
  attachmentResolverContext: AttachmentResolverContext;
  currentFilePath?: string | null;
  highlighter?: ShikiHighlighter | null;
  themeMode: "light" | "dark";
  markdownStylePreset: MarkdownStylePreset;
  orderedListMode: OrderedListMode;
  activeTabId?: string | null;
  fileContents: Record<string, string>;
  content: string;
  readFile: (file: {
    id: string;
    name: string;
    type: "file";
    path: string;
  }) => Promise<string>;
}

/**
 * Resolve embeds/media inside `basePreviewHtml` and return the enhanced HTML
 * string. Pure with respect to React: the caller owns state updates and
 * cancellation.
 */
export async function enhancePreviewHtml(
  options: EnhancePreviewHtmlOptions,
): Promise<string> {
  const {
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
  } = options;

  // WKWebView can strip Shiki token inline styles when reading subtree HTML back via
  // `innerHTML` after mutations (same symptom DomParser round-trips had). Substitute
  // `<pre class="shiki">` fragments from the source strings and restore after readback.
  // 参见 src/utils/webkitCompat.ts — Quirk 1
  const host = document.createElement("div");
  const shikiSnapshots: string[] = [];
  host.innerHTML = protectShikiPresInHtmlString(
    basePreviewHtml,
    shikiSnapshots,
  );
  const embeds = isMarkdownPreview
    ? Array.from(
        host.querySelectorAll<HTMLElement>(
          "[data-wiki-embed], a.markdown-embed",
        ),
      )
    : [];
  const markdownImages = Array.from(
    host.querySelectorAll<HTMLImageElement>("img"),
  );
  const markdownVideos = Array.from(
    host.querySelectorAll<HTMLVideoElement>("video"),
  );
  const markdownSources = Array.from(
    host.querySelectorAll<HTMLSourceElement>("source[src]"),
  );
  const iframes = Array.from(
    host.querySelectorAll<HTMLIFrameElement>("iframe"),
  );
  const anchorParagraphs = Array.from(
    host.querySelectorAll<HTMLParagraphElement>("p"),
  );

  // Process images
  await Promise.all(
    markdownImages.map(async (image) => {
      try {
        const originalSrc =
          image.getAttribute("data-original-src")?.trim() ||
          image.getAttribute("src")?.trim();
        if (!originalSrc) return;

        const resolvedAttachment = !hasUriScheme(originalSrc)
          ? await resolveAttachmentTarget(
              attachmentResolverContext,
              originalSrc,
            )
          : null;
        const previewTarget = resolvedAttachment?.path ?? originalSrc;
        const resolvedName =
          resolvedAttachment?.name ??
          previewTarget.split(/[\\/]/).pop() ??
          previewTarget;

        if (isVideoAttachment(resolvedName)) {
          const video = document.createElement("video");
          video.className = "preview-attachment-video";
          video.controls = true;
          video.playsInline = true;
          video.preload = "metadata";
          video.src = await resolvePreviewSource(
            previewTarget,
            currentFilePath || undefined,
          );
          image.replaceWith(video);
          return;
        }

        try {
          await configureResolvedPreviewImage(
            image,
            previewTarget,
            currentFilePath,
          );
        } catch {
          configurePreviewImageElement(image, "", previewTarget, {
            warmed: false,
          });
        }
      } catch (error) {
        console.warn("Failed to process image:", error);
      }
    }),
  );

  await Promise.all(
    markdownVideos.map(async (video) => {
      try {
        video.classList.add("preview-attachment-video");
        video.controls = true;
        video.playsInline = true;
        if (!video.getAttribute("preload")) {
          video.preload = "metadata";
        }

        const originalSrc = video.getAttribute("src")?.trim();
        if (!originalSrc || hasUriScheme(originalSrc)) {
          return;
        }

        const resolvedTarget = await resolveAttachmentTarget(
          attachmentResolverContext,
          originalSrc,
        );
        const previewTarget = resolvedTarget?.path ?? originalSrc;
        video.src = await resolvePreviewSource(
          previewTarget,
          currentFilePath || undefined,
        );
      } catch (error) {
        console.warn("Failed to process video:", error);
      }
    }),
  );

  await Promise.all(
    markdownSources.map(async (source) => {
      try {
        const originalSrc = source.getAttribute("src")?.trim();
        if (!originalSrc || hasUriScheme(originalSrc)) {
          return;
        }

        const resolvedTarget = await resolveAttachmentTarget(
          attachmentResolverContext,
          originalSrc,
        );
        const previewTarget = resolvedTarget?.path ?? originalSrc;
        source.src = await resolvePreviewSource(
          previewTarget,
          currentFilePath || undefined,
        );
      } catch (error) {
        console.warn("Failed to process video source:", error);
      }
    }),
  );

  iframes.forEach((frame) => {
    const src = frame.getAttribute("src")?.trim();
    if (!src) return;
    if (!resolveExternalVideoEmbed(src)) return;
    normalizeExistingIframe(frame);
  });

  anchorParagraphs.forEach((paragraph) => {
    const meaningfulChildren = Array.from(paragraph.childNodes).filter(
      (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
    );
    if (meaningfulChildren.length !== 1) return;

    const anchor = meaningfulChildren[0];
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const href = anchor.getAttribute("href")?.trim();
    if (!href) return;

    const externalVideo = resolveExternalVideoEmbed(href);
    if (!externalVideo) return;

    paragraph.replaceWith(buildIframeEmbed(document, externalVideo));
  });

  // Process embeds (no-op when there are none)
  await Promise.all(
    embeds.map(async (embed) => {
      try {
        const target =
          embed.dataset.wikiTarget?.trim() || embed.dataset.wikilink?.trim();
        const label =
          embed.dataset.wikiLabel?.trim() || embed.textContent?.trim() || "";
        if (!target) return;

        const parsedTarget = parseWikiLinkReference(target, {
          embed: true,
        });
        const embedWidth =
          Number(
            embed.dataset.wikiWidth || parsedTarget.embedSize?.width || 0,
          ) || undefined;
        const embedHeight =
          Number(
            embed.dataset.wikiHeight || parsedTarget.embedSize?.height || 0,
          ) || undefined;

        let resolvedTarget;
        try {
          resolvedTarget = parsedTarget.path
            ? await resolveAttachmentTarget(
                attachmentResolverContext,
                parsedTarget.path,
              )
            : currentFilePath
              ? {
                  path: currentFilePath,
                  name: currentFilePath.split(/[\\/]/).pop() || "Current note",
                }
              : null;
        } catch {
          resolvedTarget = null;
        }

        if (!resolvedTarget) {
          embed.className =
            "preview-attachment-file preview-attachment-file-missing";
          embed.textContent = `Missing attachment: ${label || target}`;
          if (embedWidth) embed.style.maxWidth = `${embedWidth}px`;
          if (embedHeight) {
            embed.style.maxHeight = `${embedHeight}px`;
            embed.style.overflow = "auto";
          }
          return;
        }

        // Excalidraw drawing embed (static SVG preview). Check before
        // markdown: `.excalidraw.md` also matches a `.md` suffix.
        if (isExcalidrawAttachment(resolvedTarget.name)) {
          try {
            const drawingContent = await readFile({
              id: resolvedTarget.path,
              name: resolvedTarget.name,
              type: "file",
              path: resolvedTarget.path,
            });
            await mountExcalidrawWikiEmbed(document, embed, drawingContent, {
              title: label || resolvedTarget.name,
              path: resolvedTarget.path,
              width: embedWidth,
              height: embedHeight,
            });
          } catch {
            embed.className =
              "preview-attachment-file preview-attachment-file-missing";
            embed.textContent = `Failed to preview attachment: ${label || resolvedTarget.name}`;
          }
          return;
        }

        // Markdown note embed
        if (isMarkdownNote(resolvedTarget.name)) {
          if (
            resolvedTarget.path === currentFilePath &&
            !parsedTarget.subpath.trim()
          ) {
            embed.className =
              "preview-attachment-file preview-attachment-file-missing";
            embed.textContent =
              "Cannot embed the entire current note into itself";
            return;
          }

          let sourceContent;
          try {
            sourceContent =
              resolvedTarget.path === currentFilePath && activeTabId
                ? (fileContents[activeTabId] ?? content)
                : await readFile({
                    id: resolvedTarget.path,
                    name: resolvedTarget.name,
                    type: "file",
                    path: resolvedTarget.path,
                  });
          } catch {
            embed.className =
              "preview-attachment-file preview-attachment-file-missing";
            embed.textContent = `Failed to read: ${label || target}`;
            return;
          }

          // Logseq / Obsidian `.md` drawings (excalidraw-plugin frontmatter).
          if (isObsidianExcalidrawMarkdown(sourceContent)) {
            try {
              await mountExcalidrawWikiEmbed(document, embed, sourceContent, {
                title: label || resolvedTarget.name,
                path: resolvedTarget.path,
                width: embedWidth,
                height: embedHeight,
              });
            } catch {
              embed.className =
                "preview-attachment-file preview-attachment-file-missing";
              embed.textContent = `Failed to preview attachment: ${label || resolvedTarget.name}`;
            }
            return;
          }

          const fragment = extractWikiNoteFragment(sourceContent, target);

          if (!fragment.markdown) {
            embed.className =
              "preview-attachment-file preview-attachment-file-missing";
            embed.textContent = `Missing reference: ${label || target}`;
            return;
          }

          const noteEmbed = document.createElement("section");
          noteEmbed.className = "preview-note-embed";
          if (embedWidth) noteEmbed.style.maxWidth = `${embedWidth}px`;
          if (embedHeight) {
            noteEmbed.style.maxHeight = `${embedHeight}px`;
            noteEmbed.style.overflow = "auto";
          }

          const title = document.createElement("div");
          title.className = "preview-note-embed-title";
          title.textContent = label || fragment.title;

          const body = document.createElement("article");
          body.className = "markdown-body preview-note-embed-body";
          try {
            const noteHtml = protectShikiPresInHtmlString(
              renderMarkdown(fragment.markdown, {
                highlighter,
                themeMode,
                markdownStylePreset,
                orderedListMode,
              }),
              shikiSnapshots,
            );
            body.innerHTML = noteHtml;
          } catch {
            body.innerHTML = `<p>Error rendering content</p>`;
          }

          noteEmbed.append(title, body);
          replaceWikiEmbedNode(embed, noteEmbed);
          return;
        }

        // Image embed
        if (isImageAttachment(resolvedTarget.name)) {
          const image = document.createElement("img");
          image.className = "preview-attachment-image";
          image.alt = label || resolvedTarget.name;
          if (embedWidth) {
            // Inline `!important` guards against preview CSS or WKWebView style quirks
            // that can otherwise override the embed sizing.
            image.style.setProperty("width", `${embedWidth}px`, "important");
            image.style.setProperty(
              "max-width",
              `${embedWidth}px`,
              "important",
            );
            // WKWebView may strip inline style on innerHTML readback; the typed
            // attr() fallback in preview.css may not work in older WKWebView.
            // The HTML width attribute is the most robust fallback (universal support).
            image.setAttribute("width", String(embedWidth));
            image.setAttribute("data-wiki-embed-w", String(embedWidth));
          }
          if (embedHeight) {
            image.style.setProperty("height", `${embedHeight}px`, "important");
            image.style.setProperty(
              "max-height",
              `${embedHeight}px`,
              "important",
            );
            image.style.objectFit = "contain";
            image.setAttribute("data-wiki-embed-h", String(embedHeight));
          }

          try {
            await configureResolvedPreviewImage(
              image,
              resolvedTarget.path,
              currentFilePath,
            );
          } catch {
            configurePreviewImageElement(image, "", resolvedTarget.path, {
              warmed: false,
            });
          }

          replaceWikiEmbedNode(embed, image);
          return;
        }

        if (isVideoAttachment(resolvedTarget.name)) {
          const video = document.createElement("video");
          video.className = "preview-attachment-video";
          video.controls = true;
          video.playsInline = true;
          video.preload = "metadata";
          if (embedWidth) video.style.width = `${embedWidth}px`;
          if (embedHeight) video.style.height = `${embedHeight}px`;

          try {
            video.src = await resolvePreviewSource(
              resolvedTarget.path,
              currentFilePath || undefined,
            );
            replaceWikiEmbedNode(embed, video);
          } catch {
            embed.className =
              "preview-attachment-file preview-attachment-file-missing";
            embed.textContent = `Failed to preview attachment: ${label || resolvedTarget.name}`;
          }
          return;
        }

        // PDF embed
        if (isPdfAttachment(resolvedTarget.name)) {
          try {
            const pdfSrc = await resolvePreviewSource(
              resolvedTarget.path,
              currentFilePath || undefined,
            );
            const pdfContainer = createPreviewPdfContainer(
              document,
              pdfSrc,
              label || resolvedTarget.name,
              resolvedTarget.path,
            );
            if (embedWidth) pdfContainer.style.width = `${embedWidth}px`;
            if (embedHeight) pdfContainer.style.height = `${embedHeight}px`;
            replaceWikiEmbedNode(embed, pdfContainer);
          } catch {
            embed.className =
              "preview-attachment-file preview-attachment-file-missing";
            embed.textContent = `Failed to preview attachment: ${label || resolvedTarget.name}`;
          }
          return;
        }

        // HTML attachment embed (sanitized, same policy as HTML tab preview)
        if (isHtmlDocument(resolvedTarget.name)) {
          try {
            const htmlContent = await readFile({
              id: resolvedTarget.path,
              name: resolvedTarget.name,
              type: "file",
              path: resolvedTarget.path,
            });
            const htmlContainer = createPreviewHtmlContainer(
              document,
              sanitizeHtmlPreview(htmlContent, true),
              {
                title: label || resolvedTarget.name,
                path: resolvedTarget.path,
              },
            );
            if (embedWidth) htmlContainer.style.width = `${embedWidth}px`;
            if (embedHeight) {
              htmlContainer.style.height = `${embedHeight}px`;
              htmlContainer.style.maxHeight = `${embedHeight}px`;
              htmlContainer.style.overflow = "auto";
            }
            replaceWikiEmbedNode(embed, htmlContainer);
          } catch {
            embed.className =
              "preview-attachment-file preview-attachment-file-missing";
            embed.textContent = `Failed to preview attachment: ${label || resolvedTarget.name}`;
          }
          return;
        }

        // Generic attachment
        const attachment = document.createElement("a");
        attachment.className = "preview-attachment-file";
        attachment.setAttribute("href", "#");
        attachment.dataset.attachmentPath = resolvedTarget.path;
        attachment.dataset.attachmentName = resolvedTarget.name;
        attachment.title = `Double-click to reveal ${resolvedTarget.name}`;
        if (embedWidth) attachment.style.maxWidth = `${embedWidth}px`;
        if (embedHeight) {
          attachment.style.maxHeight = `${embedHeight}px`;
          attachment.style.overflow = "auto";
        }

        const fileName = document.createElement("span");
        fileName.className = "preview-attachment-file-name";
        fileName.textContent = label || resolvedTarget.name;

        const hint = document.createElement("span");
        hint.className = "preview-attachment-file-hint";
        hint.textContent = "Double-click to reveal in Finder";

        attachment.append(fileName, hint);
        replaceWikiEmbedNode(embed, attachment);
      } catch (error) {
        console.warn("Failed to process embed:", error);
      }
    }),
  );

  return hydrateCachedPreviewImageSources(
    restoreShikiPresFromSnapshots(host.innerHTML, shikiSnapshots),
    currentFilePath || undefined,
  );
}
