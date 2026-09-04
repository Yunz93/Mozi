import DOMPurify from "dompurify";
import { useEffect } from "react";
import MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import {
  initKaTeX,
  initMermaid,
  applyKatexDarkTheme,
} from "./markdown-extensions";
import { normalizeShikiLanguage } from "./shikiLanguages";
import { getMarkdownPressShikiTheme } from "./shikiTheme";
import { parseWikiLinkReference, splitObsidianImageAlt } from "./wikiLinks";
import type { MarkdownStylePreset, OrderedListMode, ThemeMode } from "../types";
import { LRUCache, hashContent } from "./performance";
import {
  FENCE_OPEN_RE,
  normalizeMarkdownTablesForRender,
} from "./markdownTableNormalize";
import {
  parseMarkdownDestination,
  buildMarkdownDestination,
} from "./markdownDestination";
import {
  preprocessAlphaRomanLists,
  applyAlphaRomanListAttrs,
} from "./markdownAlphaRomanList";
import type { ShikiHighlighter } from "../hooks/useShikiHighlighter";
import { normalizeHttpUrlForHtmlAttribute } from "../components/editor/preview/previewMedia";
import { markdownItCallouts } from "./markdownCallouts";

interface MarkdownRenderOptions {
  highlighter?: ShikiHighlighter | null;
  markdownStylePreset?: MarkdownStylePreset;
  themeMode?: ThemeMode;
  preserveSourceBlankLines?: boolean;
  /** When `loose`, preview preserves author numeric markers via `<li value="…">`. */
  orderedListMode?: OrderedListMode;
}

interface MarkdownRenderEnv {
  shikiBlocks?: string[];
  orderedListMode?: OrderedListMode;
}

function wrapShikiBlockHtml(shikiPreHtml: string): string {
  // Wrap Shiki's `<pre class="shiki"...>` so we can reliably apply rounded corners
  // even if the embedded `<pre>` gets overridden by third-party markdown CSS.
  return `<div class="mp-shiki-block">${shikiPreHtml}</div>`;
}

