import {
  createAttachmentResolverContext,
  resolveAttachmentTarget,
} from "./attachmentResolver";
import { generateFrontmatter, parseFrontmatter } from "./frontmatter";
import { normalizeMarkdownStylePreset } from "./markdownStyle";
import { normalizeBlogSiteUrl } from "./blogRepo";
import { createHeadingSlug } from "./outline";
import { parseWikiLinkReference, resolveWikiLinkFile } from "./wikiLinks";
import { getFileSystem } from "../types/filesystem";
import { getPathBasename } from "./pathHelpers";
import {
  MARKDOWN_IMAGE_REGEX,
  WIKI_EMBED_REGEX,
  isRemoteTarget,
  replaceAsync,
} from "./publish/markdownAssetPipeline";
import type { FileNode, Frontmatter, MarkdownStylePreset } from "../types";

export interface SimpleBlogPublishAsset {
  sourcePath: string;
  targetRelativePath: string;
}

export interface SimpleBlogPublishDefaults {
  title: string;
  slug: string;
  aliases: string;
}

export interface SimpleBlogPublishInput {
  title: string;
  slug: string;
  aliases: string;
}

export interface PreparedSimpleBlogPublish {
  markdownContent: string;
  postRelativePath: string;
  assetDirectoryRelativePath: string;
  assets: SimpleBlogPublishAsset[];
  unresolvedImages: string[];
  publishId: string;
  legacySlug?: string;
}

interface PrepareSimpleBlogPublishOptions {
  files: FileNode[];
  blogSiteUrl?: string | null;
  rootFolderPath?: string | null;
  currentFilePath: string;
  markdownContent: string;
  markdownStylePreset?: MarkdownStylePreset;
}

const PUBLISH_ID_PATTERN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

/** 将远端归属保存到笔记，改名或重试不再根据同名文件猜测覆盖目标。 */
export function ensureSimpleBlogPublishBinding(
  markdownContent: string,
  currentFilePath: string,
  repository?: string,
  blogSiteUrl?: string,
): string {
  const { frontmatter, body } = parseFrontmatter(markdownContent);
  const previous = frontmatter ?? {};
  const previousId = String(previous.mozi_blog_id ?? "");
  const previousRepository = String(previous.mozi_blog_repository ?? "");
  const target = String(previous.mozi_blog_post_path ?? "");
  const legacyTarget = buildSimpleBlogPostRelativePath(currentFilePath);
  if (
    PUBLISH_ID_PATTERN.test(previousId) &&
    (!repository || previousRepository === repository) &&
    /^posts\/[^/\\]+\.md$/.test(target)
  ) {
    // 旧文首次迁移成功前仍以原文件名定位；目标缺失时可恢复原名重试，不能另建重复文章。
    if (
      typeof previous.mozi_blog_legacy_slug === "string" &&
      previous.mozi_blog_legacy_slug &&
      target !== legacyTarget
    ) {
      return `${generateFrontmatter({ ...previous, mozi_blog_post_path: legacyTarget })}${body}`;
    }
    return markdownContent;
  }

  const id = crypto.randomUUID();
  const baseName =
    stripExtension(getPathBasename(currentFilePath)) || "published-post";
  let legacySlug = "";
  // 只迁移已明确绑定当前站点的旧文章；新文章和切换仓库不能借旧文件名接管正文。
  if (
    !previousId &&
    previous.is_publish === true &&
    typeof previous.link === "string" &&
    blogSiteUrl
  ) {
    const site = normalizeBlogSiteUrl(blogSiteUrl);
    if (site && previous.link.startsWith(`${site}/posts/`)) {
      legacySlug = String(previous.slug || "").trim();
    }
  }
  const next: Frontmatter = {
    ...previous,
    mozi_blog_id: id,
    mozi_blog_repository: repository ?? previousRepository,
    mozi_blog_post_path: legacySlug
      ? `posts/${baseName}.md`
      : `posts/${Array.from(baseName).slice(0, 70).join("")}-${id}.md`,
  };
  if (legacySlug) next.mozi_blog_legacy_slug = legacySlug;
  else delete next.mozi_blog_legacy_slug;
  return `${generateFrontmatter(next)}${body}`;
}

const WIKI_LINK_REGEX = /(^|[^!])\[\[([^\]\n]+)\]\]/gm;

function stripExtension(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, "");
}

