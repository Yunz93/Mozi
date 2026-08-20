import katexCss from "katex/dist/katex.min.css?inline";
import githubMarkdownCss from "github-markdown-css/github-markdown.css?inline";
import { escapeHtml } from "./core";
import { flattenHeadingNodes, parseHeadings } from "../outline";
import { PREVIEW_PANEL_WIDTH_PX } from "./types";
import { getPaneLayoutMetrics } from "../../components/editor/paneLayout";
import {
  buildDynamicFontFaceCss,
  type FontSettings,
  getBundledPresetDataUrlOverrides,
} from "../fontSettings";
import {
  getMarkdownStyleCssVariables,
  getMarkdownStyleTokens,
  normalizeMarkdownStylePreset,
} from "../markdownStyle";
import type { MarkdownStylePreset } from "../../types";

export async function buildExportFontFaceCss(
  fontSettings?: FontSettings,
): Promise<string> {
  if (!fontSettings) {
    return "";
  }

  const overrides = await getBundledPresetDataUrlOverrides(fontSettings);
  return buildDynamicFontFaceCss(fontSettings, overrides);
}

export function renderProperties(
  frontmatter: Record<string, unknown> | null,
): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return "";

  const rows = Object.entries(frontmatter)
    .map(([key, value]) => {
      const formattedValue = Array.isArray(value)
        ? value.join(", ")
        : String(value ?? "");
      return `
        <div class="export-properties-row">
          <div class="export-properties-key">${escapeHtml(key)}</div>
          <div class="export-properties-value">${escapeHtml(formattedValue)}</div>
        </div>
      `;
    })
    .join("");

  return `
    <section class="export-properties">
      <div class="export-properties-header">Properties</div>
      <div class="export-properties-table">${rows}</div>
    </section>
  `;
}

/** Parse `--name: value;` declarations from a CSS text fragment into `into`. */
function collectCssCustomProperties(
  cssFragment: string,
  into: Record<string, string>,
): void {
  const declRegex = /(--[\w-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = declRegex.exec(cssFragment)) !== null) {
    into[match[1]] = match[2].trim();
  }
}

/**
 * github-markdown-css scopes its theme tokens (--fgColor-*, --bgColor-*, …) to
 * `@media (prefers-color-scheme: …)` blocks. The export raster host renders in
 * the app WebView whose OS scheme may not match the export theme, and
 * html2canvas cannot resolve CSS custom properties at all. Extract the base
 * tokens plus the block matching `theme` so they can be baked into the CSS.
 *
 * Exported for testing.
 */