// Create markdown-it instance with configuration
const createMarkdownIt = () => {
  const md = new MarkdownIt({
    html: true, // Allow raw HTML; sanitize rendered output below with DOMPurify
    linkify: true,
    typographer: true,
    breaks: true,
  })
    .use(taskLists)
    // GFM/Obsidian-style [^id] refs and [^id]: definitions (otherwise parsed as reference links).
    .use(footnote)
    .use(markdownItCallouts);

  // 关闭 setext 标题(下划线式 `foo\n---` / `foo\n===`)。
  // 它与列表编辑中间态强冲突:在 `- test` 下一行只敲了一个孤立 `-`、还没写空格和内容时,
  // markdown-it 会按 CommonMark 把上一项渲染成 <h2>,导致预览突然跳成大字标题。
  // 项目只保留 ATX 风格(`# foo`)的标题,符合现代 markdown 风格指南。
  // Live Preview / 源码高亮同样在 createEditorMarkdownLanguage 里 remove SetextHeading。
  md.disable("lheading");

  md.core.ruler.after("inline", "obsidian_block_references", (state) => {
    const nextTokens: Token[] = [];
    let lastRenderableOpenIndex: number | null = null;

    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      const inlineToken = state.tokens[index + 1];
      const closeToken = state.tokens[index + 2];

      const blockReferenceMatch =
        token.type === "paragraph_open" &&
        inlineToken?.type === "inline" &&
        closeToken?.type === "paragraph_close"
          ? inlineToken.content.trim().match(/^\^([A-Za-z0-9_-]+)$/)
          : null;

      if (blockReferenceMatch) {
        if (lastRenderableOpenIndex !== null) {
          nextTokens[lastRenderableOpenIndex]?.attrSet(
            "data-block-id",
            blockReferenceMatch[1],
          );
        }
        index += 2;
        continue;
      }

      const nextIndex = nextTokens.push(token) - 1;
      if (
        token.nesting === 1 &&
        [
          "paragraph_open",
          "heading_open",
          "blockquote_open",
          "list_item_open",
          "table_open",
        ].includes(token.type)
      ) {
        lastRenderableOpenIndex = nextIndex;
      }
    }

    state.tokens = nextTokens;
  });

  const parseWikiSyntax = (
    state: StateInline,
    silent: boolean,
    embed: boolean,
  ) => {
    const start = state.pos;
    const source = state.src;
    const linkStart = embed ? start + 1 : start;

    if (embed) {
      if (
        source[start] !== "!" ||
        source[start + 1] !== "[" ||
        source[start + 2] !== "["
      ) {
        return false;
      }
    } else if (source[linkStart] !== "[" || source[linkStart + 1] !== "[") {
      return false;
    }

    const end = source.indexOf("]]", linkStart + 2);
    if (end === -1) return false;

    const rawContent = source.slice(linkStart + 2, end).trim();
    if (!rawContent || rawContent.includes("\n")) return false;

    if (!silent) {
      const token = state.push(embed ? "wikiembed" : "wikilink", "", 0);
      token.content = rawContent;
    }

    state.pos = end + 2;
    return true;
  };

  // Obsidian 风格的 `==高亮==` / `%%注释%%`，Live 模式已支持，这里让 Preview 对齐。
  // 匹配规则须与 `livePreview/listAndHighlight.ts` 保持一致（flanking、转义、不跨空行）。
  const markHighlightRuler = (state: StateInline, silent: boolean) => {
    const start = state.pos;
    const src = state.src;
    const max = state.posMax;

    if (start + 3 >= max) return false;
    if (src[start] !== "=" || src[start + 1] !== "=") return false;

    // 跳过被转义的起始标记：`\==...==`
    if (start > 0 && src[start - 1] === "\\") return false;

    const first = src[start + 2];
    // 起始侧 flanking：紧随的第一个字符不能是空白或 `=`
    if (first === undefined || /\s/.test(first) || first === "=") return false;

    const contentStart = start + 2;
    let search = contentStart;
    while (search < max - 1) {
      const close = src.indexOf("==", search);
      if (close === -1 || close + 1 >= max) return false;

      // 跳过被转义的结束标记
      if (close > 0 && src[close - 1] === "\\") {
        search = close + 2;
        continue;
      }

      const before = src[close - 1];
      const after = src[close + 2];
      // 结束侧 flanking：前一个字符不能是空白，后一个字符不能是 `=`
      if (before === undefined || /\s/.test(before) || after === "=") {
        search = close + 2;
        continue;
      }

      const content = src.slice(contentStart, close);
      // 不允许跨空行（跨段落）
      if (/\n[ \t]*\n/.test(content)) {
        search = close + 2;
        continue;
      }

      if (!silent) {
        const openToken = state.push("mark_open", "mark", 1);
        openToken.attrs = [["class", "markdown-highlight"]];
        const children: Token[] = [];
        state.md.inline.parse(content, state.md, state.env, children);
        state.tokens.push(...children);
        state.push("mark_close", "mark", -1);
      }

      state.pos = close + 2;
      return true;
    }

    return false;
  };

  const obsidianCommentRuler = (state: StateInline, silent: boolean) => {
    const start = state.pos;
    const src = state.src;
    const max = state.posMax;

    if (start + 3 >= max) return false;
    if (src[start] !== "%" || src[start + 1] !== "%") return false;

    const contentStart = start + 2;
    let search = contentStart;
    while (search < max - 1) {
      const close = src.indexOf("%%", search);
      if (close === -1 || close + 1 >= max) return false;

      // 跳过被转义的结束标记（`\%%`）
      if (close > 0 && src[close - 1] === "\\") {
        search = close + 2;
        continue;
      }

      const content = src.slice(contentStart, close);
      if (/\n[ \t]*\n/.test(content)) {
        search = close + 2;
        continue;
      }

      // 隐藏注释：吞掉整段内容，不产出任何 token
      if (silent) {
        state.pos = close + 2;
        return true;
      }

      state.pos = close + 2;
      return true;
    }

    return false;
  };

  md.inline.ruler.before("image", "wikiembed", (state, silent) =>
    parseWikiSyntax(state, silent, true),
  );
  md.inline.ruler.before("link", "wikilink", (state, silent) =>
    parseWikiSyntax(state, silent, false),
  );

  md.inline.ruler.after("text", "mark_highlight", markHighlightRuler);
  md.inline.ruler.after("text", "obsidian_comment", obsidianCommentRuler);

  md.renderer.rules.wikilink = (tokens, idx) => {
    const rawContent = tokens[idx].content;
    const { target, displayText } = parseWikiLinkReference(rawContent);
    const escapedTarget = md.utils.escapeHtml(target);
    const escapedLabel = md.utils.escapeHtml(displayText || target);
    return `<a class="markdown-link markdown-wikilink" href="#" data-wikilink="${escapedTarget}">${escapedLabel}</a>`;
  };

  md.renderer.rules.wikiembed = (tokens, idx) => {
    const rawContent = tokens[idx].content;
    const { target, displayText, embedSize } = parseWikiLinkReference(
      rawContent,
      { embed: true },
    );
    const escapedTarget = md.utils.escapeHtml(target);
    const escapedLabel = md.utils.escapeHtml(displayText || target);
    const sizeAttributes = [
      embedSize?.width ? ` data-wiki-width="${embedSize.width}"` : "",
      embedSize?.height ? ` data-wiki-height="${embedSize.height}"` : "",
    ].join("");
    return `<a class="markdown-link markdown-embed" href="#" data-wikilink="${escapedTarget}" data-wiki-embed="true" data-wiki-target="${escapedTarget}" data-wiki-label="${escapedLabel}"${sizeAttributes}>${escapedLabel}</a>`;
  };

  md.renderer.rules.list_item_open = function listItemOpen(
    tokens,
    idx,
    options,
    env: MarkdownRenderEnv,
    self,
  ) {
    const token = tokens[idx];
    if (env?.orderedListMode === "loose" && token.info) {
      const digitMatch = String(token.info)
        .trim()
        .match(/^(\d+)/);
      if (digitMatch) {
        token.attrSet("value", digitMatch[1]);
      }
    }
    return self.renderToken(tokens, idx, options);
  };

  // Initialize extensions
  initKaTeX(md);
  initMermaid(md);

  /** Percent-encode spaces and non-ASCII in http(s) URLs for valid HTML attributes. */
  const defaultImageRenderer = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const srcIdx = token.attrIndex("src");
    if (srcIdx >= 0 && token.attrs) {
      const raw = token.attrs[srcIdx][1];
      if (typeof raw === "string") {
        token.attrs[srcIdx][1] = normalizeHttpUrlForHtmlAttribute(raw);
      }
    }

    // Obsidian `![alt|300](url)` / `![alt|300x200](url)`：尺寸写在 alt 里。
    // 默认 renderer 会用 children 覆盖 alt，所以要先剥掉尺寸再交给它。
    const rawAlt = self.renderInlineAsText(token.children || [], options, env);
    const sized = splitObsidianImageAlt(rawAlt);
    if (sized.width || sized.height) {
      const textToken = new Token("text", "", 0);
      textToken.content = sized.label;
      token.children = sized.label ? [textToken] : [];
      token.attrSet("alt", sized.label);
      if (sized.width) {
        token.attrSet("width", String(sized.width));
        token.attrSet("data-wiki-embed-w", String(sized.width));
      }
      if (sized.height) {
        token.attrSet("height", String(sized.height));
        token.attrSet("data-wiki-embed-h", String(sized.height));
      }
    }

    token.attrSet("decoding", "async");
    token.attrSet("loading", "lazy");
    token.attrSet("fetchpriority", "auto");

    if (defaultImageRenderer) {
      return defaultImageRenderer(tokens, idx, options, env, self);
    }

    return self.renderToken(tokens, idx, options);
  };

  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const hrefIdx = token.attrIndex("href");
    if (hrefIdx >= 0 && token.attrs) {
      const raw = token.attrs[hrefIdx][1];
      if (typeof raw === "string") {
        token.attrs[hrefIdx][1] = normalizeHttpUrlForHtmlAttribute(raw);
      }
    }
    return (
      defaultLinkOpen?.(tokens, idx, options, env, self) ||
      self.renderToken(tokens, idx, options)
    );
  };

  return md;
};

