import type { FileNode } from "../types";
import { parseFrontmatter } from "./frontmatter";
import { createHeadingSlug } from "./outline";

export type WikiSubpathType = "heading" | "block" | null;

export interface ParsedWikiLinkReference {
  raw: string;
  target: string;
  displayText: string;
  path: string;
  subpath: string;
  subpathType: WikiSubpathType;
  embedSize: {
    width?: number;
    height?: number;
  } | null;
}

interface ExtractedNoteFragment {
  markdown: string | null;
  title: string;
}

const BLOCK_REFERENCE_REGEX = /^\s*\^([A-Za-z0-9_-]+)\s*$/;

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(md|markdown)$/i, "");
}

function parseEmbedSize(
  rawAlias: string,
): ParsedWikiLinkReference["embedSize"] {
  const trimmed = rawAlias.trim();
  if (!trimmed) return null;

  const exactMatch = trimmed.match(/^(\d+)(?:x(\d+))?$/i);
  if (!exactMatch) return null;

  const width = Number(exactMatch[1]);
  const height = exactMatch[2] ? Number(exactMatch[2]) : undefined;
  return {
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
  };
}

function normalizeWikiLinkTarget(target: string): string {
  return stripMarkdownExtension(
    normalizeSlashes(target).replace(/^\/+/, "").replace(/^\.\//, "").trim(),
  ).toLowerCase();
}

function getRelativePath(
  path: string,
  rootPath: string | null | undefined,
): string {
  const normalizedPath = normalizeSlashes(path);
  const normalizedRoot = rootPath
    ? normalizeSlashes(rootPath).replace(/\/+$/, "")
    : "";

  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

const flattenCache = new WeakMap<FileNode[], FileNode[]>();

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const cached = flattenCache.get(nodes);
  if (cached) return cached;
  const result = nodes.flatMap((node) => {
    if (node.type === "folder") {
      return flattenFiles(node.children ?? []);
    }

    return node.isTrash ? [] : [node];
  });
  flattenCache.set(nodes, result);
  return result;
}

function splitMarkdownLines(markdown: string): string[] {
  return markdown.split(/\r?\n/);
}

function stripStandaloneBlockReferenceLines(markdown: string): string {
  return splitMarkdownLines(markdown)
    .filter((line) => !BLOCK_REFERENCE_REGEX.test(line))
    .join("\n")
    .trim();
}

function buildHeadingTitle(
  path: string,
  subpath: string,
  body: string,
): string {
  if (subpath.trim()) {
    return subpath.trim().replace(/^\^/, "");
  }

  if (path.trim()) {
    return stripMarkdownExtension(
      path.split("/").filter(Boolean).pop() || path.trim(),
    );
  }

  const firstHeading = splitMarkdownLines(body)
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+/.test(line));

  return firstHeading
    ? firstHeading.replace(/^#{1,6}\s+/, "").trim()
    : "Embedded note";
}

function extractHeadingSection(
  body: string,
  rawSubpath: string,
): string | null {
  const normalizedCandidates = new Set([
    rawSubpath.trim(),
    createHeadingSlug(rawSubpath.trim()),
  ]);
  const lines = splitMarkdownLines(body);
  let startIndex = -1;
  let headingLevel = 7;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;

    const level = match[1].length;
    const title = match[2].trim();
    const slug = createHeadingSlug(title);

    if (normalizedCandidates.has(title) || normalizedCandidates.has(slug)) {
      startIndex = index;
      headingLevel = level;
      break;
    }
  }

  if (startIndex < 0) return null;

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;

    const level = match[1].length;
    if (level <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trim();
}

function extractBlockSection(body: string, blockId: string): string | null {
  const lines = splitMarkdownLines(body);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(BLOCK_REFERENCE_REGEX);
    if (!match || match[1] !== blockId) continue;

    let startIndex = index - 1;
    while (startIndex >= 0) {
      const line = lines[startIndex];
      if (!line.trim()) {
        startIndex += 1;
        break;
      }
      if (startIndex !== index - 1 && /^\s*#{1,6}\s+/.test(line)) {
        startIndex += 1;
        break;
      }
      startIndex -= 1;
    }

    const safeStartIndex = Math.max(0, startIndex);
    return lines.slice(safeStartIndex, index).join("\n").trim();
  }

  return null;
}

