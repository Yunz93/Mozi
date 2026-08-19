import { renderMermaidDiagrams } from "../markdown-extensions";
import { getPlatformIdentifier } from "../platform";
import { PREVIEW_PANEL_WIDTH_PX, type ExportAttachmentContext } from "./types";
import { enhanceExportAttachmentEmbeds } from "./attachments";
import { prepareExportImages, waitForImages, waitForNextPaint } from "./images";
import { patchExportDomForHtml2Canvas } from "./rasterDomPatch";

/**
 * Largest single-canvas dimension html2canvas can safely allocate.
 *
 * Chromium's per-dimension canvas/GPU-texture cap is 16384px on most Windows
 * GPU drivers (and in WebView2). Going past it blanks the canvas or crashes
 * the renderer. We leave ~2.3k px headroom for resampling and rounding.
 */
export const EXPORT_MAX_CANVAS_DIMENSION = 14000;

/** Default rasterization scale; chosen for crisp PDF / long-image output on short documents. */
export const EXPORT_REQUESTED_RENDER_SCALE = 2.5;

/** 非 Windows 长图导出可保留更多纵向像素，避免过早降采样。 */
export const LONG_IMAGE_MAX_CANVAS_DIMENSION = 30000;

/**
 * Absolute floor on the render scale. We allow sub-1.0 scales for very long
 * documents because a grainy raster is strictly better than a Windows WebView2
 * renderer crash from canvas-dimension overflow. Below ~0.1 the output is
 * not legible at all, so we cap there.
 */
export const EXPORT_MIN_RENDER_SCALE = 0.1;

/**
 * Clamp the html2canvas `scale` so neither dimension of the resulting canvas
 * exceeds the per-dimension canvas limit.
 *
 * Exported for testing.
 */
export function computeSafePdfRenderScale(
  containerWidthPx: number,
  containerHeightPx: number,
  requestedScale: number = EXPORT_REQUESTED_RENDER_SCALE,
  maxCanvasDimension: number = EXPORT_MAX_CANVAS_DIMENSION,
): number {
  const safeWidth =
    containerWidthPx > 0
      ? maxCanvasDimension / containerWidthPx
      : requestedScale;
  const safeHeight =
    containerHeightPx > 0
      ? maxCanvasDimension / containerHeightPx
      : requestedScale;
  const bounded = Math.min(requestedScale, safeWidth, safeHeight);
  return Math.max(EXPORT_MIN_RENDER_SCALE, bounded);
}

export function computeSafeLongImageRenderScale(
  containerWidthPx: number,
  containerHeightPx: number,
  requestedScale: number = EXPORT_REQUESTED_RENDER_SCALE,
  platformIdentifier: string = getPlatformIdentifier(),
): number {
  const maxCanvasDimension = platformIdentifier.includes("win")
    ? EXPORT_MAX_CANVAS_DIMENSION
    : LONG_IMAGE_MAX_CANVAS_DIMENSION;
  return computeSafePdfRenderScale(
    containerWidthPx,
    containerHeightPx,
    requestedScale,
    maxCanvasDimension,
  );
}

export const EXPORT_RASTER_STYLE_ID = "mp-export-raster-styles";
export const EXPORT_RASTER_HOST_CLASS = "mp-export-raster-host";
export const EXPORT_IMAGE_WAIT_TIMEOUT_MS = 12_000;
export const EXPORT_HTML2CANVAS_TIMEOUT_MS = 120_000;
export const EXPORT_FONTS_READY_TIMEOUT_MS = 8_000;

export interface ExportRasterHostStyleSnapshot {
  visibility: string;
  opacity: string;
  left: string;
  top: string;
  zIndex: string;
  clipPath: string;
  clip: string;
  pointerEvents: string;
}

export interface Html2CanvasRasterOptions {
  scale: number;
  backgroundColor: string;
  renderTarget: HTMLElement;
}

export function buildHtml2CanvasRasterOptions(
  options: Html2CanvasRasterOptions,
): Record<string, unknown> {
  const { scale, backgroundColor, renderTarget } = options;
  return {
    scale,
    useCORS: true,
    backgroundColor,
    width: renderTarget.scrollWidth,
    height: renderTarget.scrollHeight,
    windowWidth: renderTarget.scrollWidth,
    windowHeight: renderTarget.scrollHeight,
    scrollX: 0,
    scrollY: 0,
    logging: false,
  };
}

function snapshotExportRasterHostStyles(
  host: HTMLDivElement,
): ExportRasterHostStyleSnapshot {
  return {
    visibility: host.style.visibility,
    opacity: host.style.opacity,
    left: host.style.left,
    top: host.style.top,
    zIndex: host.style.zIndex,
    clipPath: host.style.clipPath,
    clip: host.style.clip,
    pointerEvents: host.style.pointerEvents,
  };
}

