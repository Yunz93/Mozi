/**
 * Live Preview widgets for `[[wiki]]` links and `![[embed]]` image/note embeds.
 *
 * Decorations come from a StateField (block embeds). Async image/note resolves
 * run through a separate ViewPlugin that scans wiki ranges once — it does not
 * rebuild decorations (avoids a second full-doc decoration pass).
 */

import {
  RangeSetBuilder,
  StateEffect,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  createAttachmentResolverContext,
  resolveAttachmentTarget,
} from "../../../utils/attachmentResolver";
import { isImageAttachment } from "../preview/previewMedia";
import {
  getCachedPreviewImageSrc,
  isUsablePreviewDisplaySrc,
  resolvePreviewSource,
} from "../../../utils/previewImageCache";
import { renderMarkdown } from "../../../utils/markdown";
import {
  extractWikiNoteFragment,
  parseWikiLinkReference,
  resolveWikiLinkFile,
} from "../../../utils/wikiLinks";
import { isLargeEditorState } from "../hooks/codeMirrorHelpers";
import { livePreviewWikiQueue } from "./asyncQueue";
import { livePreviewContextFacet } from "./context";
import {
  collectWikiLinkRanges,
  collectChangedRanges,
  defineLivePreviewBlockDecorationField,
  expandRangesToBlocks,
  getCachedMarkdownHtml,
  hasSkipAncestor,
  livePreviewContextChanged,
  mergeCoverageRanges,
  selectionTouchesRange,
  bindLivePreviewImageMeasure,
  bindLivePreviewMediaMeasure,
  bindLivePreviewWidgetCaret,
  bindLivePreviewWidgetResizeMeasure,
  scheduleLivePreviewMeasure,
  scheduleLivePreviewReveal,
  cancelPendingLivePreviewReveals,
  type BlockDecorationBuild,
  type CoverageRange,
  type WikiLinkRange,
} from "./shared";

const wikiImageResolvedEffect = StateEffect.define<{
  cacheKey: string;
  src: string;
}>();

const NOTE_EMBED_MAX_CHARS = 2400;

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly target: string,
    readonly resolved: boolean,
    readonly from: number,
  ) {
    super();
  }

  eq(other: WikiLinkWidget) {
    return (
      this.label === other.label &&
      this.target === other.target &&
      this.resolved === other.resolved &&
      this.from === other.from
    );
  }

  toDOM(view: EditorView) {
    const el = document.createElement("a");
    el.className = this.resolved
      ? "cm-live-preview-wiki"
      : "cm-live-preview-wiki is-unresolved";
    el.href = "#";
    el.setAttribute("contenteditable", "false");
    el.textContent = this.label;
    el.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const pos = Math.max(0, Math.min(this.from, view.state.doc.length));
      view.focus();
      view.dispatch({
        selection: { anchor: pos },
        scrollIntoView: false,
      });
    });
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ctx = view.state.facet(livePreviewContextFacet);
      void ctx.onOpenWiki?.(this.target);
    });
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

class WikiImageWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly rawSrc: string,
    readonly resolvedSrc: string | null,
    readonly from: number,
    readonly to: number,
    readonly width?: number,
    readonly height?: number,
    readonly failed = false,
  ) {
    super();
  }

  eq(other: WikiImageWidget) {
    return (
      this.label === other.label &&
      this.rawSrc === other.rawSrc &&
      this.resolvedSrc === other.resolvedSrc &&
      this.from === other.from &&
      this.to === other.to &&
      this.width === other.width &&
      this.height === other.height &&
      this.failed === other.failed
    );
  }

  get estimatedHeight() {
    return this.height ?? 48;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-live-preview-image-wrap cm-live-preview-wiki-embed";
    wrap.setAttribute("contenteditable", "false");
    wrap.title = `![[${this.rawSrc}]]`;

    const img = document.createElement("img");
    img.className = "cm-live-preview-image";
    img.alt = this.label;
    img.draggable = false;
    if (this.width) img.style.width = `${this.width}px`;
    if (this.height) img.style.height = `${this.height}px`;
    if (this.resolvedSrc) {
      img.src = this.resolvedSrc;
      bindLivePreviewImageMeasure(view, img, () => {
        wrap.classList.remove("is-loading");
      });
      img.addEventListener("error", () => {
        wrap.classList.remove("is-loading");
        wrap.classList.add("is-error");
        scheduleLivePreviewMeasure(view);
      });
    } else if (this.failed) {
      wrap.classList.add("is-error");
      queueMicrotask(() => scheduleLivePreviewMeasure(view));
    } else {
      wrap.classList.add("is-loading");
    }
    wrap.appendChild(img);

    wrap.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      cancelPendingLivePreviewReveals();
      event.preventDefault();
      event.stopPropagation();
    });
    wrap.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const from = this.from;
      const to = this.to;
      scheduleLivePreviewReveal(view, () => {
        view.focus();
        view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: false,
        });
      });
    });

    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

class WikiNoteEmbedWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly target: string,
    readonly bodyHtml: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: WikiNoteEmbedWidget) {
    return (
      this.title === other.title &&
      this.target === other.target &&
      this.bodyHtml === other.bodyHtml &&
      this.from === other.from
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-preview-note-embed";
    wrap.setAttribute("contenteditable", "false");

    const title = document.createElement("a");
    title.className = "cm-live-preview-note-embed-title";
    title.href = "#";
    title.textContent = this.title;
    title.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    title.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ctx = view.state.facet(livePreviewContextFacet);
      void ctx.onOpenWiki?.(this.target);
    });
    wrap.appendChild(title);

    if (this.bodyHtml.trim()) {
      const body = document.createElement("div");
      body.className = "cm-live-preview-note-embed-body markdown-body";
      body.innerHTML = this.bodyHtml;
      wrap.appendChild(body);
      bindLivePreviewMediaMeasure(view, body);
    } else {
      queueMicrotask(() => scheduleLivePreviewMeasure(view));
    }

    bindLivePreviewWidgetResizeMeasure(view, wrap);
    bindLivePreviewWidgetCaret(view, wrap, this.from);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function cacheKeyFor(sourceFilePath: string | null, raw: string): string {
  return `wiki::${sourceFilePath ?? ""}::${raw}`;
}

async function resolveNoteEmbedHtml(
  view: EditorView,
  raw: string,
  matchedPath: string | null,
): Promise<{ title: string; html: string }> {
  const ctx = view.state.facet(livePreviewContextFacet);
  let content: string | null = null;
  if (matchedPath && ctx.getFileContent) {
    content = await ctx.getFileContent(matchedPath);
  }
  if (!content) {
    return { title: parseWikiLinkReference(raw).displayText, html: "" };
  }
  const fragment = extractWikiNoteFragment(content, raw);
  let markdown = fragment.markdown ?? "";
  if (markdown.length > NOTE_EMBED_MAX_CHARS) {
    markdown = `${markdown.slice(0, NOTE_EMBED_MAX_CHARS).trimEnd()}\n\n…`;
  }
  let html = "";
  try {
    if (markdown.trim()) {
      const renderOpts = {
        themeMode: ctx.themeMode,
        markdownStylePreset: ctx.markdownStylePreset,
        highlighter: ctx.highlighter ?? null,
      };
      const cacheKey = `${markdown}::${ctx.themeMode ?? "light"}::${ctx.markdownStylePreset ?? "nord"}::${ctx.highlighter?.__revision ?? 0}`;
      html = getCachedMarkdownHtml(
        markdown,
        (source) => renderMarkdown(source, renderOpts),
        cacheKey,
      );
    }
  } catch {
    html = "";
  }
  return {
    title: fragment.title || parseWikiLinkReference(raw).displayText,
    html,
  };
}

const noteEmbedCache = new Map<string, { title: string; html: string }>();
const wikiImageResolvedCache = new Map<string, string>();
const wikiImageFailedCache = new Set<string>();

function noteEmbedCacheKey(
  sourceFilePath: string | null | undefined,
  matchedPath: string | null | undefined,
  raw: string,
  ctx: {
    themeMode?: string | null;
    markdownStylePreset?: string | null;
    highlighter?: { __revision?: number } | null;
  },
): string {
  // Include render inputs — note HTML is theme/style/highlighter-sensitive.
  return `note::${sourceFilePath ?? ""}::${matchedPath ?? ""}::${raw}::${ctx.themeMode ?? "light"}::${ctx.markdownStylePreset ?? "nord"}::${ctx.highlighter?.__revision ?? 0}`;
}

/** Drop Live Preview wiki embed/image caches (e.g. after target note edits). */
export function clearLivePreviewWikiCaches(): void {
  noteEmbedCache.clear();
  wikiImageResolvedCache.clear();
  wikiImageFailedCache.clear();
}

