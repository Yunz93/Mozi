import type { FileNode } from "../types";
import { stripMarkdownDestination } from "./markdownDestination";
import { parseWikiLinkReference } from "./wikiLinks";

export const WIKI_LINK_REGEX = /!?\[\[([^[\]]+)\]\]/g;
export const MARKDOWN_LINK_REGEX = /!?\[[^\]]*]\(\s*(<[^>\n]+>|[^)\n]+)\s*\)/g;
export const HTML_ATTACHMENT_REGEX =
  /<(?:img|audio|video|source|a)\b[^>]+(?:src|href)=["']([^"']+)["']/gi;

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

  for (const match of content.matchAll(WIKI_LINK_REGEX)) {
    const rawReference = match[1]?.trim();
    if (!rawReference) continue;

    const parsed = parseWikiLinkReference(rawReference, { embed: true });
    if (parsed.target) {
      targets.add(parsed.target);
    }
  }

  for (const match of content.matchAll(MARKDOWN_LINK_REGEX)) {
    const target = stripMarkdownDestination(match[1] ?? "");
    if (target) {
      targets.add(target);
    }
  }

  for (const match of content.matchAll(HTML_ATTACHMENT_REGEX)) {
    const target = match[1]?.trim();
    if (target) {
      targets.add(target);
    }
  }

  return Array.from(targets);
}