// Get or create markdown-it instance
let mdInstance: MarkdownIt | null = null;
let baseFenceRenderer: MarkdownIt["renderer"]["rules"]["fence"] | null = null;

export function getMarkdownIt(): MarkdownIt {
  if (!mdInstance) {
    mdInstance = createMarkdownIt();
    // Store the original markdown-it fence renderer (before any Shiki wrapping)
    baseFenceRenderer = mdInstance.renderer.rules.fence || null;
  }
  return mdInstance;
}

// Store highlighter reference for the current render
let currentHighlighter: ShikiHighlighter | null = null;
let currentTheme: ThemeMode = "light";

// LRU Cache for markdown rendering results
const markdownCache = new LRUCache<string, string>(30);
const MAX_CACHEABLE_LENGTH = 100000; // Don't cache very large documents
const MARKDOWN_RENDERER_CACHE_VERSION = 10;
const PREVIEW_BLANK_LINE_HTML =
  '<div class="preview-source-blank-line"></div>\n';

function canUseShikiLanguage(
  highlighter: ShikiHighlighter | null,
  lang: string,
): boolean {
  if (!highlighter || !lang) return false;

  const loadedLanguages = new Set<string>(
    highlighter.getLoadedLanguages?.() ?? [],
  );
  if (loadedLanguages.has(lang)) return true;

  if (typeof highlighter.supportsLanguage === "function") {
    return Boolean(highlighter.supportsLanguage(lang));
  }

  return false;
}

