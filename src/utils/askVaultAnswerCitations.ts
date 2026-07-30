/**
 * Ask Vault answer citations use `[n]` markers. Models sometimes emit wiki-like
 * `[[n]]` / `[[[n]]]`, and raw `[n][m]` can also be parsed as Markdown
 * reference links when defs exist. Protect markers before renderMarkdown.
 */

const CITE_START = "\uE000";
const CITE_END = "\uE001";

/** Normalize wiki-ish numeric cites to plain `[n]`. */
export function normalizeAskVaultCitationMarkers(markdown: string): string {
  return markdown
    .replace(/\[\[\[(\d+)\]\]\]/g, "[$1]")
    .replace(/\[\[(\d+)\]\]/g, "[$1]");
}

/**
 * Replace `[n]` with private-use placeholders so markdown-it / wikilinks /
 * reference links cannot consume them. Skips fenced code blocks.
 */
export function protectAskVaultCitations(markdown: string): string {
  const normalized = normalizeAskVaultCitationMarkers(markdown);
  const parts: string[] = [];
  let i = 0;
  const fenceRe = /(^|\n)(```|~~~)/g;

  while (i < normalized.length) {
    fenceRe.lastIndex = i;
    const fenceOpen = fenceRe.exec(normalized);
    const nextFence = fenceOpen?.index ?? -1;

    const plainEnd = nextFence === -1 ? normalized.length : nextFence;
    parts.push(
      normalized
        .slice(i, plainEnd)
        .replace(/\[(\d+)\]/g, `${CITE_START}$1${CITE_END}`),
    );

    if (nextFence === -1 || !fenceOpen) {
      break;
    }

    const fenceMarker = fenceOpen[2];
    const afterOpen = fenceOpen.index + fenceOpen[0].length;
    const closeIdx = normalized.indexOf(`\n${fenceMarker}`, afterOpen);
    if (closeIdx === -1) {
      parts.push(normalized.slice(nextFence));
      break;
    }
    const fenceEnd = closeIdx + 1 + fenceMarker.length;
    // Keep fence contents untouched (including any [n] that appear in code).
    parts.push(normalized.slice(nextFence, fenceEnd));
    i = fenceEnd;
  }

  return parts.join("");
}

/** Turn placeholders into styled inline citation anchors (full `[n]` text). */
export function restoreAskVaultCitations(html: string): string {
  return html.replace(
    new RegExp(`${CITE_START}(\\d+)${CITE_END}`, "g"),
    (_match, index: string) =>
      `<a href="#ask-cite-${index}" class="ask-vault-inline-cite" data-ask-cite="${index}">[${index}]</a>`,
  );
}

export function renderAskVaultAnswerHtml(
  markdown: string,
  render: (md: string) => string,
): string {
  if (!markdown.trim()) return "";
  return restoreAskVaultCitations(render(protectAskVaultCitations(markdown)));
}
