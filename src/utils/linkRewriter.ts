import type { FileNode } from "../types";
import { flattenFiles, isMarkdownFile } from "./markdownLinkUtils";
import {
  buildMarkdownDestination,
  parseMarkdownDestination,
} from "./markdownDestination";
import {
  canonicalizePath,
  normalizeSlashes,
  getRelativePath,
  getPathDirname,
  getPathBasename,
} from "./pathHelpers";
import { parseWikiLinkReference } from "./wikiLinks";
import { markdownLanguage } from "@codemirror/lang-markdown";

export interface RewriteResult {
  modifiedFiles: Array<{
    path: string;
    originalContent: string;
    newContent: string;
  }>;
}

export interface RewriteOptions {
  movedPathMap: Record<string, string>;
  files: FileNode[];
  rootFolderPath: string;
  fileContentOverrides: Record<string, string | undefined>;
  readFile: (path: string) => Promise<string>;
}

interface RewriteContext {
  pathMap: Map<string, string>;
  reverseMap: Map<string, string>;
  allFilePaths: Set<string>;
  rootFolderPath: string;
}

type ResolutionKind = "file-relative" | "root-relative";

interface ResolvedLink {
  finalTarget: string;
  via: ResolutionKind;
}

interface WikiRewriteInfo {
  newAbsolutePath: string;
  newRelativePath: string;
  newBasename: string;
  basenameChanged: boolean;
}

interface WikiRewriteIndex {
  byRelativePath: Map<string, WikiRewriteInfo>;
  byBasename: Map<string, WikiRewriteInfo>;
  originalPaths: Set<string>;
  destinationBasenameCounts: Map<string, number>;
  rootFolderPath: string;
}

// ── Sync path helpers (no Tauri dependency) ─────────────────────────────

function resolvePath(baseDir: string, target: string): string {
  const normTarget = normalizeSlashes(target);
  if (/^(\/|[a-zA-Z]:)/.test(normTarget))
    return normalizeDotSegments(normTarget);

  const normBase = normalizeSlashes(baseDir).replace(/\/+$/, "");
  return normalizeDotSegments(`${normBase}/${normTarget}`);
}

