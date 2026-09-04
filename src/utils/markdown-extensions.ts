import katex from "katex";
import {
  renderMermaidSVG,
  THEMES,
  type RenderOptions,
} from "beautiful-mermaid";
import { isTauriEnvironment } from "../types/filesystem";

// KaTeX options
const katexOptions: katex.KatexOptions = {
  throwOnError: false,
  displayMode: false,
  output: "htmlAndMathml",
  strict: false,
  trust: false,
};

// KaTeX renders synchronously inside markdown-it, so math-heavy documents pay
// the full cost on every preview re-render. Formulas rarely change between
// keystrokes elsewhere in the document - memoize rendered output.
const KATEX_CACHE_MAX_ENTRIES = 500;
const katexRenderCache = new Map<string, string>();

/** Test-only: reset the memoized KaTeX output between test cases. */
export function clearKatexRenderCacheForTests(): void {
  katexRenderCache.clear();
}

function renderKatexCached(content: string, displayMode: boolean): string {
  const cacheKey = `${displayMode ? "d" : "i"}:${content}`;
  const cached = katexRenderCache.get(cacheKey);
  if (cached !== undefined) {
    // Refresh recency for simple LRU behavior.
    katexRenderCache.delete(cacheKey);
    katexRenderCache.set(cacheKey, cached);
    return cached;
  }

  const rendered = katex.renderToString(
    content,
    displayMode ? { ...katexOptions, displayMode: true } : katexOptions,
  );

  if (katexRenderCache.size >= KATEX_CACHE_MAX_ENTRIES) {
    const oldestKey = katexRenderCache.keys().next().value;
    if (oldestKey !== undefined) {
      katexRenderCache.delete(oldestKey);
    }
  }
  katexRenderCache.set(cacheKey, rendered);
  return rendered;
}

/** Public KaTeX render helper for Live Preview widgets and other callers. */
export function renderKatexHtml(content: string, displayMode = false): string {
  return renderKatexCached(content, displayMode);
}

let beautifulMermaidModulePromise: Promise<
  typeof import("beautiful-mermaid")
> | null = null;
let officialMermaidModulePromise: Promise<typeof import("mermaid")> | null =
  null;
let officialMermaidStyleCounter = 0;
let lastOfficialMermaidThemeMode: "light" | "dark" | null = null;

const MERMAID_THEME_BY_MODE = {
  light: "nord-light",
  dark: "nord",
} as const;

/** beautiful-mermaid color-mix percentages for derived tokens (see package `MIX`). */
const BEAUTIFUL_MERMAID_MIX = {
  nodeFill: 3,
  nodeStroke: 20,
  groupHeader: 5,
  innerStroke: 12,
  textFaint: 25,
  keyBadge: 10,
} as const;

export type MermaidRendererKind = "beautiful" | "official";

export function mixSrgbHex(fg: string, bg: string, fgPercent: number): string {
  const parse = (hex: string): [number, number, number] => {
    const normalized = hex.trim().replace(/^#/, "");
    const expanded =
      normalized.length === 3
        ? normalized
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : normalized;
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
    ];
  };

  const [fr, fgGreen, fb] = parse(fg);
  const [br, bgGreen, bb] = parse(bg);
  const weight = Math.min(100, Math.max(0, fgPercent)) / 100;
  const channel = (foreground: number, background: number) =>
    Math.round(foreground * weight + background * (1 - weight));
  const toHex = (value: number) => value.toString(16).padStart(2, "0");

  return `#${toHex(channel(fr, br))}${toHex(channel(fgGreen, bgGreen))}${toHex(channel(fb, bb))}`;
}

export function getBeautifulMermaidThemeColors(themeMode: "light" | "dark") {
  return THEMES[MERMAID_THEME_BY_MODE[themeMode]];
}

/**
 * WKWebView / Tauri CSP blocks Google Fonts @import inside inline SVG styles, and
 * some release WebViews do not resolve `color-mix()` in SVG <style> blocks. When
 * those derived tokens fail, node fills fall back to solid black bars.
 */