function normalizeSlugCandidate(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeLinkSlugCandidate(value: string): string {
  return normalizeSlugCandidate(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9/_ -]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function extractAliasCandidates(frontmatter: Frontmatter | null): string[] {
  const aliases = frontmatter?.aliases;
  if (typeof aliases === "string") {
    const normalized = normalizeSlugCandidate(aliases);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(aliases)) {
    return aliases
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeSlugCandidate(item))
      .filter(Boolean);
  }

  return [];
}

function encodeUrlPath(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function sanitizeAssetFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "asset";
}

function isMarkdownFilePath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function decodeMarkdownDestination(rawDestination: string): string {
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

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function buildSimpleBlogPostRelativePath(filePath: string): string {
  return `posts/${stripExtension(getPathBasename(filePath)) || "published-post"}.md`;
}

function normalizePublishedLink(
  rawLink: string,
  blogSiteUrl: string | null | undefined,
): string | null {
  const trimmed = rawLink.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("/")) {
    const normalizedSiteUrl = normalizeBlogSiteUrl(blogSiteUrl ?? "");
    if (!normalizedSiteUrl) {
      return null;
    }

    try {
      return new URL(trimmed, `${normalizedSiteUrl}/`).toString();
    } catch {
      return null;
    }
  }

  return null;
}

function resolvePublishedNoteUrl(
  blogSiteUrl: string | null | undefined,
  markdownContent: string,
  filePath: string,
): string | null {
  const { frontmatter } = parseFrontmatter(markdownContent);
  const explicitLink =
    typeof frontmatter?.link === "string"
      ? normalizePublishedLink(frontmatter.link, blogSiteUrl)
      : null;

  if (explicitLink) {
    return explicitLink;
  }

  if (frontmatter?.is_publish !== true) {
    return null;
  }

  return buildSimpleBlogPostUrl(
    blogSiteUrl ?? "",
    markdownContent,
    buildSimpleBlogPostRelativePath(filePath),
  );
}

function appendWikiLinkFragment(
  url: string,
  reference: ReturnType<typeof parseWikiLinkReference>,
): string {
  if (!reference.subpath.trim()) {
    return url;
  }

  if (reference.subpathType !== "heading") {
    return url;
  }

  const headingSlug = createHeadingSlug(reference.subpath);
  if (!headingSlug) {
    return url;
  }

  return `${url}#${encodeURIComponent(headingSlug)}`;
}

function resolveSimpleBlogTitle(
  markdownContent: string,
  currentFilePath: string,
): string {
  const { frontmatter } = parseFrontmatter(markdownContent);
  const title =
    typeof frontmatter?.title === "string" ? frontmatter.title.trim() : "";

  if (title) {
    return title;
  }

  return stripExtension(getPathBasename(currentFilePath)) || "published-post";
}

function resolveSimpleBlogAliases(
  markdownContent: string,
  currentFilePath: string,
): string | string[] {
  const { frontmatter } = parseFrontmatter(markdownContent);
  const aliases = extractAliasCandidates(frontmatter);
  if (aliases.length > 0) {
    return Array.isArray(frontmatter?.aliases) ? aliases : aliases[0];
  }

  return resolveSimpleBlogTitle(markdownContent, currentFilePath);
}

function resolveSimpleBlogPublishSlug(
  markdownContent: string,
  currentFilePath: string,
): string {
  const { frontmatter } = parseFrontmatter(markdownContent);
  const slug =
    typeof frontmatter?.slug === "string"
      ? normalizeSlugCandidate(frontmatter.slug)
      : "";

  if (slug) {
    return slug;
  }

  return (
    normalizeLinkSlugCandidate(
      resolveSimpleBlogTitle(markdownContent, currentFilePath),
    ) ||
    stripExtension(getPathBasename(currentFilePath)) ||
    "published-post"
  );
}

export function extractSimpleBlogPublishDefaults(
  markdownContent: string,
  currentFilePath: string,
): SimpleBlogPublishDefaults {
  const title = resolveSimpleBlogTitle(markdownContent, currentFilePath);
  const aliasesValue = resolveSimpleBlogAliases(
    markdownContent,
    currentFilePath,
  );
  const aliases = Array.isArray(aliasesValue)
    ? aliasesValue.join(", ")
    : aliasesValue;
  const { frontmatter } = parseFrontmatter(markdownContent);
  const hasExplicitSlug =
    typeof frontmatter?.slug === "string" && !!frontmatter.slug.trim();
  const wasPublished =
    frontmatter?.is_publish === true ||
    (typeof frontmatter?.link === "string" && !!frontmatter.link.trim());
  const baseSlug = resolveSimpleBlogPublishSlug(
    markdownContent,
    currentFilePath,
  );
  // 新文档的建议在弹窗展示前区分同名路径，确认后的 URL 始终由用户填写值决定。
  let suggestedSlug = baseSlug;
  if (!hasExplicitSlug && !wasPublished) {
    const normalizedPath = currentFilePath.replace(/\\/g, "/").normalize("NFC");
    let pathHash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(normalizedPath)) {
      pathHash = BigInt.asUintN(64, (pathHash ^ BigInt(byte)) * 0x100000001b3n);
    }
    suggestedSlug = `${baseSlug}-${pathHash.toString(16).padStart(16, "0")}`;
  }

  return {
    title,
    slug: suggestedSlug,
    aliases,
  };
}