/** Make the export host paintable for html2canvas without covering the app UI. */
export function revealExportRasterHostForCapture(
  host: HTMLDivElement,
): ExportRasterHostStyleSnapshot {
  const snapshot = snapshotExportRasterHostStyles(host);
  host.style.visibility = "visible";
  host.style.opacity = "1";
  host.style.left = "0";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  // Stay below dialogs/modals (z-[200]+). A top-layer host blocks scroll and close clicks.
  host.style.zIndex = "-1";
  return snapshot;
}

export async function withExportTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function awaitDocumentFontsReady(
  timeoutMs: number = EXPORT_FONTS_READY_TIMEOUT_MS,
): Promise<void> {
  if (!("fonts" in document)) {
    return;
  }

  await Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

export function restoreExportRasterHostStyles(
  host: HTMLDivElement,
  snapshot: ExportRasterHostStyleSnapshot,
): void {
  host.style.visibility = snapshot.visibility;
  host.style.opacity = snapshot.opacity;
  host.style.left = snapshot.left;
  host.style.top = snapshot.top;
  host.style.zIndex = snapshot.zIndex;
  host.style.clipPath = snapshot.clipPath;
  host.style.clip = snapshot.clip;
  host.style.pointerEvents = snapshot.pointerEvents;
}

export interface MountedExportRasterHost {
  host: HTMLDivElement;
  renderTarget: HTMLElement;
  theme: "light" | "dark";
  backgroundColor: string;
}

function removeExportRasterStyles(): void {
  document.getElementById(EXPORT_RASTER_STYLE_ID)?.remove();
}

export function mountExportHtmlForRasterization(
  htmlContent: string,
): MountedExportRasterHost {
  const parsed = new DOMParser().parseFromString(htmlContent, "text/html");
  const styleContent = Array.from(parsed.head.querySelectorAll("style"))
    .map((style) => style.textContent || "")
    .join("\n");
  const theme =
    parsed.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  const backgroundColor = theme === "dark" ? "#0d1117" : "#ffffff";

  removeExportRasterStyles();
  const styleElement = document.createElement("style");
  styleElement.id = EXPORT_RASTER_STYLE_ID;
  styleElement.textContent = styleContent;
  document.head.appendChild(styleElement);

  const host = document.createElement("div");
  host.className = EXPORT_RASTER_HOST_CLASS;
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.right = "0";
  host.style.width = `${PREVIEW_PANEL_WIDTH_PX}px`;
  host.style.maxWidth = "100vw";
  host.style.margin = "0 auto";
  host.style.background = backgroundColor;
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
  // Keep in-viewport for WKWebView image decode. Avoid clip-path here — clipped images may
  // never fire load/error and stall waitForImages indefinitely.
  host.style.visibility = "visible";
  host.style.opacity = "0.01";
  host.innerHTML = parsed.body.innerHTML;
  document.body.appendChild(host);

  const exportRoot = host.querySelector(
    ".export-document",
  ) as HTMLElement | null;
  const renderTarget = exportRoot || host;
  renderTarget.setAttribute("data-theme", theme);

  return { host, renderTarget, theme, backgroundColor };
}

export async function prepareExportRenderTargetForRasterization(
  renderTarget: HTMLElement,
  theme: "light" | "dark",
  sourceFilePath?: string,
  attachmentContext?: ExportAttachmentContext | null,
): Promise<void> {
  await enhanceExportAttachmentEmbeds(
    renderTarget,
    sourceFilePath,
    attachmentContext,
  );
  await prepareExportImages(renderTarget, sourceFilePath, attachmentContext);
  await renderMermaidDiagrams(renderTarget, {
    themeMode: theme === "dark" ? "dark" : "light",
  });
  await waitForImages(renderTarget, EXPORT_IMAGE_WAIT_TIMEOUT_MS);
  await awaitDocumentFontsReady();
  patchExportDomForHtml2Canvas(renderTarget);
  await waitForNextPaint(3);
}

export function disposeExportRasterHost(host: HTMLDivElement): void {
  removeExportRasterStyles();
  if (host.parentNode) {
    host.parentNode.removeChild(host);
  }
}

/** Best-effort cleanup when a raster pass aborts or a dialog closes mid-export. */
export function disposeAllExportRasterArtifacts(): void {
  removeExportRasterStyles();
  document.querySelectorAll(`.${EXPORT_RASTER_HOST_CLASS}`).forEach((node) => {
    node.parentNode?.removeChild(node);
  });
}

export async function yieldToEventLoopForRasterCapture(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}
