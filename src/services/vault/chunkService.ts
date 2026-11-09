import { toForwardSlashes as normalizePath } from "../../utils/pathHelpers";
import { parseFrontmatter } from "../../utils/frontmatter";
import { isMarkdownFile } from "../../utils/markdownLinkUtils";
import {
  createHeadingSlug,
  flattenHeadingNodes,
  parseHeadings,
} from "../../utils/outline";
import type { TextChunk } from "../../types/vaultIndex";

const MIN_CHUNK_CHARS = 40;
const WINDOW_CHARS = 700;
const WINDOW_OVERLAP = 80;

function getRelPath(path: string, vaultRoot: string): string {
  const normalizedPath = normalizePath(path);
  const root = normalizePath(vaultRoot).replace(/\/+$/, "");
  if (root && normalizedPath.startsWith(`${root}/`)) {
    return normalizedPath.slice(root.length + 1);
  }
  return normalizedPath;
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function buildWindowChunks(options: {
  path: string;
  relPath: string;
  body: string;
  bodyStartLine: number;
  titlePath: string[];
  headingAnchor: string | null;
}): TextChunk[] {
  const { path, relPath, body, bodyStartLine, titlePath, headingAnchor } =
    options;
  const trimmed = body.trim();
  if (trimmed.length < MIN_CHUNK_CHARS) return [];

  if (trimmed.length <= WINDOW_CHARS) {
    return [
      {
        id: `${relPath}#0`,
        path,
        relPath,
        titlePath,
        headingAnchor,
        startLine: bodyStartLine,
        endLine: bodyStartLine + Math.max(splitLines(trimmed).length - 1, 0),
        text: trimmed,
        contentHash: hashText(trimmed),
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let offset = 0;
  let ordinal = 0;
  let scannedOffset = 0;
  let precedingLines = 0;
  while (offset < trimmed.length) {
    const end = Math.min(trimmed.length, offset + WINDOW_CHARS);
    const slice = trimmed.slice(offset, end).trim();
    if (slice.length >= MIN_CHUNK_CHARS) {
      // 窗口只向前推进，每个字符最多扫描一次，避免大笔记产生平方级前缀拆分。
      while (scannedOffset < offset) {
        if (trimmed.charCodeAt(scannedOffset) === 10) precedingLines++;
        scannedOffset++;
      }
      const startLine = bodyStartLine + precedingLines;
      const endLine = startLine + Math.max(splitLines(slice).length - 1, 0);
      chunks.push({
        id: `${relPath}#${ordinal}`,
        path,
        relPath,
        titlePath,
        headingAnchor,
        startLine: Math.max(1, startLine),
        endLine: Math.max(1, endLine),
        text: slice,
        contentHash: hashText(slice),
      });
      ordinal += 1;
    }
    if (end >= trimmed.length) break;
    offset = Math.max(offset + 1, end - WINDOW_OVERLAP);
  }
  return chunks;
}

/**
 * Chunk a markdown file by headings; fall back to sliding windows when needed.
 */
export function chunkMarkdownFile(options: {
  path: string;
  vaultRoot: string;
  content: string;
}): TextChunk[] {
  if (!isMarkdownFile({ name: options.path })) return [];
  const path = normalizePath(options.path);
  const relPath = getRelPath(path, options.vaultRoot);
  const { frontmatter, body } = parseFrontmatter(options.content);
  const bodyStartOffset = options.content.length - body.length;
  const bodyStartLine =
    splitLines(options.content.slice(0, bodyStartOffset)).length || 1;
  const noteTitle =
    (typeof frontmatter?.title === "string" && frontmatter.title.trim()) ||
    relPath
      .replace(/\.(md|markdown)$/i, "")
      .split("/")
      .pop() ||
    relPath;

  const headings = flattenHeadingNodes(parseHeadings(options.content));
  if (headings.length === 0) {
    return buildWindowChunks({
      path,
      relPath,
      body,
      bodyStartLine,
      titlePath: [noteTitle],
      headingAnchor: null,
    });
  }

  const lines = splitLines(body);
  const absoluteLines = splitLines(options.content);
  const chunks: TextChunk[] = [];
  let ordinal = 0;

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings[index + 1];
    const startLine = heading.line ?? bodyStartLine;
    const endLine = next?.line ? next.line - 1 : absoluteLines.length;
    const startIdx = Math.max(0, startLine - bodyStartLine);
    const endIdx = Math.max(startIdx, endLine - bodyStartLine);
    const sectionBody = lines
      .slice(startIdx, endIdx + 1)
      .join("\n")
      .trim();
    if (sectionBody.length < MIN_CHUNK_CHARS) continue;

    const titlePath = [noteTitle, heading.text];
    const headingAnchor = createHeadingSlug(heading.text);
    const sectionChunks = buildWindowChunks({
      path,
      relPath,
      body: sectionBody,
      bodyStartLine: startLine,
      titlePath,
      headingAnchor,
    }).map((chunk, windowIndex) => ({
      ...chunk,
      id: `${relPath}#${ordinal + windowIndex}`,
    }));
    chunks.push(...sectionChunks);
    ordinal += sectionChunks.length;
  }

  if (chunks.length === 0) {
    return buildWindowChunks({
      path,
      relPath,
      body,
      bodyStartLine,
      titlePath: [noteTitle],
      headingAnchor: null,
    });
  }

  return chunks;
}

export function diffChunks(
  previous: TextChunk[],
  next: TextChunk[],
): { upsert: TextChunk[]; removeIds: string[] } {
  const prevById = new Map(previous.map((chunk) => [chunk.id, chunk]));
  const nextIds = new Set(next.map((chunk) => chunk.id));
  const upsert: TextChunk[] = [];
  for (const chunk of next) {
    const existing = prevById.get(chunk.id);
    if (!existing || existing.contentHash !== chunk.contentHash) {
      upsert.push(chunk);
    }
  }
  const removeIds = previous
    .map((chunk) => chunk.id)
    .filter((id) => !nextIds.has(id));
  return { upsert, removeIds };
}
