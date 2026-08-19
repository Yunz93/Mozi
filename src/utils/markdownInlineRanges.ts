import { parseMarkdownDestination } from "./markdownDestination";

/**
 * CommonMark / Lezer stop a bare destination at the first space. These
 * collectors keep the full `![alt](dest)` / `[label](dest)` span, including
 * leading space after `(` and spaces inside the path.
 */
export const MARKDOWN_IMAGE_INLINE_RE =
  /!\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)\n]+)\s*\)/g;
export const MARKDOWN_LINK_INLINE_RE =
  /(?<!!)\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)\n]+)\s*\)/g;

export interface MarkdownInlineRange {
  from: number;
  to: number;
  alt: string;
  url: string;
  urlFrom: number;
  urlTo: number;
}

function collectInlineRanges(
  pattern: RegExp,
  docText: string,
  from: number,
  to: number,
): MarkdownInlineRange[] {
  const slice = docText.slice(from, to);
  const results: MarkdownInlineRange[] = [];
  const re = new RegExp(pattern.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) {
    const full = match[0];
    const alt = match[1] ?? "";
    const destRaw = match[2] ?? "";
    const fullFrom = from + match.index;
    const fullTo = fullFrom + full.length;
    const destOffsetInFull = full.indexOf(destRaw, full.indexOf("("));
    if (destOffsetInFull < 0) continue;

    const parsed = parseMarkdownDestination(destRaw);
    if (!parsed.path) continue;

    const destAbsFrom = fullFrom + destOffsetInFull;
    const pathIndex = destRaw.indexOf(
      parsed.angleBrackets ? `<${parsed.path}` : parsed.path,
    );
    const pathFrom =
      pathIndex >= 0
        ? destAbsFrom + pathIndex + (parsed.angleBrackets ? 1 : 0)
        : destAbsFrom + (destRaw.length - destRaw.trimStart().length);
    const pathTo = pathFrom + parsed.path.length;

    results.push({
      from: fullFrom,
      to: fullTo,
      alt,
      url: parsed.path,
      urlFrom: pathFrom,
      urlTo: pathTo,
    });
  }
  return results;
}

export function collectMarkdownImageRanges(
  docText: string,
  from = 0,
  to = docText.length,
): MarkdownInlineRange[] {
  return collectInlineRanges(MARKDOWN_IMAGE_INLINE_RE, docText, from, to);
}

export function collectMarkdownLinkRanges(
  docText: string,
  from = 0,
  to = docText.length,
): MarkdownInlineRange[] {
  return collectInlineRanges(MARKDOWN_LINK_INLINE_RE, docText, from, to);
}
