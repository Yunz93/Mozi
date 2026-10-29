import type { FileNode } from "../types";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { stripMarkdownDestination } from "./markdownDestination";
import { parseWikiLinkReference } from "./wikiLinks";

export const WIKI_LINK_REGEX = /!?\[\[([^[\]]+)\]\]/g;
export const MARKDOWN_LINK_REGEX = /!?\[[^\]]*]\(\s*(<[^>\n]+>|[^)\n]+)\s*\)/g;
export const HTML_ATTACHMENT_REGEX =
  /<(?:img|audio|video|source|a)\b[^>]+(?:src|href)=["']([^"']+)["']/gi;

const referenceParser = new MarkdownIt();

export function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) =>
    node.type === "folder"
      ? flattenFiles(node.children ?? [])
      : node.isTrash
        ? []
        : [node],
  );
}

export function isMarkdownFile(node: FileNode): boolean {
  return /\.(md|markdown)$/i.test(node.name);
}

export function extractAttachmentTargets(content: string): string[] {
  const targets = new Set<string>();
  const parsedTargets = new Set<string>();
  const env: { references?: Record<string, { href: string }> } = {};
  const collectParsedTargets = (tokens: Token[]) => {
    for (const token of tokens) {
      const target =
        token.type === "image"
          ? token.attrGet("src")
          : token.type === "link_open"
            ? token.attrGet("href")
            : null;
      if (target) parsedTargets.add(target);
      if (token.children) collectParsedTargets(token.children);
    }
  };
  collectParsedTargets(referenceParser.parse(content, env));
  // 引用定义保守保留，包含未直接使用的定义。
  for (const reference of Object.values(env.references ?? {})) {
    if (reference.href) parsedTargets.add(reference.href);
  }

  for (const match of content.matchAll(WIKI_LINK_REGEX)) {
    const rawReference = match[1]?.trim();
    if (!rawReference) continue;

    const parsed = parseWikiLinkReference(rawReference, { embed: true });
    if (parsed.target) {
      targets.add(parsed.target);
    }
  }

  const rawNormalizedTargets = new Set<string>();
  for (const match of content.matchAll(MARKDOWN_LINK_REGEX)) {
    const target = stripMarkdownDestination(match[1] ?? "");
    if (target) {
      const normalized = referenceParser.normalizeLink(target);
      // 保留既有含空格路径，同时跳过正则在合法嵌套括号内截断的目标。
      if (
        !parsedTargets.has(normalized) &&
        [...parsedTargets].some((full) => full.startsWith(`${normalized})`))
      )
        continue;
      targets.add(target);
      rawNormalizedTargets.add(normalized);
    }
  }

  for (const target of parsedTargets) {
    if (!rawNormalizedTargets.has(target)) targets.add(target);
  }

  for (const match of content.matchAll(HTML_ATTACHMENT_REGEX)) {
    const target = match[1]?.trim();
    if (target) {
      targets.add(target);
    }
  }

  return Array.from(targets);
}
