import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

const CALLOUT_START = /^\[!([A-Za-z0-9_-]+)\][+-]?\s*(.*)$/;

function firstInlineInBlockquote(
  tokens: Token[],
  openIndex: number,
): Token | null {
  for (let i = openIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "blockquote_close") return null;
    if (token.type === "inline" && token.content.trim()) return token;
  }
  return null;
}

/**
 * Turn Obsidian/GitHub `> [!note] Title` blockquotes into styled callouts
 * so preview, PDF, long image, and blog HTML match Live Preview.
 */
export function markdownItCallouts(md: MarkdownIt): void {
  md.core.ruler.after("block", "obsidian_callouts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].type !== "blockquote_open") continue;
      const inline = firstInlineInBlockquote(tokens, i);
      if (!inline) continue;
      const firstLine = inline.content.split(/\r?\n/, 1)[0] ?? "";
      const match = firstLine.trim().match(CALLOUT_START);
      if (!match) continue;

      const type = match[1].toLowerCase();
      const title = (match[2] ?? "").trim() || type;
      tokens[i].attrJoin("class", `mp-callout mp-callout-${type}`);
      tokens[i].attrSet("data-callout", type);

      const rest = inline.content.replace(/^[^\n]*\n?/, "");
      inline.content = rest;
      inline.children = md.parseInline(rest, state.env)[0]?.children ?? [];

      const titleOpen = new state.Token("html_block", "", 0);
      titleOpen.content = `<div class="mp-callout-title">${md.utils.escapeHtml(title)}</div>`;
      tokens.splice(i + 1, 0, titleOpen);
      i += 1;
    }
  });
}