/** Invalidate caches that may reference a specific vault path. */
export function invalidateLivePreviewWikiCachesForPath(path: string): void {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  const pathTail = norm.split("/").pop() ?? norm;

  for (const key of [...noteEmbedCache.keys()]) {
    const lower = key.toLowerCase();
    if (lower.includes(norm) || (pathTail && lower.includes(pathTail))) {
      noteEmbedCache.delete(key);
    }
  }
  for (const key of [...wikiImageResolvedCache.keys()]) {
    const lower = key.toLowerCase();
    if (lower.includes(norm) || (pathTail && lower.includes(pathTail))) {
      wikiImageResolvedCache.delete(key);
    }
  }
  // Failed image lookups should always be allowed to retry after vault changes.
  wikiImageFailedCache.clear();
}

/** Test helper — seed caches without going through async resolve. */
export function seedLivePreviewWikiCachesForTest(options: {
  noteKey?: string;
  imageKey?: string;
  failedKey?: string;
}): void {
  if (options.noteKey) {
    noteEmbedCache.set(options.noteKey, { title: "t", html: "<p>x</p>" });
  }
  if (options.imageKey) {
    wikiImageResolvedCache.set(options.imageKey, "blob:test");
  }
  if (options.failedKey) {
    wikiImageFailedCache.add(options.failedKey);
  }
}

export function livePreviewWikiCacheStatsForTest(): {
  notes: number;
  images: number;
  failed: number;
} {
  return {
    notes: noteEmbedCache.size,
    images: wikiImageResolvedCache.size,
    failed: wikiImageFailedCache.size,
  };
}

export interface WikiAsyncJob {
  kind: "image" | "note";
  cacheKey: string;
  pathHint: string | null;
  raw: string;
}

/** Collect wiki async jobs without building decorations (single-scan helper). */
export function collectWikiAsyncJobs(
  state: EditorState,
  scanRanges?: readonly CoverageRange[],
): WikiAsyncJob[] {
  if (isLargeEditorState(state)) return [];
  const jobs: WikiAsyncJob[] = [];
  const ctx = state.facet(livePreviewContextFacet);
  const ranges = scanRanges?.length
    ? scanRanges.flatMap((scan) => {
        const from = Math.max(0, scan.from);
        const to = Math.min(state.doc.length, scan.to);
        if (from >= to) return [];
        const text = state.doc.sliceString(from, to);
        return collectWikiLinkRanges(text, 0, text.length).map((range) => ({
          ...range,
          from: range.from + from,
          to: range.to + from,
        }));
      })
    : (() => {
        const docText = state.doc.toString();
        return collectWikiLinkRanges(docText, 0, docText.length);
      })();

  for (const range of ranges) {
    if (!range.raw || !range.embed) continue;
    if (hasSkipAncestor(state, range.from)) continue;

    const parsed = parseWikiLinkReference(range.raw, { embed: true });
    const matched = resolveWikiLinkFile(
      ctx.files,
      parsed.path || parsed.target,
      ctx.rootFolderPath,
      ctx.sourceFilePath,
    );
    const looksLikeImage =
      isImageAttachment(parsed.path) ||
      isImageAttachment(parsed.target) ||
      (matched ? isImageAttachment(matched.name) : false);

    if (looksLikeImage) {
      const key = cacheKeyFor(ctx.sourceFilePath, range.raw);
      if (
        wikiImageResolvedCache.has(key) ||
        wikiImageFailedCache.has(key) ||
        getCachedPreviewImageSrc(
          matched?.path ?? (parsed.path || parsed.target),
          ctx.sourceFilePath ?? undefined,
        )
      ) {
        continue;
      }
      jobs.push({
        kind: "image",
        cacheKey: key,
        pathHint: matched?.path ?? (parsed.path || parsed.target),
        raw: range.raw,
      });
      continue;
    }

    const noteKey = noteEmbedCacheKey(
      ctx.sourceFilePath,
      matched?.path ?? null,
      range.raw,
      ctx,
    );
    if (noteEmbedCache.has(noteKey)) continue;
    jobs.push({
      kind: "note",
      cacheKey: noteKey,
      pathHint: matched?.path ?? null,
      raw: range.raw,
    });
  }

  return jobs;
}

