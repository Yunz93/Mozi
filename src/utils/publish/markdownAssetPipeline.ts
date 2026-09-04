import { generateFrontmatter } from "../frontmatter";
import type { Frontmatter } from "../../types";

/**
 * Shared regexes and helpers for publish pipelines (simple blog, WeChat,
 * image-hosting rewrite). Previously duplicated across simpleBlogPublish.ts,
 * publishLocalImagesToHosting.ts and wechatPublish.ts.
 */

export const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(\s*([^)\n]+)\s*\)/g;
export const WIKI_EMBED_REGEX = /!\[\[([^\]\n]+)\]\]/g;

/**
 * Whether a markdown/image target is a remote URL (has a scheme or is
 * protocol-relative) rather than a local file path.
 */
export function isRemoteTarget(target: string): boolean {
  return /^[a-z][a-z\d+\-.]*:/i.test(target) || target.startsWith("//");
}

/**
 * Whether a file path points at a raster or vector image we can upload.
 */
export function isLikelyRasterOrVectorImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|heic|tiff?)$/i.test(filePath);
}

function decodeMarkdownImageDestination(rawDestination: string): string {
  const trimmed = rawDestination.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("<")) {
    const closingIndex = trimmed.indexOf(">");
    if (closingIndex > 0) {
      return trimmed.slice(1, closingIndex).trim();
    }
  }

  const titleSeparated = trimmed.match(/^(.+?)(?:\s+(?:"[^"]*"|'[^']*'))?$/);
  return (titleSeparated?.[1] || trimmed).trim();
}

/** 文档是否含尚未指向远程 URL 的本地图片引用。 */
export function markdownHasLocalImages(markdown: string): boolean {
  for (const match of markdown.matchAll(WIKI_EMBED_REGEX)) {
    const target = (match[1] || "").split("|")[0]?.trim() ?? "";
    if (
      target &&
      !isRemoteTarget(target) &&
      isLikelyRasterOrVectorImagePath(target)
    ) {
      return true;
    }
  }

  for (const match of markdown.matchAll(MARKDOWN_IMAGE_REGEX)) {
    const target = decodeMarkdownImageDestination(match[2] || "");
    if (target && !isRemoteTarget(target)) {
      return true;
    }
  }

  return false;
}

export function isImageHostingConfigured(settings: {
  imageHosting?: { provider?: string } | null;
}): boolean {
  const provider = settings.imageHosting?.provider;
  return Boolean(provider && provider !== "none");
}

/** simple-blog：图床未配置时改走仓库资源管线，不再因本地图片中止。 */
export function shouldAbortSimpleBlogPublishForMissingHosting(_input: {
  imageHostingConfigured: boolean;
  hasLocalImages: boolean;
}): boolean {
  return false;
}

/**
 * Reattach a frontmatter header (if present) to a transformed body.
 */
export function rebuildMarkdown(
  frontmatter: Frontmatter | null,
  body: string,
): string {
  if (!frontmatter) {
    return body;
  }
  const header = generateFrontmatter(frontmatter);
  return header ? header + body : body;
}

/**
 * Async variant of String.prototype.replace that awaits each replacement.
 */
export async function replaceAsync(
  input: string,
  regex: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
  let output = "";
  let lastIndex = 0;

  for (const match of input.matchAll(regex)) {
    const fullMatch = match[0];
    const index = match.index ?? 0;
    output += input.slice(lastIndex, index);
    output += await replacer(match as RegExpExecArray);
    lastIndex = index + fullMatch.length;
  }

  output += input.slice(lastIndex);
  return output;
}