function configureFenceRenderer(
  md: MarkdownIt,
  highlighter: ShikiHighlighter | null,
  themeMode: ThemeMode = "light",
  markdownStylePreset: MarkdownStylePreset = "nord",
) {
  // Always update current highlighter reference for the latest instance
  currentHighlighter = highlighter;
  currentTheme = themeMode;

  // Get the base fence renderer - this should be the original markdown-it fence renderer
  // We avoid using the current md.renderer.rules.fence to prevent wrapping ourselves
  const baseFence = baseFenceRenderer;

  // Create a local reference to the highlighter for this render call
  // This ensures we use the correct highlighter even in build mode
  const localHighlighter = highlighter;
  const localThemeMode = themeMode;

  // Always update the fence renderer to ensure it has access to the latest highlighter
  md.renderer.rules.fence = (
    tokens,
    idx,
    options,
    env: MarkdownRenderEnv,
    self,
  ) => {
    const token = tokens[idx];
    const rawLang = token.info.trim().split(/\s+/)[0] || "";
    const lang = normalizeShikiLanguage(rawLang);
    const shouldAvoidShellHighlight = rawLang.trim().toLowerCase() === "shell";

    if (lang === "mermaid" || lang === "mmd") {
      return baseFence
        ? baseFence(tokens, idx, options, env, self)
        : `<pre><code class="language-${lang}">${md.utils.escapeHtml(token.content.trim())}</code></pre>`;
    }

    // Use the local highlighter reference for this specific render call
    // This is more reliable than the module-level variable in build mode
    const activeHighlighter = localHighlighter ?? currentHighlighter;
    const activeThemeMode = localThemeMode ?? currentTheme;

    if (
      !shouldAvoidShellHighlight &&
      activeHighlighter &&
      lang &&
      canUseShikiLanguage(activeHighlighter, lang)
    ) {
      try {
        const activeTheme = getMarkdownPressShikiTheme(
          activeThemeMode,
          markdownStylePreset,
        );
        const shikiHtml = wrapShikiBlockHtml(
          activeHighlighter.codeToHtml(token.content.trim(), {
            lang,
            theme: activeTheme,
          }),
        );
        const shikiBlocks = env.shikiBlocks ?? (env.shikiBlocks = []);
        const blockIndex = shikiBlocks.push(shikiHtml) - 1;
        return `<div data-shiki-block="${blockIndex}"></div>`;
      } catch (error) {
        console.warn(`Shiki failed for ${lang}:`, error);
        // In release .app builds, DevTools may be unavailable. Persist the error to app data dir
        // so we can diagnose why Shiki falls back to the base fence renderer.
        void (async () => {
          try {
            const [{ writeTextFile, mkdir }, { appDataDir, join }] =
              await Promise.all([
                import("@tauri-apps/plugin-fs"),
                import("@tauri-apps/api/path"),
              ]);
            const dir = await appDataDir();
            const folder = await join(dir, "MarkdownPress");
            const file = await join(folder, "shiki-diagnostics.log");
            const now = new Date().toISOString();
            const details =
              error instanceof Error
                ? `${error.message}\n${error.stack ?? ""}`.trim()
                : String(error ?? "").trim();
            await mkdir(folder, { recursive: true });
            await writeTextFile(
              file,
              `[${now}] Shiki failed for ${lang}\n${details}\n\n`,
              { append: true },
            );
          } catch {
            // ignore
          }
        })();
        // Log detailed error in build mode
        if (typeof window !== "undefined") {
          console.warn("[Shiki Error Details]", {
            lang,
            theme: getMarkdownPressShikiTheme(
              activeThemeMode,
              markdownStylePreset,
            ),
            hasHighlighter: !!activeHighlighter,
            highlighterMethods: Object.keys(activeHighlighter || {}),
          });
        }
      }
    }

    if (baseFence) {
      return baseFence(tokens, idx, options, env, self);
    }

    return `<pre><code class="language-${lang}">${md.utils.escapeHtml(token.content.trim())}</code></pre>`;
  };
}