function iterWikiRanges(
  state: EditorState,
  scanRanges?: readonly CoverageRange[],
): WikiLinkRange[] {
  if (!scanRanges || scanRanges.length === 0) {
    const docText = state.doc.toString();
    return collectWikiLinkRanges(docText, 0, docText.length);
  }
  const out: WikiLinkRange[] = [];
  for (const scan of scanRanges) {
    const from = Math.max(0, scan.from);
    const to = Math.min(state.doc.length, scan.to);
    if (from >= to) continue;
    const text = state.doc.sliceString(from, to);
    for (const range of collectWikiLinkRanges(text, 0, text.length)) {
      out.push({
        ...range,
        from: range.from + from,
        to: range.to + from,
      });
    }
  }
  return out;
}

export function buildWikiDecorations(
  state: EditorState,
  resolvedCache: Map<string, string> = wikiImageResolvedCache,
  scanRanges?: readonly CoverageRange[],
): BlockDecorationBuild {
  const coverage: CoverageRange[] = [];
  if (isLargeEditorState(state)) {
    return { decorations: Decoration.none, coverage };
  }

  const builder = new RangeSetBuilder<Decoration>();
  const ctx = state.facet(livePreviewContextFacet);
  const ranges = iterWikiRanges(
    state,
    scanRanges ?? [{ from: 0, to: state.doc.length }],
  );

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;

  for (const range of ranges) {
    if (range.from < lastTo) continue;
    if (hasSkipAncestor(state, range.from)) continue;
    if (!range.raw) continue;

    coverage.push({ from: range.from, to: range.to });
    if (selectionTouchesRange(state, range.from, range.to)) {
      lastTo = range.to;
      continue;
    }

    const parsed = parseWikiLinkReference(range.raw, { embed: range.embed });
    const matched = resolveWikiLinkFile(
      ctx.files,
      parsed.path || parsed.target,
      ctx.rootFolderPath,
      ctx.sourceFilePath,
    );

    if (range.embed) {
      const looksLikeImage =
        isImageAttachment(parsed.path) ||
        isImageAttachment(parsed.target) ||
        (matched ? isImageAttachment(matched.name) : false);

      if (looksLikeImage) {
        const key = cacheKeyFor(ctx.sourceFilePath, range.raw);
        const pathHint = matched?.path ?? (parsed.path || parsed.target);
        const resolvedSrc =
          resolvedCache.get(key) ??
          getCachedPreviewImageSrc(pathHint, ctx.sourceFilePath ?? undefined) ??
          null;
        const failed = !resolvedSrc && wikiImageFailedCache.has(key);

        builder.add(
          range.from,
          range.to,
          Decoration.replace({
            widget: new WikiImageWidget(
              parsed.displayText,
              range.raw,
              resolvedSrc,
              range.from,
              range.to,
              parsed.embedSize?.width,
              parsed.embedSize?.height,
              failed,
            ),
          }),
        );
        lastTo = range.to;
        continue;
      }

      const noteKey = noteEmbedCacheKey(
        ctx.sourceFilePath,
        matched?.path ?? null,
        range.raw,
        ctx,
      );
      const cached = noteEmbedCache.get(noteKey);

      builder.add(
        range.from,
        range.to,
        Decoration.replace({
          widget: new WikiNoteEmbedWidget(
            cached?.title ?? parsed.displayText,
            parsed.target,
            cached?.html ?? "",
            range.from,
          ),
          block: true,
        }),
      );
      lastTo = range.to;
      continue;
    }

    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        widget: new WikiLinkWidget(
          parsed.displayText,
          parsed.target,
          Boolean(matched),
          range.from,
        ),
      }),
    );
    lastTo = range.to;
  }

  return { decorations: builder.finish(), coverage };
}

/** Test/helper wrapper. */
export function buildLivePreviewWikiDecorations(
  view: EditorView,
  resolvedCache: Map<string, string> = wikiImageResolvedCache,
): DecorationSet {
  return buildWikiDecorations(view.state, resolvedCache).decorations;
}

const wikiDecorationsField = defineLivePreviewBlockDecorationField({
  create: (state) => buildWikiDecorations(state),
  createInRanges: (state, ranges) =>
    buildWikiDecorations(state, undefined, ranges),
  rebuildOn: (tr) =>
    tr.effects.some((effect) => effect.is(wikiImageResolvedEffect)),
  rebuildOnContextChange: (prev, next) =>
    prev.files !== next.files ||
    prev.rootFolderPath !== next.rootFolderPath ||
    prev.sourceFilePath !== next.sourceFilePath ||
    prev.themeMode !== next.themeMode ||
    prev.markdownStylePreset !== next.markdownStylePreset ||
    prev.highlighter !== next.highlighter,
});