export function parseWikiLinkReference(
  raw: string,
  options?: { embed?: boolean },
): ParsedWikiLinkReference {
  const [targetPart = "", aliasPart = ""] = raw.split("|");
  const target = targetPart.trim();
  const alias = aliasPart.trim();
  const hashIndex = target.indexOf("#");
  const path = hashIndex >= 0 ? target.slice(0, hashIndex).trim() : target;
  const subpath = hashIndex >= 0 ? target.slice(hashIndex + 1).trim() : "";
  const subpathType: WikiSubpathType = !subpath
    ? null
    : subpath.startsWith("^")
      ? "block"
      : "heading";
  const embedSize = options?.embed ? parseEmbedSize(alias) : null;
  const cleanedPath = stripMarkdownExtension(
    path.split("/").filter(Boolean).pop() || path,
  );
  const fallbackLabel =
    subpathType === "block"
      ? subpath.replace(/^\^/, "")
      : subpath || cleanedPath || "Untitled";
  const displayText = alias && !embedSize ? alias : fallbackLabel;

  return {
    raw,
    target,
    displayText,
    path,
    subpath,
    subpathType,
    embedSize,
  };
}

export function buildWikiReferenceTarget(
  reference: Pick<ParsedWikiLinkReference, "subpath" | "subpathType">,
): string | null {
  if (!reference.subpath.trim()) return null;
  return reference.subpathType === "block"
    ? `^${reference.subpath.replace(/^\^/, "").trim()}`
    : reference.subpath.trim();
}

export function extractWikiNoteFragment(
  content: string,
  rawReference: string,
): ExtractedNoteFragment {
  const parsedReference = parseWikiLinkReference(rawReference);
  const { body } = parseFrontmatter(content);

  if (!parsedReference.subpathType) {
    return {
      markdown: stripStandaloneBlockReferenceLines(body),
      title: buildHeadingTitle(
        parsedReference.path,
        parsedReference.subpath,
        body,
      ),
    };
  }

  const fragment =
    parsedReference.subpathType === "block"
      ? extractBlockSection(body, parsedReference.subpath.replace(/^\^/, ""))
      : extractHeadingSection(body, parsedReference.subpath);

  return {
    markdown: fragment ? stripStandaloneBlockReferenceLines(fragment) : null,
    title: buildHeadingTitle(
      parsedReference.path,
      parsedReference.subpath,
      body,
    ),
  };
}

export function resolveWikiLinkFile(
  files: FileNode[],
  target: string,
  rootFolderPath?: string | null,
  currentFilePath?: string | null,
): FileNode | null {
  const parsedReference = parseWikiLinkReference(target);
  const normalizedTarget = normalizeWikiLinkTarget(parsedReference.path);
  if (!normalizedTarget) return null;

  const targetBasename =
    normalizedTarget.split("/").filter(Boolean).pop() || normalizedTarget;

  const allFiles = flattenFiles(files);
  const currentRelativePath =
    currentFilePath && rootFolderPath
      ? getRelativePath(currentFilePath, rootFolderPath)
      : "";
  const currentDir = currentRelativePath.includes("/")
    ? currentRelativePath.split("/").slice(0, -1).join("/")
    : "";
  const relativeCandidate = currentDir
    ? `${currentDir}/${normalizedTarget}`
    : normalizedTarget;

  let exactPathMatch: FileNode | null = null;
  let relativePathMatch: FileNode | null = null;
  const suffixMatches: FileNode[] = [];
  const basenameMatches: FileNode[] = [];

  for (const file of allFiles) {
    const relativePath = stripMarkdownExtension(
      getRelativePath(file.path, rootFolderPath),
    ).toLowerCase();
    const basename = stripMarkdownExtension(file.name).toLowerCase();

    if (!exactPathMatch && relativePath === normalizedTarget) {
      exactPathMatch = file;
    }

    if (
      !relativePathMatch &&
      relativePath === relativeCandidate.toLowerCase()
    ) {
      relativePathMatch = file;
    } else if (relativePath.endsWith(`/${normalizedTarget}`)) {
      suffixMatches.push(file);
    }

    if (basename === normalizedTarget || basename === targetBasename) {
      basenameMatches.push(file);
    }
  }

  const suffixMatch = suffixMatches.length === 1 ? suffixMatches[0] : null;
  const basenameMatch =
    basenameMatches.length === 1 ? basenameMatches[0] : null;

  return exactPathMatch || relativePathMatch || suffixMatch || basenameMatch;
}