/**
 * React hook for markdown renderer with Shiki syntax highlighting
 */
export function useMarkdownRenderer(
  _highlighter: ShikiHighlighter | null,
  _themeMode: ThemeMode,
) {
  useEffect(() => {
    applyKatexDarkTheme();
  }, []);
}

function createCacheKey(
  markdown: string,
  options: MarkdownRenderOptions,
): string {
  const hl = options.highlighter;
  const hlToken = hl
    ? `1_${typeof hl.__revision === "number" ? hl.__revision : 0}`
    : "0";
  const olMode = options.orderedListMode ?? "strict";
  const sourceBlankLineMode =
    options.preserveSourceBlankLines === false ? "compact" : "preview-blanks";
  return `${MARKDOWN_RENDERER_CACHE_VERSION}_${hashContent(markdown)}_${hlToken}_${options.themeMode ?? "light"}_${options.markdownStylePreset ?? "nord"}_${olMode}_${sourceBlankLineMode}`;
}

/**
 * CommonMark ends a bare link/image destination at the first space. Wrap destinations that
 * contain spaces in angle brackets so markdown-it keeps the full path (local vault paths and
 * http(s) URLs). Editor source can keep literal spaces; this is render-time only.
 */
function applyAngleBracketDestinations(chunk: string): string {
  const wrap = (prefix: string, dest: string, suffix: string): string => {
    const parsed = parseMarkdownDestination(dest);
    if (!parsed.path) return `${prefix}${dest}${suffix}`;
    return `${prefix}${buildMarkdownDestination(parsed.path, parsed)}${suffix}`;
  };

  // Images: ![alt](dest with spaces)
  let out = chunk.replace(
    /(!\[[^\]]*\]\()\s*(?!<)([^)\n]+)\s*(\))/g,
    (_full, open: string, url: string, close: string) => wrap(open, url, close),
  );

  // Links: [label](dest with spaces) — skip image syntax via (?<!!)
  out = out.replace(
    /(?<!!)(\[[^\]]+\]\()\s*(?!<)([^)\n]+)\s*(\))/g,
    (_full, open: string, url: string, close: string) => wrap(open, url, close),
  );

  return out;
}

