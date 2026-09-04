import {
  createAttachmentResolverContext,
  resolveAttachmentTarget,
} from "../attachmentResolver";
import { parseWikiLinkReference } from "../wikiLinks";
import { renderMermaidDiagrams } from "../markdown-extensions";
import { PREVIEW_PANEL_WIDTH_PX, type ExportAttachmentContext } from "./types";
import {
  prepareExportImages,
  waitForImages,
  waitForNextPaint,
  isImageAttachmentName,
} from "./images";
import {
  protectShikiPresInHtmlString,
  restoreShikiPresFromSnapshots,
} from "../../components/editor/preview/shikiHtmlSnapshots";

export type { ExportAttachmentContext } from "./types";

export async function enhanceExportAttachmentEmbeds(
  container: HTMLElement,
  sourceFilePath?: string,
  attachmentContext?: ExportAttachmentContext | null,
): Promise<void> {
  if (!sourceFilePath) return;

  const resolverContext = createAttachmentResolverContext(
    attachmentContext?.files ?? [],
    attachmentContext?.rootFolderPath ?? null,
    sourceFilePath,
  );
  const embeds = Array.from(
    container.querySelectorAll<HTMLElement>(
      "article.markdown-body [data-wiki-embed], article.markdown-body a.markdown-embed",
    ),
  );

  for (const embed of embeds) {
    const target =
      embed.dataset.wikiTarget?.trim() || embed.dataset.wikilink?.trim();
    if (!target) continue;

    const resolvedTarget = await resolveAttachmentTarget(
      resolverContext,
      target,
    );
    if (!resolvedTarget || !isImageAttachmentName(resolvedTarget.name)) {
      continue;
    }

    const parsedTarget = parseWikiLinkReference(target, { embed: true });
    const width =
      embed.dataset.wikiWidth ||
      (parsedTarget.embedSize?.width
        ? String(parsedTarget.embedSize.width)
        : "");
    const height =
      embed.dataset.wikiHeight ||
      (parsedTarget.embedSize?.height
        ? String(parsedTarget.embedSize.height)
        : "");
    const image = document.createElement("img");
    image.className = "preview-attachment-image";
    image.alt = embed.dataset.wikiLabel?.trim() || resolvedTarget.name;
    image.setAttribute("data-original-src", resolvedTarget.path);
    image.setAttribute("src", resolvedTarget.path);

    if (width) {
      image.style.width = `${width}px`;
      image.setAttribute("width", width);
      image.setAttribute("data-wiki-embed-w", width);
    }
    if (height) {
      image.style.height = `${height}px`;
      image.style.objectFit = "contain";
      image.setAttribute("height", height);
      image.setAttribute("data-wiki-embed-h", height);
    }

    embed.replaceWith(image);
  }
}

export async function prepareHtmlForDownload(
  htmlContent: string,
  sourceFilePath?: string,
  attachmentContext?: ExportAttachmentContext | null,
): Promise<string> {
  const parsed = new DOMParser().parseFromString(htmlContent, "text/html");
  const styleContent = Array.from(parsed.head.querySelectorAll("style"))
    .map((style) => style.textContent || "")
    .join("\n");
  const theme =
    parsed.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  const backgroundColor = theme === "dark" ? "#0d1117" : "#ffffff";

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${PREVIEW_PANEL_WIDTH_PX}px`;
  host.style.background = backgroundColor;
  host.style.pointerEvents = "none";
  host.style.visibility = "hidden";
  host.style.opacity = "0";
  host.style.overflow = "visible";
  const shikiSnapshots: string[] = [];
  host.innerHTML = protectShikiPresInHtmlString(
    `<style>${styleContent}</style>${parsed.body.innerHTML}`,
    shikiSnapshots,
  );
  document.body.appendChild(host);

  try {
    const exportRoot = host.querySelector(
      ".export-document",
    ) as HTMLElement | null;
    const renderTarget = exportRoot || host;

    renderTarget.setAttribute("data-theme", theme);
    await enhanceExportAttachmentEmbeds(
      renderTarget,
      sourceFilePath,
      attachmentContext,
    );
    await prepareExportImages(renderTarget, sourceFilePath, attachmentContext);
    await renderMermaidDiagrams(renderTarget, {
      themeMode: theme === "dark" ? "dark" : "light",
    });
    await waitForImages(renderTarget);
    if ("fonts" in document) {
      await document.fonts.ready;
    }
    await waitForNextPaint(2);

    const processedBody = restoreShikiPresFromSnapshots(
      host.innerHTML.replace(/^[\s]*<style>[\s\S]*?<\/style>/, ""),
      shikiSnapshots,
    );
    return `<!DOCTYPE html>
<html lang="${parsed.documentElement.lang || "en"}" data-theme="${theme}">
<head>
${parsed.head.innerHTML}
</head>
<body>
${processedBody}
</body>
</html>`;
  } finally {
    host.remove();
  }
}
