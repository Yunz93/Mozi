/**
 * Helpers for HTML-file preview: Mermaid placeholder normalization and zoom math.
 */

export const HTML_PREVIEW_ZOOM_MIN = 0.25;
export const HTML_PREVIEW_ZOOM_MAX = 3;
export const HTML_PREVIEW_ZOOM_STEP = 0.1;

const MERMAID_STYLE_ID = "mp-html-preview-mermaid-style";

export function clampHtmlPreviewZoom(zoom: number): number {
  const clamped = Math.min(
    HTML_PREVIEW_ZOOM_MAX,
    Math.max(HTML_PREVIEW_ZOOM_MIN, zoom),
  );
  return Math.round(clamped * 100) / 100;
}

/**
 * Scale that fits content width into the viewport without upscaling past 100%.
 * Height is ignored so tall pages fill the pane width and scroll vertically
 * instead of shrinking to a postage stamp (fit-to-page).
 */
export function computeHtmlPreviewFitZoom(
  contentWidth: number,
  _contentHeight: number,
  viewWidth: number,
  _viewHeight: number,
): number {
  if (contentWidth <= 0 || viewWidth <= 0) {
    return 1;
  }
  const fit = Math.min(1, viewWidth / contentWidth);
  return clampHtmlPreviewZoom(fit);
}

export function nextHtmlPreviewZoom(
  current: number,
  direction: 1 | -1,
): number {
  return clampHtmlPreviewZoom(current + direction * HTML_PREVIEW_ZOOM_STEP);
}

/**
 * Convert common Mermaid markup shapes in raw HTML into `.mermaid` hosts that
 * `renderMermaidDiagrams` understands (scripts are stripped by DOMPurify).
 */
export function normalizeMermaidPlaceholdersInDocument(doc: Document): number {
  let converted = 0;

  const codeNodes = Array.from(
    doc.querySelectorAll(
      'code.language-mermaid, code.language-mmd, code[class*="language-mermaid"], code[class*="language-mmd"]',
    ),
  ) as HTMLElement[];

  for (const code of codeNodes) {
    if (code.closest(".mermaid")) continue;
    const definition = (code.textContent || "").trim();
    if (!definition) continue;
    const host = (code.closest("pre") as HTMLElement | null) ?? code;
    const div = doc.createElement("div");
    div.className = "mermaid";
    div.textContent = definition;
    host.replaceWith(div);
    converted += 1;
  }

  // `<pre class="mermaid">` / `<code class="mermaid">` already match `.mermaid`.
  return converted;
}

export function ensureHtmlPreviewMermaidStyles(doc: Document): void {
  if (doc.getElementById(MERMAID_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = MERMAID_STYLE_ID;
  style.textContent = `
.mermaid {
  overflow-x: auto;
  text-align: center;
  margin: 1rem 0;
}
.mermaid svg {
  max-width: 100%;
  height: auto;
}
.mermaid-error {
  color: #b91c1c;
  font-size: 0.875rem;
  text-align: left;
  white-space: pre-wrap;
}
`;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function applyHtmlPreviewZoom(doc: Document, zoom: number): void {
  const root = doc.documentElement;
  if (!root) return;
  const value = String(clampHtmlPreviewZoom(zoom));
  root.style.zoom = value;
}

export function measureHtmlPreviewContentSize(doc: Document): {
  width: number;
  height: number;
} {
  const root = doc.documentElement;
  const body = doc.body;
  if (!root) return { width: 0, height: 0 };

  // Measure at zoom=1 so fit math is stable.
  const previousZoom = root.style.zoom;
  root.style.zoom = "1";

  const width = Math.max(
    root.scrollWidth,
    body?.scrollWidth ?? 0,
    root.offsetWidth,
  );
  const height = Math.max(
    root.scrollHeight,
    body?.scrollHeight ?? 0,
    root.offsetHeight,
  );

  root.style.zoom = previousZoom;
  return { width, height };
}

export function isHtmlPreviewZoomModifier(event: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey;
}
