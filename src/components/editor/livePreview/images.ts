/**
 * Live Preview image widgets for `![alt](url)` markdown images.
 */

import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import {
  createAttachmentResolverContext,
  resolveAttachmentTarget,
} from "../../../utils/attachmentResolver";
import {
  hasUriScheme,
  normalizeHttpUrlForHtmlAttribute,
} from "../preview/previewMedia";
import {
  getCachedPreviewImageSrc,
  isUsablePreviewDisplaySrc,
  resolvePreviewSource,
} from "../../../utils/previewImageCache";
import { livePreviewImageQueue } from "./asyncQueue";
import { livePreviewContextFacet } from "./context";
import {
  collectVisibleWikiRanges,
  getLivePreviewDecorationRange,
  hasSkipAncestor,
  livePreviewContextChanged,
  rangesOverlap,
  selectionTouchesRange,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
  bindLivePreviewImageMeasure,
  scheduleLivePreviewMeasure,
  scheduleLivePreviewReveal,
  isLivePreviewRevealCurrent,
  cancelPendingLivePreviewReveals,
} from "./shared";

const imageResolvedEffect = StateEffect.define<{
  cacheKey: string;
  src: string;
  failed?: boolean;
}>();

/** Persist natural size across widget remounts to limit scroll/layout thrash. */
const imageNaturalSizeCache = new Map<string, number>();

/**
 * CommonMark ends bare destinations at the first space, so Lezer's Image node
 * truncates URLs like `...(M 記.png)`. Scan the full `![alt](dest)` form instead.
 */
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)\n]+)\s*\)/g;

export interface MarkdownImageRange {
  from: number;
  to: number;
  alt: string;
  url: string;
  urlFrom: number;
  urlTo: number;
}

export function collectMarkdownImageRanges(
  docText: string,
  from = 0,
  to = docText.length,
): MarkdownImageRange[] {
  const slice = docText.slice(from, to);
  const results: MarkdownImageRange[] = [];
  const re = new RegExp(MARKDOWN_IMAGE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice)) !== null) {
    const full = match[0];
    const alt = match[1] ?? "";
    const destRaw = match[2] ?? "";
    const fullFrom = from + match.index;
    const fullTo = fullFrom + full.length;
    const destOffsetInFull = full.indexOf(destRaw, full.indexOf("("));
    if (destOffsetInFull < 0) continue;
    const leading = destRaw.length - destRaw.trimStart().length;
    let url = destRaw.trim();
    let urlFrom = fullFrom + destOffsetInFull + leading;
    let urlTo = urlFrom + url.length;
    if (url.startsWith("<") && url.endsWith(">")) {
      url = url.slice(1, -1).trim();
      urlFrom += 1;
      urlTo -= 1;
    }
    if (!url) continue;
    results.push({ from: fullFrom, to: fullTo, alt, url, urlFrom, urlTo });
  }
  return results;
}

function isDirectDisplaySrc(url: string): boolean {
  return (
    hasUriScheme(url) || url.startsWith("data:") || url.startsWith("blob:")
  );
}

function cacheKeyFor(sourceFilePath: string | null, rawSrc: string): string {
  return `${sourceFilePath ?? ""}::${rawSrc}`;
}

function displaySrcFor(url: string): string {
  return normalizeHttpUrlForHtmlAttribute(url);
}

class MarkdownImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly rawSrc: string,
    readonly resolvedSrc: string | null,
    readonly from: number,
    readonly to: number,
    readonly urlFrom: number,
    readonly urlTo: number,
    readonly failed = false,
  ) {
    super();
  }

  eq(other: MarkdownImageWidget) {
    return (
      this.alt === other.alt &&
      this.rawSrc === other.rawSrc &&
      this.resolvedSrc === other.resolvedSrc &&
      this.from === other.from &&
      this.to === other.to &&
      this.urlFrom === other.urlFrom &&
      this.urlTo === other.urlTo &&
      this.failed === other.failed
    );
  }

  get estimatedHeight() {
    return imageNaturalSizeCache.get(this.rawSrc) ?? 48;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-live-preview-image-wrap";
    wrap.setAttribute("contenteditable", "false");
    wrap.title = this.rawSrc;

    const img = document.createElement("img");
    img.className = "cm-live-preview-image";
    img.alt = this.alt || this.rawSrc;
    img.draggable = false;
    img.loading = "lazy";
    img.decoding = "async";
    const cachedH = imageNaturalSizeCache.get(this.rawSrc);
    if (cachedH && cachedH > 0) {
      img.style.maxHeight = "none";
      // Hint layout before decode so remounts don't collapse then expand.
      img.height = Math.min(cachedH, 2400);
    }
    if (this.resolvedSrc) {
      img.src = this.resolvedSrc;
      bindLivePreviewImageMeasure(view, img, () => {
        wrap.classList.remove("is-loading");
        if (img.naturalHeight > 0) {
          imageNaturalSizeCache.set(this.rawSrc, img.naturalHeight);
        }
      });
      img.addEventListener("error", () => {
        wrap.classList.remove("is-loading");
        wrap.classList.add("is-error");
        wrap.title = `Failed to load: ${this.rawSrc}`;
        scheduleLivePreviewMeasure(view);
      });
    } else if (this.failed) {
      wrap.classList.add("is-error");
      wrap.title = `Failed to resolve: ${this.rawSrc}`;
      queueMicrotask(() => scheduleLivePreviewMeasure(view));
    } else {
      wrap.classList.add("is-loading");
    }
    wrap.appendChild(img);

    const revealSource = () => {
      const urlFrom = this.urlFrom;
      const urlTo = this.urlTo;
      const from = this.from;
      const to = this.to;
      scheduleLivePreviewReveal(view, (generation) => {
        view.focus();
        // Cover the whole image construct so replace widgets drop on rebuild.
        // Selecting a sub-range inside an active replace decoration collapses.
        view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: false,
        });
        if (urlFrom < urlTo) {
          requestAnimationFrame(() => {
            if (!isLivePreviewRevealCurrent(generation)) return;
            if (!view.dom.isConnected) return;
            view.dispatch({
              selection: { anchor: urlFrom, head: urlTo },
              scrollIntoView: false,
            });
          });
        }
      });
    };

    wrap.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      // Drop any prior deferred reveal before this click's reveal runs.
      cancelPendingLivePreviewReveals();
      // Prevent CM from applying a DOM selection inside the replaced range.
      event.preventDefault();
      event.stopPropagation();
    });
    wrap.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Defer past CM's DOM selection flush from this click.
      revealSource();
    });

    return wrap;
  }

  ignoreEvent() {
    // Always handle events on the widget DOM so CM does not turn mousedown
    // into an unexpected document-wide selection.
    return true;
  }
}

export function buildLivePreviewImageDecorations(
  view: EditorView,
  resolvedCache: Map<string, string>,
  scheduleResolve: (cacheKey: string, rawSrc: string) => void,
  failedCache: Set<string> = new Set(),
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const ctx = state.facet(livePreviewContextFacet);
  const wikiRanges = collectVisibleWikiRanges(view, 2);
  const { from: viewportFrom, to: viewportTo } =
    getLivePreviewDecorationRange(view);
  const docText = state.doc.sliceString(viewportFrom, viewportTo);
  const images = collectMarkdownImageRanges(docText, 0, docText.length).map(
    (image) => ({
      ...image,
      from: image.from + viewportFrom,
      to: image.to + viewportFrom,
      urlFrom: image.urlFrom + viewportFrom,
      urlTo: image.urlTo + viewportFrom,
    }),
  );

  images.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;

  for (const image of images) {
    const { from, to, alt, url, urlFrom, urlTo } = image;
    if (from < lastTo) continue;
    if (from >= to) continue;
    if (hasSkipAncestor(state, from)) continue;
    if (selectionTouchesRange(state, from, to)) continue;
    if (wikiRanges.some((w) => rangesOverlap(from, to, w.from, w.to))) {
      continue;
    }

    const key = cacheKeyFor(ctx.sourceFilePath, url);
    let resolvedSrc =
      resolvedCache.get(key) ??
      getCachedPreviewImageSrc(url, ctx.sourceFilePath ?? undefined) ??
      null;
    const failed = !resolvedSrc && failedCache.has(key);

    if (!resolvedSrc && isDirectDisplaySrc(url)) {
      resolvedSrc = displaySrcFor(url);
      resolvedCache.set(key, resolvedSrc);
    } else if (!resolvedSrc && !failed) {
      scheduleResolve(key, url);
    } else if (resolvedSrc && isDirectDisplaySrc(url)) {
      resolvedSrc = displaySrcFor(resolvedSrc);
    }

    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new MarkdownImageWidget(
          alt,
          url,
          resolvedSrc,
          from,
          to,
          urlFrom,
          urlTo,
          failed,
        ),
      }),
    );
    lastTo = to;
  }

  return builder.finish();
}