export function prepareBeautifulMermaidSvg(
  svgMarkup: string,
  colors: { bg: string; fg: string; surface?: string; border?: string },
): string {
  const mix = (pct: number) => mixSrgbHex(colors.fg, colors.bg, pct);
  const surface = colors.surface ?? mix(BEAUTIFUL_MERMAID_MIX.nodeFill);
  const border = colors.border ?? mix(BEAUTIFUL_MERMAID_MIX.nodeStroke);
  const compatVars = [
    `--surface:${surface}`,
    `--border:${border}`,
    `--_group-hdr:${mix(BEAUTIFUL_MERMAID_MIX.groupHeader)}`,
    `--_inner-stroke:${mix(BEAUTIFUL_MERMAID_MIX.innerStroke)}`,
    `--_text-faint:${mix(BEAUTIFUL_MERMAID_MIX.textFaint)}`,
    `--_key-badge:${mix(BEAUTIFUL_MERMAID_MIX.keyBadge)}`,
  ].join(";");

  const withoutBlockedImports = svgMarkup.replace(/\s*@import[^;]+;/g, "");

  return withoutBlockedImports.replace(
    /(<svg\b[^>]*\bstyle=")([^"]*)(")/,
    `$1$2;${compatVars}$3`,
  );
}

export function getMermaidFirstDirective(definition: string): string {
  for (const rawLine of definition.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%")) continue;
    return line.toLowerCase();
  }
  return "";
}

/** Route supported diagram types to beautiful-mermaid; everything else uses official Mermaid. */
export function getMermaidRendererKind(
  definition: string,
): MermaidRendererKind {
  const firstDirective = getMermaidFirstDirective(definition);
  if (!firstDirective) {
    return "beautiful";
  }

  if (/^(graph|flowchart)\b/.test(firstDirective)) return "beautiful";
  if (/^statediagram(-v2)?\b/.test(firstDirective)) return "beautiful";
  if (/^sequencediagram\b/.test(firstDirective)) return "beautiful";
  if (/^classdiagram\b/.test(firstDirective)) return "beautiful";
  if (/^erdiagram\b/.test(firstDirective)) return "beautiful";
  if (/^xychart(-beta)?\b/.test(firstDirective)) return "beautiful";

  return "official";
}

async function loadBeautifulMermaidModule() {
  if (!beautifulMermaidModulePromise) {
    beautifulMermaidModulePromise = import("beautiful-mermaid");
  }
  return beautifulMermaidModulePromise;
}

async function loadOfficialMermaidModule() {
  if (!officialMermaidModulePromise) {
    officialMermaidModulePromise = import("mermaid");
  }
  return (await officialMermaidModulePromise).default;
}

async function ensureOfficialMermaidConfigured(themeMode: "light" | "dark") {
  const mermaid = await loadOfficialMermaidModule();
  if (lastOfficialMermaidThemeMode === themeMode) {
    return mermaid;
  }

  mermaid.initialize({
    startOnLoad: false,
    theme: themeMode === "dark" ? "dark" : "default",
    fontFamily: '"Trebuchet MS", Verdana, Arial, sans-serif',
    flowchart: {
      htmlLabels: false,
      useMaxWidth: false,
    },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    pie: { useMaxWidth: false },
  });
  lastOfficialMermaidThemeMode = themeMode;
  return mermaid;
}

function buildBeautifulMermaidColors(themeMode: "light" | "dark") {
  const colors = getBeautifulMermaidThemeColors(themeMode);
  const mix = (pct: number) => mixSrgbHex(colors.fg, colors.bg, pct);
  return {
    ...colors,
    surface: colors.surface ?? mix(BEAUTIFUL_MERMAID_MIX.nodeFill),
    border: colors.border ?? mix(BEAUTIFUL_MERMAID_MIX.nodeStroke),
  };
}

