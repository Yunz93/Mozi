import React from "react";
import { parseWikiLinkReference } from "../../utils/wikiLinks";
import {
  resolveAttachmentTarget,
  type AttachmentResolverContext,
} from "../../utils/attachmentResolver";
import {
  isHtmlDocument,
  isImageAttachment,
  isMarkdownNote,
  isPdfAttachment,
} from "./previewUtils";
import { sanitizeHtmlPreview } from "../editor/preview/previewRenderCore";
import {
  warmPreviewImage,
  resolvePreviewSource,
} from "../../utils/previewImageCache";
import { useI18n } from "../../hooks/useI18n";
import type { ShikiHighlighter } from "../../hooks/useShikiHighlighter";
import type { FileNode, MarkdownStylePreset, ThemeMode } from "../../types";

interface WikiLinkHandlerProps {
  target: string;
  label?: string;
  embedWidth?: number;
  embedHeight?: number;
  currentFilePath: string | null;
  attachmentResolverContext: AttachmentResolverContext;
  onNavigate?: (target: string) => Promise<void>;
  children?: React.ReactNode;
}

export const WikiLinkHandler: React.FC<WikiLinkHandlerProps> = ({
  target,
  label,
  embedWidth,
  embedHeight,
  currentFilePath,
  attachmentResolverContext,
  onNavigate,
  children,
}) => {
  const handleClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (onNavigate) {
      await onNavigate(target);
    }
  };

  const style: React.CSSProperties = {};
  if (embedWidth) style.width = `${embedWidth}px`;
  if (embedHeight) style.height = `${embedHeight}px`;

  return (
    <a
      className="markdown-link markdown-wikilink"
      href="#"
      data-wikilink={target}
      onClick={handleClick}
      style={style}
    >
      {children || label || target}
    </a>
  );
};

interface RenderMarkdownOptions {
  highlighter?: ShikiHighlighter | null;
  markdownStylePreset?: MarkdownStylePreset;
  themeMode?: ThemeMode;
}

interface AttachmentEmbedProps {
  target: string;
  label?: string;
  embedWidth?: number;
  embedHeight?: number;
  currentFilePath: string | null;
  attachmentResolverContext: AttachmentResolverContext;
  fileContents?: Record<string, string>;
  content?: string;
  readFile?: (
    node: Pick<FileNode, "id" | "name" | "type" | "path">,
  ) => Promise<string>;
  renderMarkdown?: (markdown: string, options: RenderMarkdownOptions) => string;
  markdownStylePreset?: MarkdownStylePreset;
  themeMode?: ThemeMode;
  highlighter?: ShikiHighlighter | null;
}