export function extractGithubMarkdownThemeVars(
  css: string,
  theme: "light" | "dark",
): Record<string, string> {
  const vars: Record<string, string> = {};
  const mediaRegex = /@media\s*\(prefers-color-scheme:\s*(dark|light)\)\s*\{/g;
  const themedBlocks: Array<{ scheme: string; body: string }> = [];
  let outsideMedia = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = mediaRegex.exec(css)) !== null) {
    const bodyStart = mediaRegex.lastIndex;
    let depth = 1;
    let i = bodyStart;
    while (i < css.length && depth > 0) {
      const ch = css[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    themedBlocks.push({ scheme: match[1], body: css.slice(bodyStart, i - 1) });
    outsideMedia += css.slice(cursor, match.index);
    cursor = i;
    mediaRegex.lastIndex = i;
  }
  outsideMedia += css.slice(cursor);

  collectCssCustomProperties(outsideMedia, vars);
  for (const block of themedBlocks) {
    if (block.scheme === theme) {
      collectCssCustomProperties(block.body, vars);
    }
  }
  return vars;
}

export function buildExportStyles(
  theme: "light" | "dark",
  fontFamily?: string,
  fontSize?: number,
  fontFaceCss = "",
  codeFontFamily?: string,
  codeFontSize?: number,
  markdownStylePreset: MarkdownStylePreset = "nord",
): string {
  const resolvedFontFamily =
    fontFamily ||
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
  const resolvedFontSize = fontSize ?? 16;
  const resolvedCodeFontFamily =
    codeFontFamily ||
    '"SFMono-Regular", "JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
  const resolvedCodeFontSize =
    codeFontSize ?? Math.max(12, resolvedFontSize - 1);
  const previewLayout = getPaneLayoutMetrics(
    PREVIEW_PANEL_WIDTH_PX,
    "comfortable",
  );
  const documentPadding = `${previewLayout.contentPaddingTop}px ${previewLayout.contentPaddingX}px ${previewLayout.contentPaddingBottom}px`;
  const normalizedStylePreset =
    normalizeMarkdownStylePreset(markdownStylePreset);
  const tokens = getMarkdownStyleTokens(normalizedStylePreset, theme);
  const attachmentImageShadow =
    theme === "dark"
      ? "0 20px 44px rgba(0, 0, 0, 0.3)"
      : `0 16px 40px ${tokens.accentSoft}`;
  const markdownStyleCssVariables = Object.entries(
    getMarkdownStyleCssVariables(normalizedStylePreset, theme),
  )
    .map(([name, value]) => `      ${name}: ${value};`)
    .join("\n");

  // Build a complete var() → value map for html2canvas compatibility.
  // html2canvas does not resolve CSS custom properties, so every var(--mp-doc-*)
  // would render as an invalid value and fall back to initial/inherit.
  const cssVarValues: Record<string, string> = {
    "--bg-primary": theme === "dark" ? "#0d1117" : "#ffffff",
    "--bg-secondary": theme === "dark" ? "#161b22" : "#f6f8fa",
    "--text-primary": tokens.text,
    "--text-secondary": tokens.muted,
    "--border-color": tokens.border,
    "--accent-color": tokens.accent,
    "--code-bg": tokens.codeBg,
  };
  // github-markdown-css scopes its theme variables (--fgColor-*, --borderColor-*, …)
  // to `prefers-color-scheme` media queries. html2canvas cannot resolve them, and the
  // OS scheme may not match the export theme, so bake the chosen theme's definitions
  // into the map so every github var() reference resolves to a concrete value.
  Object.assign(
    cssVarValues,
    extractGithubMarkdownThemeVars(githubMarkdownCss, theme),
  );
  Object.entries(
    getMarkdownStyleCssVariables(normalizedStylePreset, theme),
  ).forEach(([name, value]) => {
    cssVarValues[name] = value;
  });

  const exportDelStrikeBlock = `    .export-document .markdown-body del,
    .export-document .markdown-body s {
      color: var(--mp-doc-del);
      text-decoration: line-through;
    }
`;

  const rawCss = `
    ${fontFaceCss}
    ${githubMarkdownCss}
    ${katexCss}

    :root {
      --bg-primary: ${theme === "dark" ? "#0d1117" : "#ffffff"};
      --bg-secondary: ${theme === "dark" ? "#161b22" : "#f6f8fa"};
      --text-primary: ${tokens.text};
      --text-secondary: ${tokens.muted};
      --border-color: ${tokens.border};
      --accent-color: ${tokens.accent};
      --code-bg: ${tokens.codeBg};
${markdownStyleCssVariables}
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      background-color: var(--bg-primary);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .export-stage {
      min-height: 100vh;
      background: ${theme === "dark" ? "rgba(0, 0, 0, 0.5)" : "rgba(249, 250, 251, 0.6)"};
      padding: 0;
    }

    .export-document {
      font-family: ${resolvedFontFamily};
      font-size: ${resolvedFontSize}px;
      line-height: 1.95;
      background-color: transparent;
      color: var(--text-primary);
      /* Same comfortable-medium preview sheet: padding lives on the article
         (preview-pane-document) so the column width matches Reading mode. */
      padding: 0;
      max-width: ${previewLayout.sheetMaxWidth}px;
      margin: 0 auto;
      --pane-content-top: ${previewLayout.contentPaddingTop}px;
      --pane-content-px: ${previewLayout.contentPaddingX}px;
      --pane-content-bottom: ${previewLayout.contentPaddingBottom}px;
      --preview-font-family: ${resolvedFontFamily};
      --preview-font-size: ${resolvedFontSize}px;
      --preview-code-font-family: ${resolvedCodeFontFamily};
      --preview-code-font-size: ${resolvedCodeFontSize}px;
      --preview-line-height: 1.95;
${markdownStyleCssVariables}
    }

    .export-document .markdown-body {
      box-sizing: border-box;
      min-width: 200px;
      max-width: none;
      margin: 0;
      /* Concrete padding for html2canvas (it cannot resolve preview.css vars). */
      padding: ${documentPadding};
      background: transparent !important;
      color: var(--text-primary);
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit;
      overflow-wrap: anywhere;
      word-break: break-word;
      letter-spacing: 0.01em;
    }

    /* Match preview.css paragraph rhythm (preview-pane-document rules). */
    .export-document .markdown-body p {
      margin-top: 0;
      margin-bottom: 1em;
    }

    .export-document .markdown-body p:last-child {
      margin-bottom: 0;
    }

    .export-document .markdown-body p:has(+ ul),
    .export-document .markdown-body p:has(+ ol) {
      margin-bottom: 0;
    }

    .export-document .markdown-body p + ul,
    .export-document .markdown-body p + ol {
      margin-top: 0;
    }

    /* Source blank lines: renderMarkdown emits .preview-source-blank-line divs;
       preview.css gives them one line-height of space. Without this rule the
       export collapses them to 0px and the shared image loses all blank-line
       spacing the preview shows. */
    .export-document .markdown-body .preview-source-blank-line {
      display: block;
      height: 1.95em;
      margin: 0;
      pointer-events: none;
    }

    .export-document .markdown-body > :has(+ .preview-source-blank-line) {
      margin-bottom: 0;
    }

    .export-document .markdown-body .preview-source-blank-line + * {
      margin-top: 0;
    }

    .export-document[data-theme="light"] .markdown-body {
      color: var(--mp-doc-text) !important;
      --fgColor-default: var(--mp-doc-text) !important;
      --fgColor-muted: var(--mp-doc-muted) !important;
      --bgColor-default: transparent !important;
    }

    .export-document[data-theme="dark"] .markdown-body {
      color: var(--mp-doc-text);
      --fgColor-default: var(--mp-doc-text);
      --fgColor-muted: var(--mp-doc-muted);
      --bgColor-default: transparent;
    }

    .export-document .markdown-body,
    .export-document .markdown-body h1,
    .export-document .markdown-body h2,
    .export-document .markdown-body h3,
    .export-document .markdown-body h4,
    .export-document .markdown-body h5,
    .export-document .markdown-body h6,
    .export-document .markdown-body p,
    .export-document .markdown-body li,
    .export-document .markdown-body td,
    .export-document .markdown-body th,
    .export-document .markdown-body blockquote {
      color: var(--text-primary);
    }

    .export-document .markdown-body .katex,
    .export-document .markdown-body .katex * {
      word-break: normal !important;
      overflow-wrap: normal !important;
    }

    .export-document .markdown-body .katex {
      line-height: 1.2 !important;
      text-indent: 0;
    }

    .export-document .markdown-body .katex-display > .katex {
      white-space: nowrap;
    }

    html[data-katex-render-mode="mathml"] .export-document .katex .katex-html {
      display: none !important;
    }

    html[data-katex-render-mode="mathml"] .export-document .katex .katex-mathml {
      position: static !important;
      clip: auto !important;
      clip-path: none !important;
      width: auto !important;
      height: auto !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: visible !important;
      border: 0 !important;
      white-space: normal !important;
    }

    html[data-katex-render-mode="mathml"] .export-document .katex math {
      color: inherit;
    }

    html[data-katex-render-mode="mathml"] .export-document .katex-display > .katex .katex-mathml {
      display: block;
      text-align: center;
    }

    .export-document .markdown-body h1,
    .export-document .markdown-body h2,
    .export-document .markdown-body h3,
    .export-document .markdown-body h4,
    .export-document .markdown-body h5,
    .export-document .markdown-body h6 {
      color: var(--mp-doc-accent);
      letter-spacing: 0.01em;
      background: var(--mp-doc-heading-bg);
      border-color: var(--mp-doc-heading-border);
      font-weight: var(--mp-doc-heading-weight);
    }

    /* 与 preview.css 标题阶梯一致，覆盖 github-markdown 默认字号 */
    .export-document .markdown-body h1 {
      color: var(--mp-doc-heading-1);
      font-size: 1.6em;
      border-bottom: none;
      padding-bottom: 0;
    }
    .export-document .markdown-body h2 {
      color: var(--mp-doc-heading-2);
      border-bottom: none;
      padding-bottom: 0;
      font-size: 1.35em;
    }
    .export-document .markdown-body h3 {
      color: var(--mp-doc-heading-3);
      font-size: 1.2em;
    }
    .export-document .markdown-body h4 {
      color: var(--mp-doc-heading-4);
      font-size: 1.05em;
    }
    .export-document .markdown-body h5 {
      color: var(--mp-doc-heading-5);
      font-size: 0.95em;
    }
    .export-document .markdown-body h6 {
      color: var(--mp-doc-heading-6);
      font-size: 0.9em;
    }

    .export-document .markdown-body ul,
    .export-document .markdown-body ol {
      margin: 0.5rem 0;
      padding-left: 2rem;
    }

    /* html2canvas 对 outside marker + li>p 的垂直对齐不可靠；raster 前会加 mp-export-raster-list */
    .export-document .markdown-body ul.mp-export-raster-list,
    .export-document .markdown-body ol.mp-export-raster-list {
      list-style-position: inside;
      padding-left: 0.35rem;
    }

    .export-document .markdown-body ul.mp-export-raster-list ul,
    .export-document .markdown-body ul.mp-export-raster-list ol,
    .export-document .markdown-body ol.mp-export-raster-list ul,
    .export-document .markdown-body ol.mp-export-raster-list ol {
      padding-left: 1.35rem;
    }

    .export-document .markdown-body li > ul,
    .export-document .markdown-body li > ol {
      margin-top: 0.25rem;
      margin-bottom: 0.25rem;
      margin-left: 0.35rem;
      /* 与 preview.css 一致，避免 border-left 与有序列表序号重叠 */
      padding-left: 2rem;
      border-left: 1px solid var(--mp-doc-border);
    }

    .export-document .markdown-body ul {
      list-style: disc;
    }

    .export-document .markdown-body ul ul,
    .export-document .markdown-body ul ul ul {
      list-style: disc;
    }

    .export-document .markdown-body ol {
      list-style: decimal;
    }

    .export-document .markdown-body ol ol,
    .export-document .markdown-body ol ol ol {
      list-style: decimal;
    }

    /* Match preview.css: github-markdown uses ~16px margin-top on li>p, which pushes
       the first line down; html2canvas paints list markers at the li top without that
       offset, so bullets look vertically misaligned in PNG/PDF export. */
    .export-document .markdown-body li > p {
      margin-top: 0.15em;
      margin-bottom: 0.15em;
    }

    .export-document .markdown-body .mp-export-raster-list li > p:first-child {
      display: inline;
      margin: 0 !important;
    }

    .export-document .markdown-body .mp-export-raster-list li > p + p {
      display: block;
      margin-top: 0.15em;
    }

    .export-document .markdown-body .task-list-item {
      position: relative;
      list-style: none;
      min-width: 0;
      padding-left: 0.34rem;
    }

    .export-document .markdown-body .task-list-item::marker {
      content: '';
    }

    .export-document .markdown-body .task-list-item + .task-list-item {
      margin-top: 0.45rem;
    }

    .export-document .markdown-body .task-list-item > p {
      margin: 0;
    }

    .export-document .markdown-body .task-list-item-checkbox {
      appearance: none;
      -webkit-appearance: none;
      position: absolute;
      top: calc((1.95em - 1em) / 2);
      left: -1.18rem;
      width: 1em;
      height: 1em;
      margin: 0;
      border: 1.5px solid var(--mp-doc-task-border, #94a3b8);
      border-radius: 0.28rem;
      background: #ffffff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
    }

    .export-document .markdown-body .task-list-item-checkbox:checked {
      border-color: var(--mp-doc-task-checked, var(--mp-doc-accent));
      background-color: var(--mp-doc-task-checked, var(--mp-doc-accent));
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='white' d='M6.4 11.2 3.6 8.4l-1.1 1.1 3.9 3.9 7.1-7.1-1.1-1.1z'/%3E%3C/svg%3E");
      background-position: center;
      background-repeat: no-repeat;
      background-size: 0.82em 0.82em;
    }

    .export-document[data-theme="dark"] .markdown-body .task-list-item-checkbox {
      border-color: var(--mp-doc-task-border, rgba(148, 163, 184, 0.68));
      background: rgba(15, 23, 42, 0.88);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .export-document[data-theme="dark"] .markdown-body .task-list-item-checkbox:checked {
      border-color: var(--mp-doc-task-checked, var(--mp-doc-accent));
      background-color: var(--mp-doc-task-checked, var(--mp-doc-accent));
    }

    .export-document .markdown-body .footnotes {
      border-top: none;
    }

    .export-document .markdown-body a {
      color: var(--mp-doc-link);
      text-decoration-thickness: 1.5px;
      text-underline-offset: 0.12em;
    }

    .export-document .markdown-body a:hover {
      color: var(--mp-doc-link-hover);
    }

    .export-document .markdown-body .internal-link,
    .export-document .markdown-body .wiki-link {
      color: var(--mp-doc-link);
    }

    .export-document .markdown-body .internal-link.is-unresolved,
    .export-document .markdown-body .wiki-link.is-unresolved {
      color: var(--mp-doc-link-unresolved);
    }

    .export-document .markdown-body .external-link {
      color: var(--mp-doc-link-external);
    }

    .export-document .markdown-body strong {
      color: var(--mp-doc-strong);
    }

    .export-document .markdown-body em {
      color: var(--mp-doc-em);
    }

    .export-document .markdown-body strong em,
    .export-document .markdown-body em strong {
      color: var(--mp-doc-strong-em);
    }

${exportDelStrikeBlock}

    .export-document .markdown-body ins,
    .export-document .markdown-body u {
      text-decoration: none;
      background-image: linear-gradient(currentColor, currentColor);
      background-repeat: no-repeat;
      background-position: 0 88%;
      background-size: 100% 0.06em;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }

    .export-document .markdown-body mark {
      color: var(--mp-doc-mark-text);
      background: var(--mp-doc-mark-bg);
    }

    .export-document .markdown-body a.tag,
    .export-document .markdown-body .tag {
      color: var(--mp-doc-tag-text);
      background: var(--mp-doc-tag-bg);
      border: 1px solid var(--mp-doc-tag-border);
      border-radius: 0.45rem;
      padding: 0.08rem 0.36rem;
      text-decoration: none;
    }

    .export-document .markdown-body blockquote {
      border-left-color: var(--mp-doc-accent);
      color: var(--mp-doc-quote-text);
      background: var(--mp-doc-quote-bg);
      border-radius: 0 14px 14px 0;
      padding: 0.9rem 1rem;
    }

    .export-document .markdown-body blockquote.mp-callout {
      border-left-width: 4px;
    }

    .export-document .markdown-body .mp-callout-title {
      font-weight: 700;
      text-transform: capitalize;
      margin-bottom: 0.35em;
    }

    .export-document .markdown-body .mp-callout-warning,
    .export-document .markdown-body .mp-callout-caution {
      border-left-color: #d97706;
      background: color-mix(in srgb, #d97706 10%, transparent);
    }

    .export-document .markdown-body .mp-callout-error,
    .export-document .markdown-body .mp-callout-danger,
    .export-document .markdown-body .mp-callout-bug {
      border-left-color: #dc2626;
      background: color-mix(in srgb, #dc2626 10%, transparent);
    }

    .export-document .markdown-body .mp-callout-success,
    .export-document .markdown-body .mp-callout-tip {
      border-left-color: #16a34a;
      background: color-mix(in srgb, #16a34a 10%, transparent);
    }

    .export-document .markdown-body code {
      color: var(--mp-doc-code-text);
      background: var(--mp-doc-code-bg);
      border-radius: 0.45rem;
      padding: 0.15rem 0.35rem;
      /* 与 preview.css 一致：行内代码不能继承正文 1.95 行高 */
      line-height: 1.35;
      font-family: ${resolvedCodeFontFamily};
      font-size: ${resolvedCodeFontSize}px;
    }

    /* raster 前会把行内 code 拆成 chunk，避免 html2canvas 把背景画成整行宽矩形 */
    .export-document .markdown-body code.mp-export-raster-code {
      background: transparent !important;
      padding: 0 !important;
      border-radius: 0;
    }

    .export-document .markdown-body .mp-export-raster-code-chunk {
      color: var(--mp-doc-code-text);
      background: var(--mp-doc-code-bg);
      border-radius: 0.45rem;
      padding: 0.15rem 0.35rem;
      font-family: ${resolvedCodeFontFamily};
      font-size: ${resolvedCodeFontSize}px;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }

    .export-document .markdown-body pre {
      background: var(--mp-doc-code-bg);
      color: var(--mp-doc-code-text);
      /* Match preview rhythm: one blank line ≈ 1 line-height (1.95). */
      margin: 1.95em 0;
      border: 1px solid var(--mp-doc-code-border);
      border-radius: 1rem;
      padding: 0;
      overflow: hidden;
      max-width: 100%;
      box-shadow: ${
        theme === "dark"
          ? "inset 0 1px 0 rgba(255, 255, 255, 0.03)"
          : "inset 0 1px 0 rgba(255, 255, 255, 0.55)"
      };
    }

    .export-document .markdown-body pre:not(.shiki) code {
      display: block;
      padding: 1rem 1.1rem;
      background: transparent;
      border-radius: 0;
      overflow-x: auto;
      white-space: pre;
    }

    .export-document .markdown-body .mp-shiki-block {
      margin: 1.95em 0;
      border: 1px solid var(--mp-doc-code-border);
      border-radius: 1rem;
      overflow: hidden;
      /* Shiki's inline background is neutralised below for html2canvas rounded
         corners; the wrapper must supply the fill or fences render on the page
         background instead of the code background shown in the preview. */
      background: var(--mp-doc-code-bg);
      box-shadow: ${
        theme === "dark"
          ? "inset 0 1px 0 rgba(255, 255, 255, 0.03)"
          : "inset 0 1px 0 rgba(255, 255, 255, 0.55)"
      };
    }

    .export-document .markdown-body .mp-shiki-block > pre.shiki {
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      padding: 1rem 1.1rem;
    }

    .export-document .markdown-body pre.shiki,
    .export-document .markdown-body .shiki {
      margin: 0;
      padding: 1rem 1.1rem;
      overflow-x: auto;
      border-radius: 1rem !important;
      -webkit-clip-path: inset(0 round 1rem);
      clip-path: inset(0 round 1rem);
      overflow: hidden;
      background: transparent !important;
    }

    .export-document .markdown-body pre.shiki code,
    .export-document .markdown-body .shiki code {
      display: block;
      padding: 0;
      color: inherit;
      background: transparent !important;
      white-space: normal;
      overflow-x: auto;
    }

    .export-document .markdown-body pre.shiki .line,
    .export-document .markdown-body .shiki .line {
      display: block;
      white-space: pre;
      padding-top: 0.08rem;
      padding-bottom: 0.08rem;
    }

    .export-document .markdown-body pre,
    .export-document .markdown-body pre:not(.shiki) code,
    .export-document .markdown-body pre.shiki,
    .export-document .markdown-body pre.shiki code,
    .export-document .markdown-body pre.shiki .line {
      line-height: 1.75;
    }

    .export-document .markdown-body table {
      display: table;
      width: 100%;
      max-width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      color: var(--mp-doc-text);
    }

    .export-document .markdown-body table th,
    .export-document .markdown-body table td {
      border: 1px solid var(--mp-doc-border);
      color: inherit;
      text-align: left;
      min-width: 0;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .export-document .markdown-body table tr {
      background-color: ${theme === "dark" ? "rgba(15, 23, 42, 0.72)" : "rgba(255, 255, 255, 0.92)"};
      border-top: 1px solid var(--mp-doc-border);
    }

    .export-document .markdown-body table tr:nth-child(2n) {
      background-color: var(--mp-doc-table-row-alt-bg);
    }

    .export-document .markdown-body table tr:hover {
      background-color: var(--mp-doc-table-hover-bg);
    }

    .export-document .markdown-body table th {
      background-color: var(--mp-doc-table-header-bg);
      color: var(--mp-doc-text);
      font-weight: 600;
    }

    .export-document .markdown-body ul li::marker,
    .export-document .markdown-body ol li::marker {
      color: var(--mp-doc-list-marker);
    }

    .export-document .markdown-body hr {
      background-color: var(--mp-doc-border);
      border-color: var(--mp-doc-border);
    }

    /* Mermaid: mirror preview.css container styling and nested-SVG guards.
       Without these the generic export svg sizing rule reshapes Mermaid's
       nested coordinate systems and diagrams lose the padded card look. */
    .export-document .markdown-body .mermaid {
      display: block;
      padding: 1.5em;
      background: ${theme === "dark" ? "rgba(255, 255, 255, 0.05)" : "rgba(128, 128, 128, 0.05)"};
      border-radius: 8px;
      margin: 1em 0;
      overflow: hidden;
      text-align: center;
    }

    .export-document .markdown-body .mermaid svg {
      max-width: none !important;
    }

    .export-document .markdown-body .mermaid > svg {
      display: block;
      width: auto;
      height: auto;
      max-width: none !important;
      margin: 0 auto;
    }

    .export-document .markdown-body .mermaid svg svg {
      max-width: none !important;
      width: auto !important;
      height: auto !important;
    }

    .export-document .markdown-body .mermaid-error {
      color: #ef4444;
      font-family: monospace;
      padding: 1em;
      background: rgba(239, 68, 68, 0.1);
      border-radius: 4px;
      white-space: pre-wrap;
    }

    .export-properties {
      margin-bottom: 32px;
      border: 1px solid ${theme === "dark" ? "rgba(255,255,255,0.1)" : "#e5e7eb"};
      border-radius: 12px;
      overflow: hidden;
      background: ${theme === "dark" ? "rgba(20, 20, 20, 0.75)" : "rgba(255, 255, 255, 0.75)"};
      box-shadow: ${theme === "dark" ? "none" : "0 8px 24px rgba(15, 23, 42, 0.05)"};
    }

    .export-properties-header {
      padding: 8px 16px;
      border-bottom: 1px solid ${theme === "dark" ? "rgba(255,255,255,0.05)" : "#e5e7eb"};
      background: ${theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(249, 250, 251, 0.7)"};
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${theme === "dark" ? "#9ca3af" : "#6b7280"};
    }

    .export-properties-table {
      display: table;
      width: 100%;
      border-collapse: collapse;
    }

    .export-properties-row {
      display: table-row;
    }

    .export-properties-row:hover {
      background: ${theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"};
    }

    .export-properties-key,
    .export-properties-value {
      display: table-cell;
      padding: 8px 12px;
      vertical-align: top;
      font-size: 14px;
    }

    .export-properties-key {
      width: 160px;
      font-weight: 500;
      color: ${theme === "dark" ? "#9ca3af" : "#6b7280"};
    }

    .export-properties-value {
      color: var(--text-primary);
      word-break: break-word;
      white-space: pre-wrap;
    }

    .export-document .toc {
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1em;
      margin: 1em 0;
    }

    .export-document .toc h2 {
      margin-top: 0;
      font-size: 1.25em;
      border-bottom: none;
    }

    .export-document .toc ul {
      list-style: none;
    }

    .export-document .toc ul ul {
      padding-left: 1.5em;
    }

    .export-document .katex-display {
      overflow-x: auto;
      overflow-y: hidden;
      padding: 0.5em 0;
    }

    .export-document img,
    .export-document svg {
      max-width: 100%;
      height: auto;
    }

    .export-document .markdown-body .preview-attachment-image {
      display: block;
      max-width: 100%;
      margin: 1rem 0;
      border-radius: 1rem;
      box-shadow: ${attachmentImageShadow};
    }

    .export-document .markdown-body .preview-attachment-image:not([width]) {
      width: auto;
    }

    .export-document .markdown-body img.preview-attachment-image[data-wiki-embed-w] {
      width: min(100%, attr(data-wiki-embed-w px, 100%)) !important;
      max-width: min(100%, attr(data-wiki-embed-w px, 100%)) !important;
    }

    .export-document .markdown-body img.preview-attachment-image[data-wiki-embed-h] {
      height: attr(data-wiki-embed-h px, auto) !important;
      max-height: attr(data-wiki-embed-h px, none) !important;
      object-fit: contain;
    }

    @media print {
      @page {
        size: A4 portrait;
        margin: 12mm;
      }

      .export-stage {
        background: transparent;
      }

      .export-document {
        padding: 0;
        max-width: none;
      }

      .export-document pre {
        page-break-inside: avoid;
      }

      .export-document h1, .export-document h2, .export-document h3 {
        page-break-after: avoid;
      }
    }

    @media (max-width: 768px) {
      .export-document {
        padding: 1rem;
      }
    }
  `;

  return resolveCssVarReferences(rawCss, cssVarValues);
}

/**
 * Replace var(--name) references with resolved values so html2canvas
 * (which does not support CSS custom properties) can render them.
 *
 * Uses multiple passes to handle nested var() like
 * {@code var(--mp-doc-task-checked, var(--mp-doc-accent))}.
 */
function resolveCssVarReferences(
  css: string,
  vars: Record<string, string>,
): string {
  let result = css;
  for (let pass = 0; pass < 5; pass += 1) {
    const prev = result;
    // Pass 1: simple var(--name) without fallback
    for (const [name, value] of Object.entries(vars)) {
      result = result.split(`var(${name})`).join(value);
    }
    // Pass 2: var(--name, fallback) — try to resolve name, use fallback if missing
    result = result.replace(
      /var\((--[\w-]+)\s*,\s*([^;{}]+?)\)/g,
      (_full: string, name: string, fallback: string) =>
        vars[name] ?? fallback.trim(),
    );
    if (result === prev) break;
  }
  return result;
}

export function buildExportDocument(
  contentHtml: string,
  toc: string,
  markdownStylePreset: MarkdownStylePreset = "nord",
  theme: "light" | "dark" = "light",
): string {
  return `
    <div class="export-stage">
      <div class="export-document" data-markdown-style="${normalizeMarkdownStylePreset(markdownStylePreset)}" data-theme="${theme}">
        ${toc}
        ${contentHtml}
      </div>
    </div>
  `;
}

export function generateTOC(content: string): string {
  // Reuse the same heading parser/slugger as the preview/outline so that the
  // anchor ids match injectExportHeadingIds() — including CJK headings, which
  // the previous ASCII-only slug regex would collapse to empty.
  const headings = flattenHeadingNodes(parseHeadings(content));

  if (headings.length === 0) return "";

  let toc = '<div class="toc">\n<h2>Table of Contents</h2>\n<ul>\n';
  let lastLevel = headings[0].level;

  for (const heading of headings) {
    const { level, text, id } = heading;

    if (level > lastLevel) {
      toc += "<ul>\n".repeat(level - lastLevel);
    } else if (level < lastLevel) {
      toc += "</li>\n</ul>\n".repeat(lastLevel - level);
    } else {
      toc += "</li>\n";
    }

    toc += `<li><a href="#${id}">${escapeHtml(text)}</a>`;
    lastLevel = level;
  }

  toc += "</li>\n</ul>\n".repeat(lastLevel);
  toc += "</div>\n";

  return toc;
}

/**
 * Inject `id` attributes onto rendered heading elements so that the table of
 * contents anchors resolve. Headings in the rendered HTML appear in the same
 * order as parseHeadings() produces, so we can align them by index (mirrors
 * applyPreviewHeadingAttributes() used in the live preview).
 */
export function injectExportHeadingIds(html: string, content: string): string {
  const headings = flattenHeadingNodes(parseHeadings(content));
  if (headings.length === 0) return html;

  let index = 0;
  return html.replace(
    /<h([1-6])\b([^>]*)>/gi,
    (match, level: string, attrs: string) => {
      const heading = headings[index];
      index += 1;
      if (!heading || /\sid\s*=/.test(attrs)) {
        return match;
      }
      return `<h${level}${attrs} id="${escapeHtml(heading.id)}">`;
    },
  );
}