function getBeautifulMermaidRenderOptions(
  themeMode: "light" | "dark",
): RenderOptions {
  return {
    ...buildBeautifulMermaidColors(themeMode),
    transparent: true,
  };
}

function renderBeautifulMermaidSvg(
  definition: string,
  themeMode: "light" | "dark",
): string {
  const colors = buildBeautifulMermaidColors(themeMode);
  const svgMarkup = renderMermaidSVG(
    definition,
    getBeautifulMermaidRenderOptions(themeMode),
  );
  return prepareBeautifulMermaidSvg(svgMarkup, colors);
}

export type RenderMermaidDiagramsOptions = {
  themeMode?: "light" | "dark";
};

export type KatexRenderMode = "mathml";

/**
 * Initialize KaTeX for inline and display math
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function initKaTeX(md: any) {
  // Inline math: $...$
  md.inline.ruler.after(
    "text",
    "katex_inline_math",
    (state: any, silent: boolean) => {
      const start = state.pos;
      if (state.src[start] !== "$") return false;

      // 跳过被转义的 `\$`
      if (start > 0 && state.src[start - 1] === "\\") return false;

      // Check it's not $$ (display math)
      if (state.src[start + 1] === "$") return false;

      // 行内公式不跨行：遇到换行即停止；同时跳过 `\$` 转义，与 Live 端行为一致
      let end = -1;
      let j = start + 1;
      while (j < state.src.length) {
        if (state.src[j] === "\n") break;
        if (state.src[j] === "\\" && j + 1 < state.src.length) {
          j += 2;
          continue;
        }
        if (state.src[j] === "$") {
          end = j;
          break;
        }
        j += 1;
      }
      if (end === -1 || end === start + 1) return false;

      const content = state.src.slice(start + 1, end);

      if (!silent) {
        try {
          const rendered = renderKatexCached(content, false);
          const token = state.push("html_inline", "", 0);
          token.content = rendered;
        } catch {
          const token = state.push("text", "", 0);
          token.content = `$${content}$`;
        }
      }

      state.pos = end + 1;
      return true;
    },
  );

  // Display math: $$...$$
  md.block.ruler.after(
    "blockquote",
    "katex_display_math",
    (state: any, start: number, _end: number) => {
      const pos = state.bMarks[start] + state.tShift[start];
      const max = state.eMarks[start];

      if (pos + 2 > max) return false;
      if (state.src.slice(pos, pos + 2) !== "$$") return false;

      const contentStart = pos + 2;
      let contentEnd = state.src.indexOf("$$", contentStart);

      // Find the closing $$
      if (contentEnd === -1) {
        // Search across multiple lines (start from the line after the opening $$)
        let currentLine = start + 1;

        while (currentLine < state.lineMax) {
          const lineStart = state.bMarks[currentLine];
          const lineEnd = state.eMarks[currentLine];
          const lineContent = state.src.slice(lineStart, lineEnd);

          const closingIdx = lineContent.indexOf("$$");
          if (closingIdx !== -1) {
            contentEnd = lineStart + closingIdx;
            break;
          }

          currentLine++;
        }

        if (contentEnd === -1) return false;
      }

      const content = state.src.slice(contentStart, contentEnd).trim();

      // Line index of the closing `$$` (must advance state.line past entire block;
      // otherwise following lines are re-parsed as paragraphs / broken escapes, and
      // later fenced blocks e.g. ```mermaid fail to tokenize).
      let endLine = start;
      for (let i = start; i < state.lineMax; i++) {
        if (contentEnd >= state.bMarks[i] && contentEnd < state.eMarks[i]) {
          endLine = i;
          break;
        }
      }

      const token = state.push("katex_display", "", 0);
      token.content = content;
      token.map = [start, endLine + 1];

      state.line = endLine + 1;
      return true;
    },
  );

  // Render function for display math
  md.renderer.rules.katex_display = (tokens: any[], idx: number) => {
    const content = tokens[idx].content;
    try {
      return `<div class="katex-display">${renderKatexCached(content, true)}</div>`;
    } catch {
      return `<div class="katex-error">Failed to render: ${escapeHtml(content)}</div>`;
    }
  };
}

/**
 * Initialize Mermaid for diagrams
 */