function normalizeDotSegments(path: string): string {
  const parts = normalizeSlashes(path).split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "." || (part === "" && resolved.length > 0)) continue;
    if (part === "..") {
      if (resolved.length > 1) resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

function getPathRelativeToRoot(absPath: string, rootPath: string): string {
  const normAbs = canonicalizePath(absPath);
  const normRoot = canonicalizePath(rootPath).replace(/\/+$/, "");
  if (normAbs.startsWith(`${normRoot}/`)) {
    return normAbs.slice(normRoot.length + 1);
  }
  return normAbs;
}

function stripMdExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function decodeTarget(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function hasUriScheme(value: string): boolean {
  return (
    /^[a-z][a-z\d+\-.]*:/i.test(value) ||
    value.startsWith("//") ||
    value.startsWith("#")
  );
}

// ── Context builders ────────────────────────────────────────────────────

function buildRewriteContext(
  movedPathMap: Record<string, string>,
  files: FileNode[],
  rootFolderPath: string,
): RewriteContext {
  const pathMap = new Map<string, string>();
  const reverseMap = new Map<string, string>();

  for (const [oldPath, newPath] of Object.entries(movedPathMap)) {
    const normOld = canonicalizePath(oldPath);
    const normNew = canonicalizePath(newPath);
    pathMap.set(normOld, normNew);
    reverseMap.set(normNew, normOld);
  }

  const allFilePaths = new Set<string>();
  for (const file of flattenFiles(files)) {
    allFilePaths.add(canonicalizePath(file.path));
  }

  return {
    pathMap,
    reverseMap,
    allFilePaths,
    rootFolderPath: canonicalizePath(rootFolderPath),
  };
}

function normalizeWikiRewriteTarget(path: string): string {
  return stripMdExtension(
    canonicalizePath(decodeTarget(path))
      .replace(/^\/+/, "")
      .replace(/^\.\//, "")
      .trim(),
  )
    .toLowerCase()
    .normalize("NFC");
}

function buildWikiRewriteIndex(ctx: RewriteContext): WikiRewriteIndex {
  const normRoot = ctx.rootFolderPath;
  const byRelativePath = new Map<string, WikiRewriteInfo>();
  const byBasename = new Map<string, WikiRewriteInfo>();
  const originalPaths = new Set<string>();
  const destinationPaths = new Set<string>();
  for (const path of ctx.allFilePaths) {
    destinationPaths.add(
      normalizeWikiRewriteTarget(
        getPathRelativeToRoot(ctx.pathMap.get(path) ?? path, normRoot),
      ),
    );
    originalPaths.add(
      normalizeWikiRewriteTarget(
        getPathRelativeToRoot(ctx.reverseMap.get(path) ?? path, normRoot),
      ),
    );
  }
  for (const path of ctx.pathMap.keys()) {
    originalPaths.add(
      normalizeWikiRewriteTarget(getPathRelativeToRoot(path, normRoot)),
    );
  }
  const basenameCounts = new Map<string, number>();
  for (const path of originalPaths) {
    const basename = getPathBasename(path);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }
  const destinationBasenameCounts = new Map<string, number>();
  for (const path of destinationPaths) {
    const basename = getPathBasename(path);
    destinationBasenameCounts.set(
      basename,
      (destinationBasenameCounts.get(basename) ?? 0) + 1,
    );
  }

  for (const [oldAbs, newAbs] of ctx.pathMap) {
    const oldRel = getPathRelativeToRoot(oldAbs, normRoot);
    const newRel = getPathRelativeToRoot(newAbs, normRoot);
    const oldBase = getPathBasename(oldAbs);
    const newBase = getPathBasename(newAbs);

    const info: WikiRewriteInfo = {
      newAbsolutePath: newAbs,
      newRelativePath: stripMdExtension(canonicalizePath(newRel)),
      newBasename: stripMdExtension(newBase.normalize("NFC")),
      basenameChanged:
        stripMdExtension(oldBase).toLowerCase().normalize("NFC") !==
        stripMdExtension(newBase).toLowerCase().normalize("NFC"),
    };

    const key = stripMdExtension(canonicalizePath(oldRel))
      .toLowerCase()
      .normalize("NFC");
    byRelativePath.set(key, info);

    const basenameKey = stripMdExtension(oldBase)
      .toLowerCase()
      .normalize("NFC");
    if (basenameCounts.get(basenameKey) === 1) {
      byBasename.set(basenameKey, info);
    }
  }

  return {
    byRelativePath,
    byBasename,
    originalPaths,
    destinationBasenameCounts,
    rootFolderPath: normRoot,
  };
}

// ── Link resolution ─────────────────────────────────────────────────────

function resolveStandardLink(
  target: string,
  resolveDir: string,
  ctx: RewriteContext,
): ResolvedLink | null {
  const fileRelative = canonicalizePath(resolvePath(resolveDir, target));
  if (ctx.pathMap.has(fileRelative)) {
    return {
      finalTarget: ctx.pathMap.get(fileRelative)!,
      via: "file-relative",
    };
  }
  if (ctx.allFilePaths.has(fileRelative)) {
    return { finalTarget: fileRelative, via: "file-relative" };
  }

  const rootRelative = canonicalizePath(
    resolvePath(ctx.rootFolderPath, target),
  );
  if (ctx.pathMap.has(rootRelative)) {
    return {
      finalTarget: ctx.pathMap.get(rootRelative)!,
      via: "root-relative",
    };
  }
  if (ctx.allFilePaths.has(rootRelative)) {
    return { finalTarget: rootRelative, via: "root-relative" };
  }

  return null;
}

function computeNewLinkPath(
  resolved: ResolvedLink,
  currentFilePath: string,
  ctx: RewriteContext,
): string {
  if (resolved.via === "root-relative") {
    return getPathRelativeToRoot(resolved.finalTarget, ctx.rootFolderPath);
  }
  return getRelativePath(currentFilePath, resolved.finalTarget);
}

// ── Rewriters ───────────────────────────────────────────────────────────

function isEscapedAt(content: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && content[index] === "\\"; index--)
    backslashes++;
  return backslashes % 2 === 1;
}

/** 判断链接起点是否位于代码或注释中，不拆断带行内代码标签的正常链接。 */
function createRewritePositionGuard(
  content: string,
): (offset: number) => boolean {
  let tree: ReturnType<typeof markdownLanguage.parser.parse> | undefined;
  const literalTypes = new Set([
    "FencedCode",
    "CodeBlock",
    "InlineCode",
    "Comment",
    "CommentBlock",
  ]);
  return (offset) => {
    if (isEscapedAt(content, offset)) return false;
    // 没有这一类候选链接时不解析整篇笔记，避免整库扫描增加无效开销。
    tree ??= markdownLanguage.parser.parse(content);
    let node = tree.resolveInner(offset, 1);
    while (node) {
      if (literalTypes.has(node.name)) return false;
      const parent = node.parent;
      if (!parent) break;
      node = parent;
    }
    return true;
  };
}

export function rewriteMarkdownLinks(
  content: string,
  currentFilePath: string,
  resolveDir: string,
  ctx: RewriteContext,
): string {
  const regex = /(!?\[[^\]]*\]\()(<[^>\n]+>|[^)\n]+)(\))/g;
  const canRewrite = createRewritePositionGuard(content);

  return content.replace(
    regex,
    (
      match,
      prefix: string,
      rawDest: string,
      suffix: string,
      offset: number,
    ) => {
      if (!canRewrite(offset)) return match;
      const {
        path: linkPath,
        angleBrackets,
        title,
      } = parseMarkdownDestination(rawDest);
      if (!linkPath || hasUriScheme(linkPath)) return match;

      const hashIdx = linkPath.indexOf("#");
      const filePart = hashIdx >= 0 ? linkPath.slice(0, hashIdx) : linkPath;
      const fragment = hashIdx >= 0 ? linkPath.slice(hashIdx) : "";
      if (!filePart) return match;

      const decoded = decodeTarget(filePart);
      const resolved = resolveStandardLink(decoded, resolveDir, ctx);
      if (!resolved) return match;

      const newPath = computeNewLinkPath(resolved, currentFilePath, ctx);
      if (canonicalizePath(newPath) === canonicalizePath(decoded)) return match;

      const newDest = buildMarkdownDestination(`${newPath}${fragment}`, {
        path: linkPath,
        angleBrackets,
        title,
      });

      return `${prefix}${newDest}${suffix}`;
    },
  );
}