export const AttachmentEmbed: React.FC<AttachmentEmbedProps> = ({
  target,
  label,
  embedWidth,
  embedHeight,
  currentFilePath,
  attachmentResolverContext,
  fileContents,
  content,
  readFile,
  renderMarkdown,
  markdownStylePreset = "nord",
  themeMode = "light",
  highlighter,
}) => {
  const { t } = useI18n();
  const [resolved, setResolved] = React.useState<{
    type: "image" | "pdf" | "html" | "note" | "file";
    path: string;
    name: string;
    content?: string;
    title?: string;
  } | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const resolveEmbed = async () => {
      try {
        const parsedTarget = parseWikiLinkReference(target, { embed: true });
        const resolvedTarget = await resolveAttachmentTarget(
          attachmentResolverContext,
          target,
        );

        if (!resolvedTarget) {
          if (!cancelled) {
            setError(`Missing attachment: ${label || target}`);
            setLoading(false);
          }
          return;
        }

        if (isMarkdownNote(resolvedTarget.name)) {
          if (
            resolvedTarget.path === currentFilePath &&
            !parsedTarget.subpath.trim()
          ) {
            if (!cancelled) {
              setError("Cannot embed the entire current note into itself");
              setLoading(false);
            }
            return;
          }

          const sourceContent =
            resolvedTarget.path === currentFilePath && currentFilePath
              ? (fileContents?.[currentFilePath] ?? content ?? "")
              : readFile
                ? await readFile({
                    id: resolvedTarget.path,
                    name: resolvedTarget.name,
                    type: "file",
                    path: resolvedTarget.path,
                  })
                : "";

          // Simple fragment extraction - in real implementation would use extractWikiNoteFragment
          const title =
            label || resolvedTarget.name.replace(/\.(md|markdown)$/i, "");

          if (!cancelled) {
            setResolved({
              type: "note",
              path: resolvedTarget.path,
              name: resolvedTarget.name,
              content: sourceContent,
              title,
            });
            setLoading(false);
          }
          return;
        }

        if (isHtmlDocument(resolvedTarget.name)) {
          const htmlContent = readFile
            ? await readFile({
                id: resolvedTarget.path,
                name: resolvedTarget.name,
                type: "file",
                path: resolvedTarget.path,
              })
            : "";

          if (!cancelled) {
            setResolved({
              type: "html",
              path: resolvedTarget.path,
              name: resolvedTarget.name,
              content: htmlContent,
              title: label || resolvedTarget.name,
            });
            setLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setResolved({
            type: isImageAttachment(resolvedTarget.name)
              ? "image"
              : isPdfAttachment(resolvedTarget.name)
                ? "pdf"
                : "file",
            path: resolvedTarget.path,
            name: resolvedTarget.name,
          });
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Failed to resolve attachment: ${label || target}`);
          setLoading(false);
        }
      }
    };

    resolveEmbed();

    return () => {
      cancelled = true;
    };
  }, [
    target,
    currentFilePath,
    attachmentResolverContext,
    fileContents,
    content,
    readFile,
    label,
  ]);

  if (loading) {
    return <span className="text-gray-400">{t("preview_loading")}</span>;
  }

  if (error || !resolved) {
    const missingStyle: React.CSSProperties = {};
    if (embedWidth) missingStyle.maxWidth = `${embedWidth}px`;
    if (embedHeight) {
      missingStyle.maxHeight = `${embedHeight}px`;
      missingStyle.overflow = "auto";
    }
    return (
      <span
        className="preview-attachment-file preview-attachment-file-missing"
        style={missingStyle}
      >
        {error || "Missing attachment"}
      </span>
    );
  }

  const containerStyle: React.CSSProperties = {};
  if (embedWidth) containerStyle.maxWidth = `${embedWidth}px`;
  if (embedHeight) {
    containerStyle.maxHeight = `${embedHeight}px`;
    containerStyle.overflow = "auto";
  }

  if (resolved.type === "image") {
    return (
      <img
        src={resolved.path}
        alt={label || resolved.name}
        className="preview-attachment-image"
        style={{
          width: embedWidth,
          maxWidth: embedWidth,
          height: embedHeight,
          maxHeight: embedHeight,
          objectFit: embedHeight ? "contain" : undefined,
        }}
        decoding="async"
      />
    );
  }

  if (resolved.type === "pdf") {
    return (
      <iframe
        src={`${resolved.path}#toolbar=0&navpanes=0&scrollbar=1`}
        sandbox="allow-scripts allow-same-origin"
        title={label || resolved.name}
        className="preview-attachment-pdf"
        style={{ width: embedWidth, height: embedHeight }}
      />
    );
  }

  if (resolved.type === "html") {
    const htmlStyle: React.CSSProperties = { ...containerStyle };
    if (embedWidth) htmlStyle.width = `${embedWidth}px`;
    if (embedHeight) {
      htmlStyle.height = `${embedHeight}px`;
      htmlStyle.maxHeight = `${embedHeight}px`;
      htmlStyle.overflow = "auto";
    }
    return (
      <div
        className="preview-attachment-html preview-html-document"
        data-html-path={resolved.path}
        data-html-title={resolved.title || resolved.name}
        title={resolved.title || resolved.name}
        style={htmlStyle}
      >
        <iframe
          className="preview-html-frame"
          title={resolved.title || resolved.name}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          srcDoc={sanitizeHtmlPreview(resolved.content || "", true)}
          onLoad={(event) => {
            const doc = event.currentTarget.contentDocument;
            if (!doc?.body) return;
            void import("../editor/preview/htmlPreviewEnhance").then(
              ({
                ensureHtmlPreviewMermaidStyles,
                normalizeMermaidPlaceholdersInDocument,
              }) => {
                ensureHtmlPreviewMermaidStyles(doc);
                normalizeMermaidPlaceholdersInDocument(doc);
                const themeMode = document.documentElement.classList.contains(
                  "dark",
                )
                  ? "dark"
                  : "light";
                void import("../../utils/markdown-extensions").then(
                  ({ renderMermaidDiagrams }) => {
                    void renderMermaidDiagrams(doc.body, { themeMode });
                  },
                );
              },
            );
          }}
        />
      </div>
    );
  }

  if (resolved.type === "note") {
    return (
      <section className="preview-note-embed" style={containerStyle}>
        <div className="preview-note-embed-title">{resolved.title}</div>
        {resolved.content && renderMarkdown && (
          <article
            className="markdown-body preview-note-embed-body"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(resolved.content, {
                highlighter,
                markdownStylePreset,
                themeMode,
              }),
            }}
          />
        )}
      </section>
    );
  }

  // Generic file attachment
  const fileStyle: React.CSSProperties = {};
  if (embedWidth) fileStyle.maxWidth = `${embedWidth}px`;
  if (embedHeight) {
    fileStyle.maxHeight = `${embedHeight}px`;
    fileStyle.overflow = "auto";
  }
  return (
    <a
      className="preview-attachment-file"
      href="#"
      data-attachment-path={resolved.path}
      data-attachment-name={resolved.name}
      title={`${t("preview_doubleClickReveal")}: ${resolved.name}`}
      style={fileStyle}
    >
      <span className="preview-attachment-file-name">
        {label || resolved.name}
      </span>
      <span className="preview-attachment-file-hint">
        {t("preview_doubleClickReveal")}
      </span>
    </a>
  );
};
