import { renderMarkdown } from "../markdown";
import { parseFrontmatter } from "../frontmatter";
import {
  buildCodeExportFontFamily,
  buildPreviewExportFontFamily,
} from "../fontSettings";
import { getKatexRenderMode } from "../markdown-extensions";
import type { ExportOptions } from "./types";
import {
  buildExportStyles,
  buildExportDocument,
  buildExportFontFaceCss,
  renderProperties,
  generateTOC,
  injectExportHeadingIds,
} from "./styles";
import { saveExportFile } from "./core";
import {
  prepareHtmlForDownload,
  type ExportAttachmentContext,
} from "./attachments";

export async function exportToHtml(
  content: string,
  options: ExportOptions = {},
): Promise<string> {
  const {
    title = "Exported Document",
    theme = "light",
    includeTOC = false,
    fontFamily,
    codeFontFamily,
    fontSettings,
    fontSize,
    codeFontSize,
    includeProperties = true,
    highlighter,
    markdownStylePreset = "nord",
    orderedListMode,
    language = "zh-CN",
  } = options;

  const { frontmatter, body } = parseFrontmatter(content);
  const renderedContent = renderMarkdown(body, {
    highlighter,
    markdownStylePreset,
    themeMode: theme,
    orderedListMode,
  });
  const katexRenderMode = getKatexRenderMode();

  // Generate table of contents if requested. When enabled, bake matching
  // heading ids into the rendered HTML so the anchors resolve.
  const toc = includeTOC ? generateTOC(body) : "";
  const htmlContent = includeTOC
    ? injectExportHeadingIds(renderedContent, body)
    : renderedContent;
  const resolvedFontFamily =
    fontFamily ||
    (fontSettings ? buildPreviewExportFontFamily(fontSettings) : undefined);
  const resolvedCodeFontFamily =
    codeFontFamily ||
    (fontSettings ? buildCodeExportFontFamily(fontSettings) : undefined);
  const fontFaceCss = await buildExportFontFaceCss(fontSettings);
  const styles = buildExportStyles(
    theme,
    resolvedFontFamily,
    fontSize,
    fontFaceCss,
    resolvedCodeFontFamily,
    codeFontSize,
    markdownStylePreset,
  );
  const propertiesHtml = includeProperties ? renderProperties(frontmatter) : "";
  const documentMarkup = buildExportDocument(
    `${propertiesHtml}<article class="markdown-body preview-pane-document" data-markdown-style="${markdownStylePreset}">${htmlContent}</article>`,
    toc,
    markdownStylePreset,
    theme,
  );

  const html = `<!DOCTYPE html>
	<html lang="${language === "en" ? "en" : "zh-CN"}" data-theme="${theme}" class="${theme === "dark" ? "dark" : ""}"${katexRenderMode ? ` data-katex-render-mode="${katexRenderMode}"` : ""}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    ${styles}
  </style>
</head>
<body>
  ${documentMarkup}
</body>
</html>`;

  return html;
}

export async function downloadHtml(
  htmlContent: string,
  filename: string,
  sourceFilePath?: string,
  attachmentContext?: ExportAttachmentContext | null,
): Promise<string | null> {
  return saveExportFile({
    content: await prepareHtmlForDownload(
      htmlContent,
      sourceFilePath,
      attachmentContext,
    ),
    filename,
    defaultExtension: ".html",
    mimeType: "text/html;charset=utf-8",
    description: "HTML Document",
  });
}