export function rewriteWikiLinks(
  content: string,
  wikiIndex: WikiRewriteIndex,
  currentFilePath: string,
  resolveDir: string,
): string {
  const regex = /(!?\[\[)([^[\]]+)(\]\])/g;
  const canRewrite = createRewritePositionGuard(content);

  return content.replace(
    regex,
    (match, prefix: string, inner: string, suffix: string, offset: number) => {
      if (!canRewrite(offset)) return match;
      const parsed = parseWikiLinkReference(inner, {
        embed: prefix.startsWith("!"),
      });
      if (!parsed.path) return match;

      const normalizedTarget = normalizeWikiRewriteTarget(parsed.path);
      if (!normalizedTarget) return match;

      const targetBasename =
        normalizedTarget.split("/").filter(Boolean).pop() || normalizedTarget;
      const isPathBased = normalizedTarget.includes("/");

      const rawPath = normalizeSlashes(parsed.path);
      const explicitRelative = /^\.{1,2}\//.test(rawPath);
      const relativeTarget = normalizeWikiRewriteTarget(
        getPathRelativeToRoot(
          resolvePath(resolveDir, decodeTarget(parsed.path)),
          wikiIndex.rootFolderPath,
        ),
      );
      let matchedTarget: string | undefined;
      let viaRelative = false;
      if (explicitRelative) {
        if (wikiIndex.originalPaths.has(relativeTarget))
          matchedTarget = relativeTarget;
        viaRelative = true;
      } else if (wikiIndex.originalPaths.has(normalizedTarget)) {
        matchedTarget = normalizedTarget;
      } else if (
        !rawPath.startsWith("/") &&
        wikiIndex.originalPaths.has(relativeTarget)
      ) {
        matchedTarget = relativeTarget;
        viaRelative = true;
      }
      // 先确认实际原目标；同名但未移动的笔记必须保留，无目录的歧义链接不猜测。
      if (matchedTarget !== undefined) {
        const info = wikiIndex.byRelativePath.get(matchedTarget);
        if (
          !info ||
          (!isPathBased && !explicitRelative && !info.basenameChanged)
        )
          return match;
        let nextPath = viaRelative
          ? stripMdExtension(
              getRelativePath(currentFilePath, info.newAbsolutePath),
            )
          : info.newRelativePath;
        // 根目录同名笔记的优先级更高，必要时明确写出知识库内路径。
        if (
          viaRelative &&
          wikiIndex.originalPaths.has(normalizeWikiRewriteTarget(nextPath)) &&
          normalizeWikiRewriteTarget(nextPath) !==
            normalizeWikiRewriteTarget(info.newRelativePath)
        )
          nextPath = info.newRelativePath;
        return `${prefix}${rebuildWikiInner(nextPath, parsed)}${suffix}`;
      }

      // 已明确指定目录时不能按同名文件猜测，否则会改坏另一个目录的链接。
      if (isPathBased || explicitRelative) return match;

      const info = wikiIndex.byBasename.get(targetBasename);
      if (info?.basenameChanged) {
        const nextPath =
          (wikiIndex.destinationBasenameCounts.get(
            normalizeWikiRewriteTarget(info.newBasename),
          ) ?? 0) > 1
            ? info.newRelativePath
            : info.newBasename;
        return `${prefix}${rebuildWikiInner(nextPath, parsed)}${suffix}`;
      }

      return match;
    },
  );
}