export function initMermaid(md: any) {
  // Override fence rule to handle mermaid diagrams
  const defaultFence = md.renderer.rules.fence;

  md.renderer.rules.fence = (
    tokens: any[],
    idx: number,
    options: any,
    env: any,
    self: any,
  ) => {
    const token = tokens[idx];
    const fenceLang = (token.info.trim().split(/\s+/)[0] || "").toLowerCase();

    // Check if it's a mermaid diagram
    if (fenceLang === "mermaid" || fenceLang === "mmd") {
      const code = token.content.trim();
      // Omit a random id: it makes the HTML unstable and causes React to replace the DOM
      // on every markdown render, destroying already-rendered Mermaid SVGs and forcing a
      // re-render that can fail when the container is temporarily invisible.
      return `<div class="mermaid">${code}</div>`;
    }

    return defaultFence(tokens, idx, options, env, self);
  };
}

export function getMermaidDefinition(el: HTMLElement): string {
  if (el.dataset.mermaidSource) {
    return el.dataset.mermaidSource;
  }
  return (el.textContent || "").trim();
}

export function parseSvgLength(value: string | null): number | null {
  if (!value?.trim()) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseSvgViewBoxSize(
  value: string | null,
): { width: number; height: number } | null {
  if (!value?.trim()) return null;

  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));
  if (parts.length < 4) return null;

  const width = parts[2];
  const height = parts[3];
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

export function removeSvgLengthAttribute(
  svg: SVGSVGElement,
  name: "width" | "height",
): void {
  const value = svg.getAttribute(name);
  if (value === null) return;

  if (!value.trim()) {
    svg.setAttribute(name, "1");
  }
  svg.removeAttribute(name);
}

export function getRootMermaidSvg(el: HTMLElement): SVGSVGElement | null {
  const firstChild = el.firstElementChild;
  const svg =
    firstChild?.tagName.toLowerCase() === "svg"
      ? firstChild
      : el.querySelector("svg");
  return svg?.tagName.toLowerCase() === "svg" ? (svg as SVGSVGElement) : null;
}

