/**
 * GFM tables require contiguous rows (no blank lines) and markdown-it only accepts ASCII `-`
 * in separator cells. Notes often insert blank lines between rows or use typographic dashes (—).
 */

const UNICODE_DASH =
  /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/** Same pipe-row heuristic as markdownFormat (pipe table row, not a lone `|`). */
export function isPotentialMarkdownTableRow(line: string): boolean {
  return /^\s*\|?.+\|.+\|?\s*$/.test(line);
}

function separatorLineToAsciiHyphens(line: string): string {
  return line.replace(UNICODE_DASH, "-");
}

/**
 * True when the line is a GFM table delimiter row (possibly using Unicode dashes).
 */
export function isMarkdownTableSeparatorLine(line: string): boolean {
  const ascii = separatorLineToAsciiHyphens(line);
  return /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(ascii);
}

export function normalizeMarkdownTableSeparatorLine(line: string): string {
  if (!isMarkdownTableSeparatorLine(line)) return line;
  return separatorLineToAsciiHyphens(line);
}

function isMarkdownTablePartLine(line: string): boolean {
  return (
    isPotentialMarkdownTableRow(line) || isMarkdownTableSeparatorLine(line)
  );
}

function collapseBlankLinesBetweenTableRows(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      let j = i;
      while (j < lines.length && lines[j].trim() === "") {
        j += 1;
      }
      const prev = result.length > 0 ? result[result.length - 1] : "";
      const next = j < lines.length ? lines[j] : "";
      // 仅当空行两侧至少一侧紧邻分隔行时才折叠，避免把「绝对值 |x|」这类段落空行吃掉
      if (
        prev &&
        next &&
        isMarkdownTablePartLine(prev) &&
        isMarkdownTablePartLine(next) &&
        (isMarkdownTableSeparatorLine(prev) ||
          isMarkdownTableSeparatorLine(next))
      ) {
        i = j;
        continue;
      }
      result.push(...lines.slice(i, j));
      i = j;
      continue;
    }
    result.push(line);
    i += 1;
  }

  return result;
}

export const FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})/;

function isClosingFenceLine(line: string, fenceMarker: string): boolean {
  const match = line.match(FENCE_OPEN_RE);
  return Boolean(
    match &&
    match[2][0] === fenceMarker[0] &&
    match[2].length >= fenceMarker.length,
  );
}

/** Normalize separator dashes and drop blank lines between GFM-style pipe table rows. */
export function preprocessMarkdownTableLines(lines: string[]): string[] {
  const withSeparators = lines.map((ln) =>
    normalizeMarkdownTableSeparatorLine(ln),
  );
  return collapseBlankLinesBetweenTableRows(withSeparators);
}

/**
 * Preprocess markdown before markdown-it so loosely formatted pipe tables still render.
 * Skips fenced code blocks.
 */
export function normalizeMarkdownTablesForRender(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fenceMarker = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (fenceMarker) {
      out.push(line);
      if (isClosingFenceLine(line, fenceMarker)) {
        fenceMarker = "";
      }
      i += 1;
      continue;
    }

    const open = line.match(FENCE_OPEN_RE);
    if (open) {
      out.push(line);
      fenceMarker = open[2];
      i += 1;
      continue;
    }

    const start = i;
    while (i < lines.length) {
      const ln = lines[i];
      if (FENCE_OPEN_RE.test(ln)) break;
      i += 1;
    }

    out.push(...preprocessMarkdownTableLines(lines.slice(start, i)));
  }

  return out.join("\n");
}
