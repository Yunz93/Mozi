/**
 * Resolve markdown / wiki / autolink targets under a document position so
 * Live Preview (and revealed source) can open them with Cmd/Ctrl+click.
 */

import type { EditorView } from "@codemirror/view";
import { collectMarkdownLinkRanges } from "../../../utils/markdownInlineRanges";
import { parseWikiLinkReference } from "../../../utils/wikiLinks";
import { livePreviewContextFacet } from "./context";
import { collectWikiLinkRanges, hasSkipAncestor } from "./shared";

export type ClickableEditorLink =
  | { kind: "href"; href: string }
  | { kind: "wiki"; target: string };

const ANGLE_AUTOLINK_RE = /<(https?:\/\/[^>\s]+)>/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>"'\]\}]+/gi;
const TRAILING_URL_PUNCT_RE = /[).,;:!?]+$/;

export function isModMouseEvent(event: MouseEvent): boolean {
  return event.button === 0 && (event.metaKey || event.ctrlKey);
}

function posInRange(pos: number, from: number, to: number): boolean {
  return pos >= from && pos <= to;
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(TRAILING_URL_PUNCT_RE, "");
}

function findAngleAutolinkAt(doc: string, pos: number): string | null {
  const re = new RegExp(ANGLE_AUTOLINK_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(doc)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (posInRange(pos, from, to)) {
      return match[1] ?? null;
    }
  }
  return null;
}

function findBareUrlAt(doc: string, pos: number): string | null {
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  const newline = doc.indexOf("\n", pos);
  const lineEnd = newline < 0 ? doc.length : newline;
  const line = doc.slice(lineStart, lineEnd);
  const re = new RegExp(BARE_URL_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const href = stripTrailingUrlPunctuation(match[0]);
    if (!href) continue;
    const from = lineStart + match.index;
    const to = from + href.length;
    if (posInRange(pos, from, to)) {
      return href;
    }
  }
  return null;
}

/** Link under `pos` (inclusive of both ends so clicks on the last char work). */
export function findClickableEditorLinkAt(
  doc: string,
  pos: number,
): ClickableEditorLink | null {
  if (pos < 0 || pos > doc.length) return null;

  for (const range of collectMarkdownLinkRanges(doc)) {
    if (posInRange(pos, range.from, range.to) && range.url) {
      return { kind: "href", href: range.url };
    }
  }

  for (const range of collectWikiLinkRanges(doc, 0, doc.length)) {
    if (range.embed) continue;
    if (!posInRange(pos, range.from, range.to)) continue;
    const parsed = parseWikiLinkReference(range.raw);
    if (!parsed.target) continue;
    return { kind: "wiki", target: parsed.target };
  }

  const angled = findAngleAutolinkAt(doc, pos);
  if (angled) return { kind: "href", href: angled };

  const bare = findBareUrlAt(doc, pos);
  if (bare) return { kind: "href", href: bare };

  return null;
}

/** Collapsed Live widgets: Cmd/Ctrl+click opens; a plain click places the caret. */
export function bindLivePreviewWidgetModClick(
  el: HTMLElement,
  view: EditorView,
  from: number,
  onOpen: () => void,
): void {
  el.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (isModMouseEvent(event)) return;
    const pos = Math.max(0, Math.min(from, view.state.doc.length));
    view.focus();
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: false,
    });
  });
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isModMouseEvent(event)) return;
    onOpen();
  });
}

export function openClickableEditorLink(
  view: EditorView,
  link: ClickableEditorLink,
): void {
  const ctx = view.state.facet(livePreviewContextFacet);
  if (link.kind === "wiki") {
    void ctx.onOpenWiki?.(link.target);
    return;
  }
  void ctx.onOpenLink?.(link.href);
}

/** Open the clickable link at `pos` when handlers are available. */
export function tryOpenLivePreviewLinkAtPos(
  view: EditorView,
  pos: number,
): boolean {
  const ctx = view.state.facet(livePreviewContextFacet);
  if (!ctx.onOpenLink && !ctx.onOpenWiki) return false;
  if (hasSkipAncestor(view.state, pos)) return false;

  const link = findClickableEditorLinkAt(view.state.doc.toString(), pos);
  if (!link) return false;
  if (link.kind === "wiki" && !ctx.onOpenWiki) return false;
  if (link.kind === "href" && !ctx.onOpenLink) return false;

  openClickableEditorLink(view, link);
  return true;
}

/**
 * Cmd/Ctrl+click: open the markdown, wiki, or autolink under the pointer.
 * Returns true when the event was handled so CodeMirror can skip its default.
 */
export function tryOpenLivePreviewLinkOnModClick(
  event: MouseEvent,
  view: EditorView,
): boolean {
  if (!isModMouseEvent(event)) return false;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return false;
  if (!tryOpenLivePreviewLinkAtPos(view, pos)) return false;
  event.preventDefault();
  return true;
}