export const livePreviewImages = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private resolvedCache = new Map<string, string>();
    private failedCache = new Set<string>();
    private readonly viewportWindow = new ViewportDecorationWindow();

    constructor(view: EditorView) {
      this.decorations = this.rebuild(view);
      this.viewportWindow.mark(view);
    }

    private scheduleResolve(
      view: EditorView,
      cacheKey: string,
      rawSrc: string,
    ) {
      if (this.resolvedCache.has(cacheKey) || this.failedCache.has(cacheKey)) {
        return;
      }
      const ctx = view.state.facet(livePreviewContextFacet);
      livePreviewImageQueue.enqueue(cacheKey, async () => {
        try {
          let pathOrSrc = rawSrc;
          if (!hasUriScheme(rawSrc)) {
            const resolverCtx = createAttachmentResolverContext(
              ctx.files,
              ctx.rootFolderPath,
              ctx.sourceFilePath,
            );
            const resolved = await resolveAttachmentTarget(resolverCtx, rawSrc);
            if (resolved?.path) {
              pathOrSrc = resolved.path;
            }
          }
          const displaySrc = await resolvePreviewSource(
            pathOrSrc,
            ctx.sourceFilePath ?? undefined,
          );
          if (!isUsablePreviewDisplaySrc(displaySrc)) {
            throw new Error(`Unusable preview source: ${displaySrc}`);
          }
          const finalSrc = isDirectDisplaySrc(displaySrc)
            ? displaySrcFor(displaySrc)
            : displaySrc;
          this.resolvedCache.set(cacheKey, finalSrc);
          this.failedCache.delete(cacheKey);
          if (view.dom.isConnected) {
            view.dispatch({
              effects: imageResolvedEffect.of({
                cacheKey,
                src: finalSrc,
              }),
            });
          }
        } catch {
          this.failedCache.add(cacheKey);
          if (view.dom.isConnected) {
            view.dispatch({
              effects: imageResolvedEffect.of({
                cacheKey,
                src: "",
                failed: true,
              }),
            });
          }
        }
      });
    }

    private rebuild(view: EditorView) {
      return buildLivePreviewImageDecorations(
        view,
        this.resolvedCache,
        (cacheKey, rawSrc) => this.scheduleResolve(view, cacheKey, rawSrc),
        this.failedCache,
      );
    }

    update(update: ViewUpdate) {
      let resolved = false;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(imageResolvedEffect)) {
            if (effect.value.failed) {
              this.failedCache.add(effect.value.cacheKey);
            } else if (effect.value.src) {
              this.resolvedCache.set(effect.value.cacheKey, effect.value.src);
              this.failedCache.delete(effect.value.cacheKey);
            }
            resolved = true;
          }
        }
      }

      if (livePreviewContextChanged(update)) {
        this.failedCache.clear();
      }

      if (
        resolved ||
        livePreviewContextChanged(update) ||
        // Selection must rebuild immediately so click-to-reveal source works
        // on the same line as the image widget.
        shouldRebuildLivePreviewDecorations(
          update,
          "marks",
          this.viewportWindow,
        )
      ) {
        this.decorations = this.rebuild(update.view);
        this.viewportWindow.mark(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