function rebuildWikiInner(
  newPath: string,
  parsed: ReturnType<typeof parseWikiLinkReference>,
): string {
  let result = newPath;

  if (parsed.subpath) {
    const prefix = parsed.subpathType === "block" ? "#^" : "#";
    result += `${prefix}${parsed.subpath.replace(/^\^/, "")}`;
  }

  const pipeIdx = parsed.raw.indexOf("|");
  if (pipeIdx >= 0) {
    result += parsed.raw.slice(pipeIdx);
  }

  return result;
}

export function rewriteHtmlReferences(
  content: string,
  currentFilePath: string,
  resolveDir: string,
  ctx: RewriteContext,
): string {
  const regex =
    /(<(?:img|audio|video|source|a)\b[^>]*?(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi;
  const canRewrite = createRewritePositionGuard(content);

  return content.replace(
    regex,
    (match, prefix: string, quote: string, url: string, offset: number) => {
      if (!canRewrite(offset)) return match;
      if (!url || hasUriScheme(url)) return match;

      const decoded = decodeTarget(url.trim());
      const resolved = resolveStandardLink(decoded, resolveDir, ctx);
      if (!resolved) return match;

      const newPath = computeNewLinkPath(resolved, currentFilePath, ctx);
      if (canonicalizePath(newPath) === canonicalizePath(decoded)) return match;

      return `${prefix}${quote}${newPath}${quote}`;
    },
  );
}

// ── Orchestrator ────────────────────────────────────────────────────────

export async function findAndRewriteAffectedFiles(
  options: RewriteOptions,
): Promise<RewriteResult> {
  const {
    movedPathMap,
    files,
    rootFolderPath,
    fileContentOverrides,
    readFile,
  } = options;

  const ctx = buildRewriteContext(movedPathMap, files, rootFolderPath);
  const wikiIndex = buildWikiRewriteIndex(ctx);

  const markdownFiles = flattenFiles(files).filter(isMarkdownFile);
  const modifiedFiles: RewriteResult["modifiedFiles"] = [];

  for (const file of markdownFiles) {
    const currentPath = canonicalizePath(file.path);

    let content =
      fileContentOverrides[file.path] ?? fileContentOverrides[file.id];
    if (content === undefined) {
      try {
        content = await readFile(file.path);
      } catch {
        continue;
      }
    }

    const oldPath = ctx.reverseMap.get(currentPath);
    const resolveDir = oldPath
      ? getPathDirname(oldPath)
      : getPathDirname(currentPath);

    let rewritten = rewriteMarkdownLinks(content, currentPath, resolveDir, ctx);
    rewritten = rewriteWikiLinks(rewritten, wikiIndex, currentPath, resolveDir);
    rewritten = rewriteHtmlReferences(rewritten, currentPath, resolveDir, ctx);

    if (rewritten !== content) {
      modifiedFiles.push({
        path: file.path,
        originalContent: content,
        newContent: rewritten,
      });
    }
  }

  return { modifiedFiles };
}