/** 对非围栏段内的行内代码 span 之外的文本做变换。 */
function mapOutsideInlineCode(
  text: string,
  transform: (chunk: string) => string,
): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      let n = 1;
      while (i + n < text.length && text[i + n] === "`") n += 1;
      const closer = "`".repeat(n);
      const closeAt = text.indexOf(closer, i + n);
      if (closeAt === -1) {
        out += transform(text.slice(i));
        break;
      }
      out += text.slice(i, closeAt + n);
      i = closeAt + n;
      continue;
    }
    const nextTick = text.indexOf("`", i);
    const end = nextTick === -1 ? text.length : nextTick;
    out += transform(text.slice(i, end));
    i = end;
  }
  return out;
}

/** 按 fence 分段，只变换非代码块内容。 */
function mapOutsideFencedBlocks(
  markdown: string,
  transform: (chunk: string) => string,
): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fenceMarker = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (fenceMarker) {
      out.push(line);
      const match = line.match(FENCE_OPEN_RE);
      if (
        match &&
        match[2][0] === fenceMarker[0] &&
        match[2].length >= fenceMarker.length
      ) {
        fenceMarker = "";
      }
      i += 1;
      continue;
    }

    const open = line.match(FENCE_OPEN_RE);
    if (open) {
      out.push(line);
      fenceMarker = open[2];
      i += 1;
      continue;
    }

    const start = i;
    while (i < lines.length && !FENCE_OPEN_RE.test(lines[i])) {
      i += 1;
    }
    out.push(transform(lines.slice(start, i).join("\n")));
  }

  return out.join("\n");
}

/**
 * CommonMark ends a bare link/image destination at the first space. Wrap destinations that
 * contain spaces in angle brackets so markdown-it keeps the full path (local vault paths and
 * http(s) URLs). Editor source can keep literal spaces; this is render-time only.
 * 跳过围栏代码块与行内代码，避免改写 `handlers[type](event, data)` 这类源码。
 */
export function angleBracketBareMarkdownDestinations(markdown: string): string {
  return mapOutsideFencedBlocks(markdown, (segment) =>
    mapOutsideInlineCode(segment, applyAngleBracketDestinations),
  );
}

function countBlankSourceLines(
  lines: string[],
  startLine: number,
  endLine: number,
): number {
  let count = 0;
  for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
    if ((lines[lineIndex] ?? "").trim() === "") {
      count += 1;
    }
  }
  return count;
}

function createPreviewBlankLineToken(count: number): Token {
  const token = new Token("html_block", "", 0);
  token.block = true;
  token.content = PREVIEW_BLANK_LINE_HTML.repeat(count);
  return token;
}

function preservePreviewSourceBlankLines(
  tokens: Token[],
  markdown: string,
): Token[] {
  const lines = markdown.split("\n");
  const nextTokens: Token[] = [];
  let previousTopLevelEndLine: number | null = null;

  for (const token of tokens) {
    if (token.level === 0 && token.map && token.nesting !== -1) {
      const [startLine, endLine] = token.map;
      if (
        previousTopLevelEndLine !== null &&
        startLine > previousTopLevelEndLine
      ) {
        const blankLineCount = countBlankSourceLines(
          lines,
          previousTopLevelEndLine,
          startLine,
        );
        if (blankLineCount > 0) {
          nextTokens.push(createPreviewBlankLineToken(blankLineCount));
        }
      }
      previousTopLevelEndLine = endLine;
    }

    nextTokens.push(token);
  }

  return nextTokens;
}