/** Coalesce bursty async resolves into one decoration rebuild. */
let pendingWikiEffects: Array<ReturnType<typeof wikiImageResolvedEffect.of>> =
  [];
let pendingWikiView: EditorView | null = null;
let wikiEffectFlushScheduled = false;

function dispatchWikiResolvedEffect(
  view: EditorView,
  effect: ReturnType<typeof wikiImageResolvedEffect.of>,
): void {
  pendingWikiEffects.push(effect);
  pendingWikiView = view;
  if (wikiEffectFlushScheduled) return;
  wikiEffectFlushScheduled = true;
  queueMicrotask(() => {
    wikiEffectFlushScheduled = false;
    const target = pendingWikiView;
    const effects = pendingWikiEffects;
    pendingWikiEffects = [];
    pendingWikiView = null;
    if (!target || !target.dom.isConnected || effects.length === 0) return;
    target.dispatch({ effects });
  });
}

const wikiAsyncPlugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      for (const job of collectWikiAsyncJobs(view.state)) {
        this.enqueueJob(view, job);
      }
    }

    update(update: ViewUpdate) {
      if (livePreviewContextChanged(update)) {
        // File tree / theme / source path churn — allow failed images to retry
        // and drop stale note embeds keyed by previous tree.
        wikiImageFailedCache.clear();
      }
      // Schedule on mount (constructor), doc edits, and context changes only.
      // Skip async-resolve effects — they do not invent new wiki embeds.
      // On doc change, scan only expanded changed blocks.
      if (update.docChanged) {
        const ranges: CoverageRange[] = [];
        for (const tr of update.transactions) {
          if (!tr.docChanged) continue;
          for (const range of expandRangesToBlocks(
            tr.state,
            collectChangedRanges(tr, 4),
          )) {
            ranges.push(range);
          }
        }
        const merged = mergeCoverageRanges(ranges);
        for (const job of collectWikiAsyncJobs(
          update.state,
          merged.length ? merged : undefined,
        )) {
          this.enqueueJob(update.view, job);
        }
        return;
      }
      if (livePreviewContextChanged(update)) {
        for (const job of collectWikiAsyncJobs(update.state)) {
          this.enqueueJob(update.view, job);
        }
      }
    }

    private enqueueJob(view: EditorView, job: WikiAsyncJob) {
      if (job.kind === "image") {
        const pathHint = job.pathHint ?? job.raw;
        livePreviewWikiQueue.enqueue(job.cacheKey, async () => {
          const ctx = view.state.facet(livePreviewContextFacet);
          try {
            const resolverCtx = createAttachmentResolverContext(
              ctx.files,
              ctx.rootFolderPath,
              ctx.sourceFilePath,
            );
            const resolved = await resolveAttachmentTarget(
              resolverCtx,
              pathHint,
            );
            const pathOrSrc = resolved?.path ?? pathHint;
            const displaySrc = await resolvePreviewSource(
              pathOrSrc,
              ctx.sourceFilePath ?? undefined,
            );
            if (!isUsablePreviewDisplaySrc(displaySrc)) {
              throw new Error(`Unusable preview source: ${displaySrc}`);
            }
            wikiImageResolvedCache.set(job.cacheKey, displaySrc);
            wikiImageFailedCache.delete(job.cacheKey);
            if (view.dom.isConnected) {
              dispatchWikiResolvedEffect(
                view,
                wikiImageResolvedEffect.of({
                  cacheKey: job.cacheKey,
                  src: displaySrc,
                }),
              );
            }
          } catch {
            wikiImageFailedCache.add(job.cacheKey);
            if (view.dom.isConnected) {
              dispatchWikiResolvedEffect(
                view,
                wikiImageResolvedEffect.of({
                  cacheKey: job.cacheKey,
                  src: "",
                }),
              );
            }
          }
        });
      } else {
        livePreviewWikiQueue.enqueue(job.cacheKey, async () => {
          try {
            const result = await resolveNoteEmbedHtml(
              view,
              job.raw,
              job.pathHint,
            );
            noteEmbedCache.set(job.cacheKey, result);
            if (view.dom.isConnected) {
              dispatchWikiResolvedEffect(
                view,
                wikiImageResolvedEffect.of({
                  cacheKey: job.cacheKey,
                  src: "note",
                }),
              );
            }
          } catch {
            // Leave empty embed body.
          }
        });
      }
    }
  },
);

export const livePreviewWiki = [wikiDecorationsField, wikiAsyncPlugin];
