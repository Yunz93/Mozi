import type { FileNode } from "../../types";
import type {
  BacklinkGroup,
  LinkIndexSnapshot,
  WikiOutboundLink,
} from "../../types/vaultIndex";
import { flattenFiles, isMarkdownFile } from "../../utils/markdownLinkUtils";
import {
  extractAndResolveOutboundWikiLinks,
  resolveOutbounds,
} from "../../utils/wikiOutbound";

export function createEmptyLinkIndex(vaultRoot: string): LinkIndexSnapshot {
  return {
    version: 1,
    vaultRoot,
    builtAt: Date.now(),
    outbounds: {},
    inbounds: {},
    unresolved: {},
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function rebuildDerivedMaps(
  outbounds: Record<string, WikiOutboundLink[]>,
): Pick<LinkIndexSnapshot, "inbounds" | "unresolved"> {
  const inbounds: Record<string, string[]> = {};
  const unresolved: Record<string, string[]> = {};

  for (const [sourcePath, links] of Object.entries(outbounds)) {
    const normalizedSource = normalizePath(sourcePath);
    for (const link of links) {
      if (link.resolvedPath) {
        const target = normalizePath(link.resolvedPath);
        const list = inbounds[target] ?? [];
        if (!list.includes(normalizedSource)) {
          list.push(normalizedSource);
        }
        inbounds[target] = list;
      } else {
        const key = link.targetRaw.trim() || link.raw;
        const list = unresolved[key] ?? [];
        if (!list.includes(normalizedSource)) {
          list.push(normalizedSource);
        }
        unresolved[key] = list;
      }
    }
  }

  return { inbounds, unresolved };
}

function listMarkdownPaths(files: FileNode[]): string[] {
  return flattenFiles(files)
    .filter(isMarkdownFile)
    .map((node) => normalizePath(node.path));
}

export async function buildFullLinkIndex(options: {
  files: FileNode[];
  vaultRoot: string;
  readFile: (path: string) => Promise<string>;
  onProgress?: (done: number, total: number, currentPath: string) => void;
  shouldCancel?: () => boolean;
}): Promise<LinkIndexSnapshot> {
  const { files, vaultRoot, readFile, onProgress, shouldCancel } = options;
  const paths = listMarkdownPaths(files);
  const outbounds: Record<string, WikiOutboundLink[]> = {};

  for (let index = 0; index < paths.length; index += 1) {
    if (shouldCancel?.()) {
      break;
    }
    const path = paths[index];
    onProgress?.(index, paths.length, path);
    try {
      const content = await readFile(path);
      outbounds[path] = extractAndResolveOutboundWikiLinks(
        path,
        content,
        files,
        vaultRoot,
      );
    } catch {
      outbounds[path] = [];
    }
  }

  onProgress?.(paths.length, paths.length, "");
  const derived = rebuildDerivedMaps(outbounds);
  return {
    version: 1,
    vaultRoot: normalizePath(vaultRoot),
    builtAt: Date.now(),
    outbounds,
    ...derived,
  };
}

export async function updateFilesInIndex(options: {
  snapshot: LinkIndexSnapshot;
  paths: string[];
  files: FileNode[];
  vaultRoot: string;
  readFile: (path: string) => Promise<string>;
  contentsByPath?: Record<string, string>;
  /** When true, re-resolve all existing outbounds against the new tree. */
  reresolveAll?: boolean;
}): Promise<LinkIndexSnapshot> {
  const {
    snapshot,
    paths,
    files,
    vaultRoot,
    readFile,
    contentsByPath,
    reresolveAll = true,
  } = options;
  const indexablePaths = new Set(listMarkdownPaths(files));
  const outbounds = Object.fromEntries(
    Object.entries(snapshot.outbounds).filter(([path]) =>
      indexablePaths.has(normalizePath(path)),
    ),
  );

  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    if (!indexablePaths.has(path)) continue;
    try {
      const content =
        contentsByPath?.[path] ??
        contentsByPath?.[rawPath] ??
        (await readFile(path));
      outbounds[path] = extractAndResolveOutboundWikiLinks(
        path,
        content,
        files,
        vaultRoot,
      );
    } catch {
      outbounds[path] = [];
    }
  }

  if (reresolveAll) {
    const updated = new Set(paths.map(normalizePath));
    for (const [sourcePath, links] of Object.entries(outbounds)) {
      if (updated.has(sourcePath)) continue;
      outbounds[sourcePath] = resolveOutbounds(
        links.map(({ resolvedPath: _resolved, ...rest }) => rest),
        files,
        vaultRoot,
      );
    }
  }

  const derived = rebuildDerivedMaps(outbounds);
  return {
    ...snapshot,
    vaultRoot: normalizePath(vaultRoot),
    builtAt: Date.now(),
    outbounds,
    ...derived,
  };
}

/**
 * Faster path update that only re-parses the given files and rebuilds derived maps.
 * Does not re-resolve other files' targets (use after content save of those paths).
 */
export async function reindexFileContents(options: {
  snapshot: LinkIndexSnapshot;
  pathContents: Record<string, string>;
  files: FileNode[];
  vaultRoot: string;
}): Promise<LinkIndexSnapshot> {
  const { snapshot, pathContents, files, vaultRoot } = options;
  const indexablePaths = new Set(listMarkdownPaths(files));
  const outbounds = Object.fromEntries(
    Object.entries(snapshot.outbounds).filter(([path]) =>
      indexablePaths.has(normalizePath(path)),
    ),
  );

  for (const [rawPath, content] of Object.entries(pathContents)) {
    const path = normalizePath(rawPath);
    if (!indexablePaths.has(path)) continue;
    outbounds[path] = extractAndResolveOutboundWikiLinks(
      path,
      content,
      files,
      vaultRoot,
    );
  }

  const derived = rebuildDerivedMaps(outbounds);
  return {
    ...snapshot,
    vaultRoot: normalizePath(vaultRoot),
    builtAt: Date.now(),
    outbounds,
    ...derived,
  };
}

export function removeFilesFromIndex(
  snapshot: LinkIndexSnapshot,
  paths: string[],
): LinkIndexSnapshot {
  const removeSet = new Set(paths.map(normalizePath));
  const outbounds = { ...snapshot.outbounds };
  for (const path of removeSet) {
    delete outbounds[path];
  }
  const derived = rebuildDerivedMaps(outbounds);
  return {
    ...snapshot,
    builtAt: Date.now(),
    outbounds,
    ...derived,
  };
}

export function remapPathsInIndex(
  snapshot: LinkIndexSnapshot,
  mapping: Record<string, string>,
): LinkIndexSnapshot {
  const normalizedMapping = Object.fromEntries(
    Object.entries(mapping).map(([from, to]) => [
      normalizePath(from),
      normalizePath(to),
    ]),
  );

  const outbounds: Record<string, WikiOutboundLink[]> = {};
  for (const [sourcePath, links] of Object.entries(snapshot.outbounds)) {
    const nextSource = normalizedMapping[sourcePath] ?? sourcePath;
    outbounds[nextSource] = links.map((link) => ({
      ...link,
      sourcePath: nextSource,
      resolvedPath: link.resolvedPath
        ? (normalizedMapping[normalizePath(link.resolvedPath)] ??
          link.resolvedPath)
        : null,
    }));
  }

  const derived = rebuildDerivedMaps(outbounds);
  return {
    ...snapshot,
    builtAt: Date.now(),
    outbounds,
    ...derived,
  };
}

export function reconcileTreeWithIndex(options: {
  snapshot: LinkIndexSnapshot;
  files: FileNode[];
}): { toAdd: string[]; toRemove: string[] } {
  const current = new Set(listMarkdownPaths(options.files));
  const indexed = new Set(Object.keys(options.snapshot.outbounds));
  const toAdd: string[] = [];
  const toRemove: string[] = [];

  for (const path of current) {
    if (!indexed.has(path)) toAdd.push(path);
  }
  for (const path of indexed) {
    if (!current.has(path)) toRemove.push(path);
  }

  return { toAdd, toRemove };
}

export function getBacklinks(
  snapshot: LinkIndexSnapshot | null,
  path: string | null,
): BacklinkGroup[] {
  if (!snapshot || !path) return [];
  const normalized = normalizePath(path);
  const sources = snapshot.inbounds[normalized] ?? [];
  return sources
    .map((sourcePath) => {
      const links = (snapshot.outbounds[sourcePath] ?? []).filter(
        (link) =>
          link.resolvedPath !== null &&
          normalizePath(link.resolvedPath) === normalized,
      );
      return { sourcePath, links };
    })
    .filter((group) => group.links.length > 0);
}

export function getOutbounds(
  snapshot: LinkIndexSnapshot | null,
  path: string | null,
): WikiOutboundLink[] {
  if (!snapshot || !path) return [];
  return snapshot.outbounds[normalizePath(path)] ?? [];
}

export function getUnresolvedOutbounds(
  snapshot: LinkIndexSnapshot | null,
  path: string | null,
): WikiOutboundLink[] {
  return getOutbounds(snapshot, path).filter(
    (link) => link.resolvedPath === null,
  );
}