/**
 * Render markdown to HTML with sanitization and caching
 */
export function renderMarkdown(
  markdown: string,
  options: MarkdownRenderOptions = {},
): string {
  // Check cache for non-large documents
  const shouldCache = markdown.length <= MAX_CACHEABLE_LENGTH;

  if (shouldCache) {
    const cacheKey = createCacheKey(markdown, options);
    const cached = markdownCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const md = getMarkdownIt();
  const highlighter = options.highlighter ?? null;
  const themeMode = options.themeMode ?? "light";
  const markdownStylePreset = options.markdownStylePreset ?? "nord";

  // Configure fence renderer with the highlighter
  configureFenceRenderer(md, highlighter, themeMode, markdownStylePreset);

  const env: MarkdownRenderEnv = {
    orderedListMode: options.orderedListMode ?? "strict",
  };
  const normalizedMarkdown = normalizeMarkdownTablesForRender(
    angleBracketBareMarkdownDestinations(markdown),
  );
  // 把 alpha/roman marker 改写成阿拉伯数字,让 markdown-it 正常识别为有序列表;
  // 后续通过 token.map[0] 把原始风格(A./a./I./i.)以 type/start 属性回填到 ordered_list_open。
  const { src: alphaPreparedSrc, meta: alphaRomanMeta } =
    preprocessAlphaRomanLists(normalizedMarkdown);
  const parsedTokens = md.parse(alphaPreparedSrc, env);
  const tokens =
    options.preserveSourceBlankLines === false
      ? parsedTokens
      : preservePreviewSourceBlankLines(parsedTokens, alphaPreparedSrc);
  applyAlphaRomanListAttrs(tokens, alphaRomanMeta);
  const renderedHtml = md.renderer.render(tokens, md.options, env);

  // Sanitize HTML to prevent XSS attacks
  const sanitizedHtml = DOMPurify.sanitize(renderedHtml, {
    ADD_TAGS: ["iframe", "section", "sup"], // section/sup: markdown-it-footnote; iframe: embeds
    // Preserve Shiki token styling while still sanitizing the rest of the HTML.
    ADD_ATTR: [
      "align",
      "allow",
      "allowfullscreen",
      "frameborder",
      "fetchpriority",
      "height",
      "scrolling",
      "style",
      "tabindex",
      "width",
      "data-wikilink",
      "data-wiki-embed",
      "data-wiki-target",
      "data-wiki-label",
      "data-wiki-width",
      "data-wiki-height",
      "data-wiki-embed-w",
      "data-wiki-embed-h",
      "data-block-id",
      "data-callout",
      "data-shiki-block",
      "value",
      // 用于 alpha/roman 有序列表: <ol type="A" start="3"> 等
      "type",
      "start",
    ],
  });

  const result = env.shikiBlocks?.length
    ? sanitizedHtml.replace(
        /<div data-shiki-block="(\d+)"><\/div>/g,
        (_match, blockIndex: string) =>
          env.shikiBlocks?.[Number(blockIndex)] ?? "",
      )
    : sanitizedHtml;

  // Store in cache
  if (shouldCache) {
    const cacheKey = createCacheKey(markdown, options);
    markdownCache.set(cacheKey, result);
  }

  return result;
}

/**
 * Clear the markdown render cache
 */
export function clearMarkdownCache(): void {
  markdownCache.clear();
}

/**
 * Configure custom CSS classes for markdown rendering
 */
export function configureMarkdownClasses(
  md: MarkdownIt,
  _classes: Record<string, string>,
) {
  // Configure heading classes
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const level = token.tag.substring(1);
    token.attrPush(["class", `heading-${level}`]);
    return self.renderToken(tokens, idx, options);
  };

  // Configure link classes
  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    token.attrPush(["class", "markdown-link"]);
    return (
      defaultLinkOpen?.(tokens, idx, options, env, self) ||
      self.renderToken(tokens, idx, options)
    );
  };
}

export default getMarkdownIt;
