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

export interface RewriteResult {
  modifiedFiles: Array<{
    path: string;
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
  newRelativePath: string;
  newBasename: string;
  basenameChanged: boolean;
}

interface WikiRewriteIndex {
  byRelativePath: Map<string, WikiRewriteInfo>;
  byBasename: Map<string, WikiRewriteInfo>;
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

function buildWikiRewriteIndex(
  pathMap: Map<string, string>,
  rootFolderPath: string,
): WikiRewriteIndex {
  const normRoot = canonicalizePath(rootFolderPath);
  const byRelativePath = new Map<string, WikiRewriteInfo>();
  const byBasename = new Map<string, WikiRewriteInfo>();

  for (const [oldAbs, newAbs] of pathMap) {
    const oldRel = getPathRelativeToRoot(oldAbs, normRoot);
    const newRel = getPathRelativeToRoot(newAbs, normRoot);
    const oldBase = getPathBasename(oldAbs);
    const newBase = getPathBasename(newAbs);

    const info: WikiRewriteInfo = {
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
    if (!byBasename.has(basenameKey)) {
      byBasename.set(basenameKey, info);
    }
  }

  return { byRelativePath, byBasename };
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

export function rewriteMarkdownLinks(
  content: string,
  currentFilePath: string,
  resolveDir: string,
  ctx: RewriteContext,
): string {
  const regex = /(!?\[[^\]]*\]\()(<[^>\n]+>|[^)\n]+)(\))/g;

  return content.replace(
    regex,
    (match, prefix: string, rawDest: string, suffix: string) => {
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
): string {
  const regex = /(!?\[\[)([^[\]]+)(\]\])/g;

  return content.replace(
    regex,
    (match, prefix: string, inner: string, suffix: string) => {
      const parsed = parseWikiLinkReference(inner, {
        embed: prefix.startsWith("!"),
      });
      if (!parsed.path) return match;

      const normalizedTarget = stripMdExtension(
        canonicalizePath(parsed.path)
          .replace(/^\/+/, "")
          .replace(/^\.\//, "")
          .trim(),
      )
        .toLowerCase()
        .normalize("NFC");
      if (!normalizedTarget) return match;

      const targetBasename =
        normalizedTarget.split("/").filter(Boolean).pop() || normalizedTarget;
      const isPathBased = normalizedTarget.includes("/");

      let info = wikiIndex.byRelativePath.get(normalizedTarget);
      if (info) {
        return `${prefix}${rebuildWikiInner(info.newRelativePath, parsed)}${suffix}`;
      }

      info = wikiIndex.byBasename.get(
        isPathBased ? targetBasename : normalizedTarget,
      );
      if (info?.basenameChanged) {
        if (isPathBased) {
          const parts = parsed.path.split("/");
          parts[parts.length - 1] = info.newBasename;
          return `${prefix}${rebuildWikiInner(parts.join("/"), parsed)}${suffix}`;
        }
        return `${prefix}${rebuildWikiInner(info.newBasename, parsed)}${suffix}`;
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

  return content.replace(
    regex,
    (match, prefix: string, quote: string, url: string) => {
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
  const wikiIndex = buildWikiRewriteIndex(ctx.pathMap, rootFolderPath);

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

    let rewritten = content;
    rewritten = rewriteMarkdownLinks(rewritten, currentPath, resolveDir, ctx);
    rewritten = rewriteWikiLinks(rewritten, wikiIndex);
    rewritten = rewriteHtmlReferences(rewritten, currentPath, resolveDir, ctx);

    if (rewritten !== content) {
      modifiedFiles.push({ path: file.path, newContent: rewritten });
    }
  }

  return { modifiedFiles };
}