export function applySimpleBlogPublishInput(
  markdownContent: string,
  input: Pick<SimpleBlogPublishInput, "title" | "slug" | "aliases">,
): string {
  const { frontmatter, body } = parseFrontmatter(markdownContent);
  const title = input.title.trim();
  const slug = normalizeSlugCandidate(input.slug);
  const aliasesRaw = input.aliases.trim();
  const aliases = aliasesRaw
    ? aliasesRaw.includes(",")
      ? aliasesRaw
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : aliasesRaw
    : title;

  const nextFrontmatter: Frontmatter = {
    ...(frontmatter || {}),
    title: title || "published-post",
    aliases,
  };

  if (slug) {
    nextFrontmatter.slug = slug;
  } else {
    delete nextFrontmatter.slug;
  }

  return `${generateFrontmatter(nextFrontmatter)}${body}`;
}

function ensurePublishedFrontmatter(
  markdownContent: string,
  currentFilePath: string,
  markdownStylePreset?: MarkdownStylePreset,
): {
  frontmatter: Frontmatter;
  body: string;
  content: string;
} {
  const { frontmatter, body } = parseFrontmatter(markdownContent);
  const resolvedTitle = resolveSimpleBlogTitle(
    markdownContent,
    currentFilePath,
  );
  const resolvedAliases = resolveSimpleBlogAliases(
    markdownContent,
    currentFilePath,
  );
  const resolvedSlug = resolveSimpleBlogPublishSlug(
    markdownContent,
    currentFilePath,
  );
  const nextFrontmatter: Frontmatter = {
    ...(frontmatter || {}),
    title: resolvedTitle,
    aliases: resolvedAliases,
    slug: resolvedSlug,
    is_publish: true,
  };
  if (markdownStylePreset) {
    nextFrontmatter.markdown_style =
      normalizeMarkdownStylePreset(markdownStylePreset);
  }

  return {
    frontmatter: nextFrontmatter,
    body,
    content: `${generateFrontmatter(nextFrontmatter)}${body}`,
  };
}

export function resolveSimpleBlogPostSlug(
  markdownContent: string,
  postRelativePath: string,
): string {
  return stripExtension(getPathBasename(postRelativePath)) || "published-post";
}

export function resolveSimpleBlogLinkSlug(
  markdownContent: string,
  postRelativePath: string,
): string {
  return resolveSimpleBlogPublishSlug(markdownContent, postRelativePath);
}

export function buildSimpleBlogPostUrl(
  blogSiteUrl: string,
  markdownContent: string,
  postRelativePath: string,
): string | null {
  const normalizedSiteUrl = normalizeBlogSiteUrl(blogSiteUrl);
  if (!normalizedSiteUrl) {
    return null;
  }

  const slug = resolveSimpleBlogLinkSlug(markdownContent, postRelativePath);
  if (!slug) {
    return null;
  }

  const encodedSlugPath = encodeUrlPath(slug);
  return encodedSlugPath
    ? `${normalizedSiteUrl}/posts/${encodedSlugPath}/`
    : null;
}