export function normalizeMermaidSvg(el: HTMLElement): void {
  const svg = getRootMermaidSvg(el);
  if (!svg) return;

  const viewBoxSize = parseSvgViewBoxSize(svg.getAttribute("viewBox"));
  const naturalWidth =
    viewBoxSize?.width ?? parseSvgLength(svg.getAttribute("width"));
  const naturalHeight =
    viewBoxSize?.height ?? parseSvgLength(svg.getAttribute("height"));

  removeSvgLengthAttribute(svg, "width");
  removeSvgLengthAttribute(svg, "height");
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");

  // Keep the diagram's natural pixel size. `min(100%, …)` scaled wide
  // `flowchart LR` graphs into a thin unreadable strip. The mermaid card
  // already scrolls horizontally when the SVG is wider than the column.
  if (naturalWidth && naturalHeight) {
    svg.style.width = `${naturalWidth}px`;
    svg.style.height = "auto";
    svg.style.maxWidth = "none";
    svg.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`;
  } else {
    svg.style.removeProperty("width");
    svg.style.height = "auto";
    svg.style.maxWidth = "none";
    svg.style.removeProperty("aspect-ratio");
  }
}

/**
 * Strip SVG / error UI from `.mermaid` nodes so the next `renderMermaidDiagrams` pass re-parses
 * from source (used when the preview column was width‑0 and diagrams must not be treated as done).
 */
export function resetMermaidPlaceholders(container: HTMLElement): void {
  for (const node of container.querySelectorAll(".mermaid")) {
    const el = node as HTMLElement;
    const src = (el.dataset.mermaidSource || el.textContent || "").trim();
    if (!src) continue;
    el.replaceChildren(document.createTextNode(src));
    el.removeAttribute("data-processed");
    delete el.dataset.mermaidRendered;
    delete el.dataset.mermaidTheme;
    delete el.dataset.mermaidSource;
    delete el.dataset.mermaidEngine;
    removeOfficialMermaidHoistedStyle(el);
  }
}

function removeOfficialMermaidHoistedStyle(el: HTMLElement): void {
  const styleId = el.dataset.mermaidStyleId;
  const doc = el.ownerDocument;
  if (!styleId || !doc) return;
  doc.getElementById(styleId)?.remove();
  delete el.dataset.mermaidStyleId;
}

function hoistOfficialMermaidSvgStyle(el: HTMLElement): void {
  const doc = el.ownerDocument;
  if (!doc) return;

  const svg = getRootMermaidSvg(el);
  if (!svg) return;

  const styleNodes = Array.from(svg.children).filter(
    (child) => child.tagName.toLowerCase() === "style",
  );
  if (styleNodes.length === 0) return;

  const cssText = styleNodes
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  if (!cssText) return;

  removeOfficialMermaidHoistedStyle(el);

  const styleId = `mermaid-hoisted-style-${(officialMermaidStyleCounter += 1)}`;
  const styleEl = doc.createElement("style");
  styleEl.id = styleId;
  styleEl.textContent = cssText;
  doc.head.appendChild(styleEl);
  el.dataset.mermaidStyleId = styleId;
}

function markMermaidRenderError(
  el: HTMLElement,
  definition: string,
  themeMode: "light" | "dark",
  engine: MermaidRendererKind,
): void {
  el.dataset.mermaidSource = definition;
  el.dataset.mermaidTheme = themeMode;
  el.dataset.mermaidEngine = engine;
  el.dataset.mermaidRendered = "error";
  const errorDiv = document.createElement("div");
  errorDiv.className = "mermaid-error";
  errorDiv.textContent = "Failed to render diagram";
  el.replaceChildren(errorDiv);
}

function markMermaidRenderSuccess(
  el: HTMLElement,
  definition: string,
  themeMode: "light" | "dark",
  engine: MermaidRendererKind,
): void {
  el.dataset.mermaidSource = definition;
  el.dataset.mermaidTheme = themeMode;
  el.dataset.mermaidEngine = engine;
  normalizeMermaidSvg(el);
  el.dataset.mermaidRendered = "true";
}

async function renderBeautifulMermaidDiagram(
  el: HTMLElement,
  definition: string,
  themeMode: "light" | "dark",
): Promise<void> {
  try {
    const svgMarkup = renderBeautifulMermaidSvg(definition, themeMode);
    el.innerHTML = svgMarkup;

    if (el.querySelector("svg")) {
      markMermaidRenderSuccess(el, definition, themeMode, "beautiful");
    } else {
      markMermaidRenderError(el, definition, themeMode, "beautiful");
    }
  } catch (error) {
    console.error("Mermaid render failed:", error);
    markMermaidRenderError(el, definition, themeMode, "beautiful");
  }
}

async function renderOfficialMermaidDiagrams(
  elements: HTMLElement[],
  themeMode: "light" | "dark",
): Promise<void> {
  if (elements.length === 0) return;

  const mermaid = await ensureOfficialMermaidConfigured(themeMode);
  const sourceByEl = new Map<HTMLElement, string>();

  for (const el of elements) {
    const definition = getMermaidDefinition(el);
    sourceByEl.set(el, definition);
    el.removeAttribute("data-processed");
    el.textContent = definition;
  }

  const renderBatchSize = 20;
  for (let start = 0; start < elements.length; start += renderBatchSize) {
    const batch = elements.slice(start, start + renderBatchSize);
    try {
      await mermaid.run({
        nodes: batch,
        suppressErrors: true,
      });
    } catch (error) {
      console.error("Official Mermaid run failed:", error);
    }
  }

  for (const el of elements) {
    const definition = sourceByEl.get(el) ?? "";

    if (el.querySelector("svg")) {
      hoistOfficialMermaidSvgStyle(el);
      markMermaidRenderSuccess(el, definition, themeMode, "official");
    } else {
      removeOfficialMermaidHoistedStyle(el);
      markMermaidRenderError(el, definition, themeMode, "official");
    }
  }
}

/**
 * Render all Mermaid diagrams in the container.
 * Supported types use beautiful-mermaid; others fall back to official Mermaid.
 */
export async function renderMermaidDiagrams(
  container?: HTMLElement | null,
  options?: RenderMermaidDiagramsOptions,
) {
  if (typeof window === "undefined") return;

  const themeMode = options?.themeMode ?? "light";

  const nodeList = container
    ? container.querySelectorAll(".mermaid")
    : document.querySelectorAll(".mermaid");

  if (nodeList.length === 0) return;

  const pendingBeautiful: HTMLElement[] = [];
  const pendingOfficial: HTMLElement[] = [];

  for (const el of Array.from(nodeList) as HTMLElement[]) {
    const def = getMermaidDefinition(el);
    if (!def && !el.querySelector("svg")) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 4) {
      el.dataset.mermaidPendingWidth = "true";
      continue;
    }
    delete el.dataset.mermaidPendingWidth;

    const rendererKind = getMermaidRendererKind(def);
    const sameConfig =
      el.dataset.mermaidSource === def &&
      (el.dataset.mermaidTheme ?? "") === themeMode &&
      (el.dataset.mermaidEngine ?? rendererKind) === rendererKind;
    // A failed diagram ("error") with unchanged source/theme/engine is settled
    // too: re-rendering it would fail again, mutate the DOM again, and retrigger
    // the mutation-observer heal pass — an infinite render loop that can freeze
    // the preview. It re-renders once its source, theme, or engine changes.
    const stable =
      sameConfig &&
      (el.dataset.mermaidRendered === "true"
        ? Boolean(el.querySelector("svg"))
        : el.dataset.mermaidRendered === "error");
    if (stable) {
      continue;
    }

    if (rendererKind === "official") {
      pendingOfficial.push(el);
    } else {
      pendingBeautiful.push(el);
    }
  }

  if (pendingBeautiful.length === 0 && pendingOfficial.length === 0) {
    return;
  }

  if (pendingBeautiful.length > 0) {
    await loadBeautifulMermaidModule();
    for (const el of pendingBeautiful) {
      const definition = getMermaidDefinition(el);
      if (!definition) continue;
      await renderBeautifulMermaidDiagram(el, definition, themeMode);
    }
  }

  await renderOfficialMermaidDiagrams(pendingOfficial, themeMode);
}

/**
 * Remove legacy global KaTeX overrides. Dark math colors come from `preview.css` (`.dark .katex`)
 * so they track `html.dark` and never fight `settings.themeMode` (child effects can run before
 * parent `useEffect` that used to toggle the class).
 */
export function applyKatexDarkTheme(): void {
  if (typeof document === "undefined") return;
  document.getElementById("katex-dark-theme")?.remove();

  const renderMode = getKatexRenderMode();
  if (renderMode) {
    document.documentElement.setAttribute("data-katex-render-mode", renderMode);
  } else {
    document.documentElement.removeAttribute("data-katex-render-mode");
  }
}

export function getKatexRenderMode(
  options: {
    isTauri?: boolean;
    protocol?: string;
  } = {},
): KatexRenderMode | null {
  const isTauri = options.isTauri ?? isTauriEnvironment();
  const protocol =
    options.protocol ??
    (typeof window !== "undefined" ? window.location.protocol : "");

  const shouldUseMathMlFallback =
    isTauri ||
    protocol === "tauri:" ||
    protocol === "asset:" ||
    protocol === "app:";

  return shouldUseMathMlFallback ? "mathml" : null;
}
