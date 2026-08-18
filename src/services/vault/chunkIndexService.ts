import type { FileNode } from "../../types";
import type { ChunkIndexSnapshot, TextChunk } from "../../types/vaultIndex";
import { flattenFiles, isMarkdownFile } from "../../utils/markdownLinkUtils";
import { chunkMarkdownFile } from "./chunkService";
import { pathMatchesAnyGlob } from "../../utils/pathGlob";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function createEmptyChunkIndex(vaultRoot: string): ChunkIndexSnapshot {
  return {
    version: 1,
    vaultRoot: normalizePath(vaultRoot),
    builtAt: Date.now(),
    byPath: {},
  };
}

export function allChunksFromIndex(
  snapshot: ChunkIndexSnapshot | null,
): TextChunk[] {
  if (!snapshot) return [];
  return Object.values(snapshot.byPath).flat();
}

export async function buildFullChunkIndex(options: {
  files: FileNode[];
  vaultRoot: string;
  readFile: (path: string) => Promise<string>;
  onProgress?: (done: number, total: number, currentPath: string) => void;
  shouldCancel?: () => boolean;
  excludeGlobs?: string[];
}): Promise<ChunkIndexSnapshot> {
  const paths = flattenFiles(options.files)
    .filter(isMarkdownFile)
    .map((node) => normalizePath(node.path))
    .filter(
      (path) =>
        !pathMatchesAnyGlob(path, options.excludeGlobs, options.vaultRoot),
    );
  const byPath: Record<string, TextChunk[]> = {};

  for (let index = 0; index < paths.length; index += 1) {
    if (options.shouldCancel?.()) break;
    const path = paths[index];
    options.onProgress?.(index, paths.length, path);
    try {
      const content = await options.readFile(path);
      byPath[path] = chunkMarkdownFile({
        path,
        vaultRoot: options.vaultRoot,
        content,
      });
    } catch {
      byPath[path] = [];
    }
  }

  options.onProgress?.(paths.length, paths.length, "");
  return {
    version: 1,
    vaultRoot: normalizePath(options.vaultRoot),
    builtAt: Date.now(),
    byPath,
  };
}

export async function upsertChunkPaths(options: {
  snapshot: ChunkIndexSnapshot;
  paths: string[];
  vaultRoot: string;
  readFile: (path: string) => Promise<string>;
  contentsByPath?: Record<string, string>;
  excludeGlobs?: string[];
}): Promise<ChunkIndexSnapshot> {
  const byPath = { ...options.snapshot.byPath };
  for (const rawPath of options.paths) {
    const path = normalizePath(rawPath);
    if (pathMatchesAnyGlob(path, options.excludeGlobs, options.vaultRoot)) {
      delete byPath[path];
      continue;
    }
    try {
      const content =
        options.contentsByPath?.[path] ??
        options.contentsByPath?.[rawPath] ??
        (await options.readFile(path));
      byPath[path] = chunkMarkdownFile({
        path,
        vaultRoot: options.vaultRoot,
        content,
      });
    } catch {
      byPath[path] = [];
    }
  }
  return {
    ...options.snapshot,
    vaultRoot: normalizePath(options.vaultRoot),
    builtAt: Date.now(),
    byPath,
  };
}

export function removeChunkPaths(
  snapshot: ChunkIndexSnapshot,
  paths: string[],
): ChunkIndexSnapshot {
  const byPath = { ...snapshot.byPath };
  for (const path of paths.map(normalizePath)) {
    delete byPath[path];
  }
  return {
    ...snapshot,
    builtAt: Date.now(),
    byPath,
  };
}

function getRelPath(path: string, vaultRoot: string): string {
  const normalizedPath = normalizePath(path);
  const root = normalizePath(vaultRoot).replace(/\/+$/, "");
  if (root && normalizedPath.startsWith(`${root}/`)) {
    return normalizedPath.slice(root.length + 1);
  }
  return normalizedPath;
}

function remapChunk(
  chunk: TextChunk,
  nextPath: string,
  vaultRoot: string,
): TextChunk {
  const relPath = getRelPath(nextPath, vaultRoot);
  const hashIndex = chunk.id.lastIndexOf("#");
  const ordinal = hashIndex >= 0 ? chunk.id.slice(hashIndex + 1) : "0";
  return {
    ...chunk,
    id: `${relPath}#${ordinal}`,
    path: nextPath,
    relPath,
  };
}

/**
 * Remap absolute paths (and derived chunk ids) after rename/move.
 * Returns the next snapshot plus old→new chunk id map for vector remapping.
 */
export function remapPathsInChunkIndex(
  snapshot: ChunkIndexSnapshot,
  mapping: Record<string, string>,
): { snapshot: ChunkIndexSnapshot; idMap: Record<string, string> } {
  const normalizedMapping = Object.fromEntries(
    Object.entries(mapping).map(([from, to]) => [
      normalizePath(from),
      normalizePath(to),
    ]),
  );
  if (Object.keys(normalizedMapping).length === 0) {
    return { snapshot, idMap: {} };
  }

  const byPath: Record<string, TextChunk[]> = {};
  const idMap: Record<string, string> = {};

  for (const [sourcePath, chunks] of Object.entries(snapshot.byPath)) {
    const nextPath = normalizedMapping[sourcePath] ?? sourcePath;
    byPath[nextPath] = chunks.map((chunk) => {
      const next = remapChunk(chunk, nextPath, snapshot.vaultRoot);
      if (chunk.id !== next.id) {
        idMap[chunk.id] = next.id;
      }
      return next;
    });
  }

  return {
    snapshot: {
      ...snapshot,
      builtAt: Date.now(),
      byPath,
    },
    idMap,
  };
}