export async function prepareSimpleBlogPublish(
  options: PrepareSimpleBlogPublishOptions,
): Promise<PreparedSimpleBlogPublish> {
  const {
    blogSiteUrl,
    currentFilePath,
    files,
    markdownContent,
    rootFolderPath,
    markdownStylePreset,
  } = options;
  const boundContent = ensureSimpleBlogPublishBinding(
    markdownContent,
    currentFilePath,
  );
  const published = ensurePublishedFrontmatter(
    boundContent,
    currentFilePath,
    markdownStylePreset,
  );
  const publishId = String(published.frontmatter.mozi_blog_id);
  const assetDirectoryRelativePath = `resource/mozi-${publishId}`;
  const postRelativePath = String(published.frontmatter.mozi_blog_post_path);

  const resolverContext = createAttachmentResolverContext(
    files,
    rootFolderPath,
    currentFilePath,
  );
  const assetMap = new Map<string, SimpleBlogPublishAsset>();
  const markdownFileContentCache = new Map<string, Promise<string | null>>();
  const unresolvedImages: string[] = [];
  let assetCounter = 0;

  const readMarkdownFileContent = async (
    file: FileNode,
  ): Promise<string | null> => {
    if (!isMarkdownFilePath(file.path)) {
      return null;
    }

    const cached = markdownFileContentCache.get(file.path);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      try {
        const fs = await getFileSystem();
        return await fs.readFile(file.path);
      } catch (error) {
        console.error(
          "Failed to read wiki link target for publish:",
          file.path,
          error,
        );
        return null;
      }
    })();

    markdownFileContentCache.set(file.path, pending);
    return pending;
  };

  const registerAsset = (
    sourcePath: string,
    originalName: string,
  ): SimpleBlogPublishAsset => {
    const existing = assetMap.get(sourcePath);
    if (existing) {
      return existing;
    }

    assetCounter += 1;
    const targetFileName = `${String(assetCounter).padStart(2, "0")}-${sanitizeAssetFileName(originalName)}`;
    const asset = {
      sourcePath,
      targetRelativePath: `${assetDirectoryRelativePath}/${targetFileName}`,
    };

    assetMap.set(sourcePath, asset);
    return asset;
  };

  let transformedBody = await replaceAsync(
    published.body,
    WIKI_EMBED_REGEX,
    async (match) => {
      const reference = parseWikiLinkReference(match[1], { embed: true });
      if (!reference.target || isRemoteTarget(reference.target)) {
        return match[0];
      }

      const resolved = await resolveAttachmentTarget(
        resolverContext,
        reference.target,
      );
      if (!resolved) {
        unresolvedImages.push(reference.target);
        return match[0];
      }

      const asset = registerAsset(resolved.path, resolved.name);
      const altText = reference.displayText || resolved.name;
      return `![${altText}](/${asset.targetRelativePath})`;
    },
  );

  const alreadyRewrittenPrefix = `/${assetDirectoryRelativePath}/`;

  transformedBody = await replaceAsync(
    transformedBody,
    MARKDOWN_IMAGE_REGEX,
    async (match) => {
      const altText = match[1] || "";
      const target = decodeMarkdownDestination(match[2]);
      if (!target || isRemoteTarget(target)) {
        return match[0];
      }

      if (target.startsWith(alreadyRewrittenPrefix)) {
        return match[0];
      }

      const resolved = await resolveAttachmentTarget(resolverContext, target);
      if (!resolved) {
        unresolvedImages.push(target);
        return match[0];
      }

      const asset = registerAsset(resolved.path, resolved.name);
      return `![${altText}](/${asset.targetRelativePath})`;
    },
  );

  transformedBody = await replaceAsync(
    transformedBody,
    WIKI_LINK_REGEX,
    async (match) => {
      const prefix = match[1] || "";
      const rawReference = match[2] || "";
      const reference = parseWikiLinkReference(rawReference);
      const label = escapeMarkdownLinkLabel(
        reference.displayText || reference.target,
      );

      if (!reference.target.trim()) {
        return match[0];
      }

      if (!reference.path.trim()) {
        if (reference.subpathType !== "heading") {
          return match[0];
        }

        const headingSlug = createHeadingSlug(reference.subpath);
        if (!headingSlug) {
          return match[0];
        }

        return `${prefix}[${label}](#${encodeURIComponent(headingSlug)})`;
      }

      const matchedFile = resolveWikiLinkFile(
        files,
        reference.target,
        rootFolderPath,
        currentFilePath,
      );
      if (!matchedFile) {
        return match[0];
      }

      const targetContent = await readMarkdownFileContent(matchedFile);
      if (!targetContent) {
        return match[0];
      }

      const targetUrl = resolvePublishedNoteUrl(
        blogSiteUrl,
        targetContent,
        matchedFile.path,
      );
      if (!targetUrl) {
        return match[0];
      }

      return `${prefix}[${label}](${appendWikiLinkFragment(targetUrl, reference)})`;
    },
  );

  if (unresolvedImages.length > 0) {
    console.warn(
      `[publish] ${unresolvedImages.length} local image(s) could not be resolved and will be skipped:`,
      unresolvedImages,
    );
  }

  const assets = Array.from(assetMap.values());
  console.log(
    `[publish] prepared ${assets.length} asset(s) for publish`,
    assets.length > 0 ? assets.map((a) => a.targetRelativePath) : "(none)",
  );

  return {
    markdownContent: `${generateFrontmatter(published.frontmatter)}${transformedBody}`,
    postRelativePath,
    assetDirectoryRelativePath,
    assets,
    unresolvedImages,
    publishId,
    legacySlug:
      typeof published.frontmatter.mozi_blog_legacy_slug === "string"
        ? published.frontmatter.mozi_blog_legacy_slug
        : undefined,
  };
}
