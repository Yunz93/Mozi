export interface ExternalVideoEmbed {
  provider: "youtube" | "bilibili";
  src: string;
  title: string;
}

export function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z\d+\-.]*:/i.test(value.trim());
}

export function isLocalPreviewLinkHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return false;
  }

  return !hasUriScheme(trimmed);
}

export function getLocalPreviewLinkTarget(href: string): string {
  const trimmed = href.trim();
  const hashIndex = trimmed.indexOf("#");
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const queryIndex = withoutHash.indexOf("?");
  const withoutQuery = (
    queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
  ).trim();

  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

export function isImageAttachment(fileName: string): boolean {
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(fileName);
}

export function isMarkdownNote(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName);
}

export function isPdfAttachment(fileName: string): boolean {
  return /\.pdf$/i.test(fileName);
}

export function createPreviewPdfContainer(
  document: Document,
  src: string,
  title: string,
  path?: string,
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "preview-attachment-pdf preview-pdfjs";
  container.dataset.pdfSrc = src;
  container.dataset.pdfTitle = title;
  if (path) {
    container.dataset.pdfPath = path;
  }
  container.dataset.pdfjsState = "pending";
  container.textContent = "Loading PDF...";
  return container;
}

/**
 * Host for HTML attachment embeds (`![[page.html]]`).
 * Shows the file as plain-text source (not a rendered document) so scripts
 * never execute and the markup itself stays readable.
 */
export function createPreviewHtmlContainer(
  document: Document,
  htmlSource: string,
  options?: { title?: string; path?: string },
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "preview-attachment-html preview-html-source";
  if (options?.path) {
    container.dataset.htmlPath = options.path;
  }
  if (options?.title) {
    container.dataset.htmlTitle = options.title;
    container.title = options.title;
  }
  const pre = document.createElement("pre");
  pre.className = "preview-html-source-pre";
  pre.textContent = htmlSource;
  container.appendChild(pre);
  return container;
}

export function isVideoAttachment(fileName: string): boolean {
  return /\.(mp4|m4v|mov|webm|ogv|ogg)$/i.test(fileName);
}

export function isHtmlDocument(fileName: string): boolean {
  return /\.html?$/i.test(fileName);
}

export function isExcalidrawAttachment(fileName: string): boolean {
  return /\.excalidraw(?:\.json)?$/i.test(fileName);
}

export type PreviewFileType =
  | "markdown"
  | "image"
  | "video"
  | "pdf"
  | "html"
  | "excalidraw"
  | "unsupported";

export function getPreviewFileType(
  filePath: string | null | undefined,
): PreviewFileType {
  if (!filePath) return "markdown";
  if (isImageAttachment(filePath)) return "image";
  if (isVideoAttachment(filePath)) return "video";
  if (isPdfAttachment(filePath)) return "pdf";
  if (isHtmlDocument(filePath)) return "html";
  if (isExcalidrawAttachment(filePath)) return "excalidraw";
  if (isMarkdownNote(filePath)) return "markdown";
  return "unsupported";
}

export function hasWikiEmbedsInHtml(html: string): boolean {
  if (!html) return false;
  // Do not match exact attribute/class strings: DOMPurify may reorder class tokens
  // (`markdown-embed` before `markdown-link`) or normalize `data-wiki-embed` across
  // engines. If this returns false, preview skips async embed enhancement entirely
  // (release WKWebView then shows unsized placeholder links).
  // 参见 src/utils/webkitCompat.ts — Quirk 6
  return /\bdata-wiki-embed\b/i.test(html);
}

export function hasEmbeddableMediaLinksInHtml(html: string): boolean {
  return /href="https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com|bilibili\.com|player\.bilibili\.com)\//i.test(
    html,
  );
}

function resolveYouTubeEmbed(url: URL): ExternalVideoEmbed | null {
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  let videoId = "";

  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    }
  } else if (
    hostname === "youtube-nocookie.com" &&
    url.pathname.startsWith("/embed/")
  ) {
    videoId = url.pathname.split("/")[2] ?? "";
  }

  if (!videoId) return null;

  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  const start = url.searchParams.get("t") ?? url.searchParams.get("start");
  if (start) {
    embedUrl.searchParams.set("start", start.replace(/s$/i, ""));
  }

  return {
    provider: "youtube",
    src: embedUrl.toString(),
    title: "YouTube video",
  };
}

function resolveBilibiliEmbed(url: URL): ExternalVideoEmbed | null {
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();

  if (hostname === "player.bilibili.com" && url.pathname === "/player.html") {
    return {
      provider: "bilibili",
      src: url.toString(),
      title: "Bilibili video",
    };
  }

  if (!hostname.endsWith("bilibili.com")) {
    return null;
  }

  const match = url.pathname.match(/\/video\/((?:BV[\w]+)|(?:av\d+))/i);
  if (!match) return null;

  const rawId = match[1];
  const embedUrl = new URL("https://player.bilibili.com/player.html");

  if (/^BV/i.test(rawId)) {
    embedUrl.searchParams.set("bvid", rawId);
  } else {
    embedUrl.searchParams.set("aid", rawId.replace(/^av/i, ""));
  }

  const page = url.searchParams.get("p");
  if (page) {
    embedUrl.searchParams.set("page", page);
  }

  return {
    provider: "bilibili",
    src: embedUrl.toString(),
    title: "Bilibili video",
  };
}

export function resolveExternalVideoEmbed(
  rawUrl: string,
): ExternalVideoEmbed | null {
  try {
    const url = new URL(rawUrl);
    return resolveYouTubeEmbed(url) ?? resolveBilibiliEmbed(url);
  } catch {
    return null;
  }
}

export function buildIframeEmbed(
  document: Document,
  embed: ExternalVideoEmbed,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `preview-external-video-embed is-${embed.provider}`;

  const frame = document.createElement("iframe");
  frame.className = "preview-external-video-frame";
  frame.src = embed.src;
  frame.title = embed.title;
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allowFullscreen = true;
  frame.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
  );

  wrapper.appendChild(frame);
  return wrapper;
}

export function normalizeExistingIframe(frame: HTMLIFrameElement): void {
  frame.classList.add("preview-external-video-frame");
  if (!frame.getAttribute("loading")) {
    frame.setAttribute("loading", "lazy");
  }
  if (!frame.getAttribute("referrerpolicy")) {
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  }
  if (!frame.getAttribute("allow")) {
    frame.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    );
  }
  frame.setAttribute("allowfullscreen", "true");
}

export function configurePreviewImageElement(
  image: HTMLImageElement,
  src: string,
  originalSrc: string,
  options?: { warmed?: boolean },
): void {
  const warmed = options?.warmed !== false;
  if (src) {
    image.setAttribute("src", src);
  } else {
    image.removeAttribute("src");
  }
  image.setAttribute("data-original-src", originalSrc);
  image.setAttribute("data-preview-warmed", warmed ? "true" : "pending");
  if (!warmed) {
    image.setAttribute("data-preview-pending-src", originalSrc);
  } else {
    image.removeAttribute("data-preview-pending-src");
  }
  image.setAttribute("decoding", "async");
  image.setAttribute("loading", "lazy");
  image.setAttribute("fetchpriority", "auto");
}
