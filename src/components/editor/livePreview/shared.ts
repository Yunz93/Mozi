import type {
  ChangeDesc,
  EditorState,
  Extension,
  Transaction,
} from "@codemirror/state";
import { Range, StateField } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { WIKI_LINK_REGEX } from "../../../utils/markdownLinkUtils";
import { LRUCache } from "../../../utils/performance";
import { isWithinFrontmatterBlock } from "../behavior/core";
import { livePreviewContextFacet } from "./context";
import type { LivePreviewContext } from "./context";

const SKIP_ANCESTOR_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "CommentBlock",
  "InlineCode",
]);

export function selectionTouchesRange(
  state: EditorState,
  from: number,
  to: number,
  pad = 0,
): boolean {
  const start = Math.max(0, from - pad);
  const end = Math.min(state.doc.length, to + pad);
  for (const range of state.selection.ranges) {
    if (range.from <= end && range.to >= start) {
      return true;
    }
  }
  return false;
}

/**
 * Skip Live Preview widgets inside constructs that must stay as source text.
 * Also protects YAML frontmatter (including fence lines) so `---` is not
 * replaced by HR widgets and list markers inside tags stay plain YAML.
 */
export function hasSkipAncestor(state: EditorState, pos: number): boolean {
  if (isWithinFrontmatterBlock(state, pos)) {
    return true;
  }
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (let depth = 0; depth < 12 && node; depth += 1) {
    if (SKIP_ANCESTOR_NODES.has(node.name)) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

export interface WikiLinkRange {
  from: number;
  to: number;
  raw: string;
  embed: boolean;
}

/** Collect closed wiki-link / embed ranges overlapping [from, to). */
export function collectWikiLinkRanges(
  text: string,
  from: number,
  to: number,
): WikiLinkRange[] {
  const ranges: WikiLinkRange[] = [];
  const slice = text.slice(from, to);
  const regex = new RegExp(WIKI_LINK_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(slice)) !== null) {
    const absoluteFrom = from + match.index;
    const absoluteTo = absoluteFrom + match[0].length;
    ranges.push({
      from: absoluteFrom,
      to: absoluteTo,
      raw: (match[1] ?? "").trim(),
      embed: match[0].startsWith("!"),
    });
  }
  return ranges;
}

/**
 * Collect wiki ranges near the visible viewport without allocating `doc.toString()`.
 * Cached for the same EditorState + decoration-window signature so hide/images/links
 * plugins in one update do not each re-run the regex.
 */
let visibleWikiCacheState: EditorState | null = null;
let visibleWikiCacheKey = "";
let visibleWikiCacheRanges: WikiLinkRange[] = [];

/** Pad shared by {@link ViewportDecorationWindow} and viewport decoration builders. */
export const LIVE_PREVIEW_VIEWPORT_DECORATION_PAD = 2400;

/**
 * Doc range viewport plugins must decorate. Must match
 * {@link ViewportDecorationWindow} so scroll-within-pad still has Live widgets.
 */
export function getLivePreviewDecorationRange(
  view: Pick<EditorView, "visibleRanges" | "state">,
): { from: number; to: number } {
  return getPaddedVisibleRange(view, LIVE_PREVIEW_VIEWPORT_DECORATION_PAD);
}

export function collectVisibleWikiRanges(
  view: Pick<EditorView, "visibleRanges" | "state">,
  edgePad = 2,
): WikiLinkRange[] {
  const padded = getLivePreviewDecorationRange(view);
  const start = Math.max(0, padded.from - edgePad);
  const end = Math.min(view.state.doc.length, padded.to + edgePad);
  const visKey = `${edgePad}|${start}:${end}`;
  if (visibleWikiCacheState === view.state && visibleWikiCacheKey === visKey) {
    return visibleWikiCacheRanges;
  }

  const text = view.state.doc.sliceString(start, end);
  const ranges: WikiLinkRange[] = [];
  for (const range of collectWikiLinkRanges(text, 0, text.length)) {
    ranges.push({
      from: range.from + start,
      to: range.to + start,
      raw: range.raw,
      embed: range.embed,
    });
  }
  visibleWikiCacheState = view.state;
  visibleWikiCacheKey = visKey;
  visibleWikiCacheRanges = ranges;
  return ranges;
}

/** Furthest doc offset we should ask the markdown parser to cover for viewport plugins. */
export function maxVisibleParseTo(
  view: Pick<EditorView, "visibleRanges" | "state">,
  pad = LIVE_PREVIEW_VIEWPORT_DECORATION_PAD,
): number {
  return getPaddedVisibleRange(view, pad).to;
}

/**
 * Ensure the syntax tree covers the Live Preview decoration window.
 * Prefer a non-blocking parse; if coverage is short, allow a short wait so
 * newly visible nodes are not permanently skipped after window.mark().
 */
export function ensureLivePreviewViewportTree(
  view: Pick<EditorView, "visibleRanges" | "state">,
  parseTo = maxVisibleParseTo(view),
) {
  const { state } = view;
  let tree = ensureSyntaxTree(state, parseTo, 0) ?? syntaxTree(state);
  if (tree.length < parseTo) {
    tree = ensureSyntaxTree(state, parseTo, 20) ?? tree;
  }
  return tree;
}

export function rangesOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/** True when live-preview context facet identity changed (files/theme/callbacks). */
export function livePreviewContextChanged(update: ViewUpdate): boolean {
  return (
    update.startState.facet(livePreviewContextFacet) !==
    update.state.facet(livePreviewContextFacet)
  );
}

/**
 * Decide whether a Live Preview decoration plugin should rebuild for
 * document / selection / syntax changes.
 *
 * Viewport / scroll is intentionally NOT included — use
 * {@link ViewportDecorationWindow} so decorations only rebuild when the
 * visible range escapes a padded window (avoids per-frame scroll jank).
 */
export function livePreviewShouldRebuild(
  update: ViewUpdate,
  mode: "marks" | "widgets" = "widgets",
): boolean {
  if (update.docChanged) return true;
  if (syntaxTree(update.startState) !== syntaxTree(update.state)) return true;
  if (!update.selectionSet) return false;
  if (mode === "marks") return true;

  const prev = update.startState.selection.main;
  const next = update.state.selection.main;
  if (prev.empty !== next.empty) return true;
  if (!next.empty || !prev.empty) return true;
  try {
    const prevLine = update.startState.doc.lineAt(prev.head).number;
    const nextLine = update.state.doc.lineAt(next.head).number;
    return prevLine !== nextLine;
  } catch {
    return true;
  }
}

/**
 * Padded decoration window for viewport-scoped Live Preview plugins.
 * Rebuild only when the visible range leaves the last built pad — not on
 * every scroll tick.
 */
export class ViewportDecorationWindow {
  private from = -1;
  private to = -1;

  constructor(private readonly pad = LIVE_PREVIEW_VIEWPORT_DECORATION_PAD) {}

  /** Last built decoration window (for tests / diagnostics). */
  get range(): { from: number; to: number } {
    return { from: this.from, to: this.to };
  }

  needsUpdate(view: Pick<EditorView, "visibleRanges" | "state">): boolean {
    if (this.from < 0 || this.to < this.from) return true;
    for (const range of view.visibleRanges) {
      if (range.from < this.from || range.to > this.to) return true;
    }
    return false;
  }

  mark(view: Pick<EditorView, "visibleRanges" | "state">): void {
    const padded = getPaddedVisibleRange(view, this.pad);
    this.from = padded.from;
    this.to = padded.to;
  }

  invalidate(): void {
    this.from = -1;
    this.to = -1;
  }
}

/**
 * Combined rebuild gate for viewport-scoped plugins: content/selection changes
 * always rebuild; scroll only when the padded decoration window is exceeded.
 */
export function shouldRebuildLivePreviewDecorations(
  update: ViewUpdate,
  mode: "marks" | "widgets",
  window: ViewportDecorationWindow,
): boolean {
  if (livePreviewShouldRebuild(update, mode)) {
    window.invalidate();
    return true;
  }
  return update.viewportChanged && window.needsUpdate(update.view);
}

/** Viewport union padded for decoration builds. */
export function getPaddedVisibleRange(
  view: Pick<EditorView, "visibleRanges" | "state">,
  pad = LIVE_PREVIEW_VIEWPORT_DECORATION_PAD,
): { from: number; to: number } {
  let from = view.state.doc.length;
  let to = 0;
  for (const range of view.visibleRanges) {
    from = Math.min(from, range.from);
    to = Math.max(to, range.to);
  }
  if (to < from) {
    return { from: 0, to: view.state.doc.length };
  }
  return {
    from: Math.max(0, from - pad),
    to: Math.min(view.state.doc.length, to + pad),
  };
}

const inlineHtmlCache = new LRUCache<string, string>(256);

/** Cache markdown-it HTML for Live Preview widgets. */
export function getCachedMarkdownHtml(
  markdown: string,
  render: (source: string) => string,
  cacheKey = markdown,
): string {
  const cached = inlineHtmlCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const html = render(markdown);
  inlineHtmlCache.set(cacheKey, html);
  return html;
}

export interface CoverageRange {
  from: number;
  to: number;
}

/** Result of a block decoration build: widgets plus candidate coverage for selection gating. */
export interface BlockDecorationBuild {
  decorations: DecorationSet;
  /**
   * All candidate block ranges from the last scan (including selection-suppressed
   * holes). Selection only rebuilds when enter/leave these ranges.
   */
  coverage: readonly CoverageRange[];
}

export function normalizeBlockDecorationBuild(
  result: BlockDecorationBuild | DecorationSet,
): BlockDecorationBuild {
  if (result && typeof result === "object" && "decorations" in result) {
    return result;
  }
  const decorations = result as DecorationSet;
  const coverage: CoverageRange[] = [];
  decorations.between(0, 1e9, (from, to) => {
    coverage.push({ from, to });
  });
  return { decorations, coverage };
}

/** True when selection enter/leave any coverage range (holes + active widgets). */
export function selectionAffectsCoverage(
  startState: EditorState,
  state: EditorState,
  coverage: readonly CoverageRange[],
): boolean {
  for (const range of coverage) {
    const was = selectionTouchesRange(startState, range.from, range.to);
    const now = selectionTouchesRange(state, range.from, range.to);
    if (was !== now) return true;
  }
  return false;
}

function mapCoverage(
  coverage: readonly CoverageRange[],
  changes: ChangeDesc,
): CoverageRange[] {
  const next: CoverageRange[] = [];
  for (const range of coverage) {
    try {
      const from = changes.mapPos(range.from, 1);
      const to = changes.mapPos(range.to, -1);
      if (from < to) next.push({ from, to });
    } catch {
      // Drop ranges that cannot be mapped.
    }
  }
  return next;
}

/**
 * Collect changed document ranges after a transaction (new-doc coordinates).
 * Used for incremental block re-analysis.
 */
export function collectChangedRanges(
  tr: Transaction,
  pad = 0,
): CoverageRange[] {
  if (!tr.docChanged) return [];
  const ranges: CoverageRange[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    ranges.push({
      from: Math.max(0, fromB - pad),
      to: Math.min(tr.state.doc.length, toB + pad),
    });
  });
  return mergeCoverageRanges(ranges);
}

export function mergeCoverageRanges(
  ranges: readonly CoverageRange[],
): CoverageRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: CoverageRange[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.from <= last.to) {
      last.to = Math.max(last.to, cur.to);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Expand changed ranges to whole paragraph / blank-line-delimited blocks.
 */
export function expandRangesToBlocks(
  state: EditorState,
  ranges: readonly CoverageRange[],
): CoverageRange[] {
  const expanded: CoverageRange[] = [];
  for (const range of ranges) {
    let from = range.from;
    let to = range.to;
    try {
      let line = state.doc.lineAt(from);
      while (line.number > 1) {
        const prev = state.doc.line(line.number - 1);
        if (!prev.text.trim()) break;
        line = prev;
      }
      from = line.from;

      line = state.doc.lineAt(Math.max(from, Math.min(to, state.doc.length)));
      while (line.number < state.doc.lines) {
        const next = state.doc.line(line.number + 1);
        if (!next.text.trim()) break;
        line = next;
      }
      to = line.to;
    } catch {
      // keep original
    }
    expanded.push({ from, to });
  }
  return mergeCoverageRanges(expanded);
}

/**
 * CodeMirror forbids `block: true` decorations from ViewPlugins.
 * Provide them from a StateField instead (same pattern as Live Preview tables).
 *
 * Rebuild policy:
 * - Document change → incremental `createInRanges` when provided, else full create.
 * - Context / rebuildOn → full create (or comparator).
 * - Selection → only when caret enters or leaves a coverage range.
 * - Otherwise → map decorations through changes.
 */
export function defineLivePreviewBlockDecorationField(options: {
  create: (state: EditorState) => BlockDecorationBuild | DecorationSet;
  /**
   * Optional ranged rebuild used for incremental doc/selection updates.
   * Must scan only `ranges` (plus any construct wholly inside them).
   */
  createInRanges?: (
    state: EditorState,
    ranges: readonly CoverageRange[],
  ) => BlockDecorationBuild | DecorationSet;
  /** Expand changed ranges before ranged rebuild (default: blank-line blocks). */
  expandChangedRanges?: (
    state: EditorState,
    ranges: readonly CoverageRange[],
  ) => CoverageRange[];
  /** Pad applied to raw changed ranges before expansion. */
  changePad?: number;
  /** Extra rebuild triggers (async resolve effects, etc.) → full create. */
  rebuildOn?: (tr: Transaction) => boolean;
  /**
   * Rebuild when live-preview context facet identity changes (default true).
   * Set false for context-free fields (e.g. math).
   * Or pass a comparator that returns true only when relevant context fields change.
   */
  rebuildOnContextChange?:
    | boolean
    | ((prev: LivePreviewContext, next: LivePreviewContext) => boolean);
  /** Map through changes when not rebuilding (default true). */
  mapWhenIdle?: boolean;
}): Extension {
  const expand =
    options.expandChangedRanges ??
    ((state: EditorState, ranges: readonly CoverageRange[]) =>
      expandRangesToBlocks(state, ranges));

  const field = StateField.define<BlockDecorationBuild>({
    create(state) {
      return normalizeBlockDecorationBuild(options.create(state));
    },
    update(value, tr) {
      const prevCtx = tr.startState.facet(livePreviewContextFacet);
      const nextCtx = tr.state.facet(livePreviewContextFacet);
      let contextChanged = false;
      if (options.rebuildOnContextChange === false) {
        contextChanged = false;
      } else if (typeof options.rebuildOnContextChange === "function") {
        contextChanged =
          prevCtx !== nextCtx &&
          options.rebuildOnContextChange(prevCtx, nextCtx);
      } else {
        contextChanged = prevCtx !== nextCtx;
      }

      const forceFull = contextChanged || options.rebuildOn?.(tr) === true;

      if (forceFull) {
        return normalizeBlockDecorationBuild(options.create(tr.state));
      }

      if (tr.docChanged) {
        if (!options.createInRanges) {
          return normalizeBlockDecorationBuild(options.create(tr.state));
        }
        return rebuildBlockDecorationsIncremental(
          value,
          tr,
          options.createInRanges,
          expand,
          options.changePad ?? 2,
          options.create,
        );
      }

      if (tr.selection) {
        if (
          !selectionAffectsCoverage(tr.startState, tr.state, value.coverage)
        ) {
          return value;
        }
        if (!options.createInRanges) {
          return normalizeBlockDecorationBuild(options.create(tr.state));
        }
        const affected = value.coverage.filter((range) => {
          const was = selectionTouchesRange(
            tr.startState,
            range.from,
            range.to,
          );
          const now = selectionTouchesRange(tr.state, range.from, range.to);
          return was !== now;
        });
        if (affected.length === 0) {
          return normalizeBlockDecorationBuild(options.create(tr.state));
        }
        return spliceBlockDecorationsInRanges(
          value,
          tr.state,
          expand(tr.state, affected),
          options.createInRanges,
          options.create,
        );
      }

      if (options.mapWhenIdle === false) {
        return value;
      }

      return {
        decorations: value.decorations.map(tr.changes),
        coverage: mapCoverage(value.coverage, tr.changes),
      };
    },
    provide: (value) => [
      EditorView.decorations.from(value, (v) => v.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(value).decorations),
    ],
  });
  return field;
}

function rangesOverlapAny(
  from: number,
  to: number,
  ranges: readonly CoverageRange[],
): boolean {
  for (const range of ranges) {
    if (rangesOverlap(from, to, range.from, range.to)) return true;
  }
  return false;
}

function decorationSetToRanges(set: DecorationSet): Range<Decoration>[] {
  const add: Range<Decoration>[] = [];
  set.between(0, 1e9, (from, to, value) => {
    add.push(value.range(from, to));
  });
  return add;
}

function shouldFallbackToFullRebuild(
  state: EditorState,
  invalidate: readonly CoverageRange[],
): boolean {
  if (invalidate.length === 0) return false;
  let span = 0;
  for (const range of invalidate) span += range.to - range.from;
  return (
    span > Math.max(8000, state.doc.length * 0.35) || invalidate.length > 80
  );
}

function spliceBlockDecorationsInRanges(
  value: BlockDecorationBuild,
  state: EditorState,
  invalidate: readonly CoverageRange[],
  createInRanges: (
    state: EditorState,
    ranges: readonly CoverageRange[],
  ) => BlockDecorationBuild | DecorationSet,
  createFull: (state: EditorState) => BlockDecorationBuild | DecorationSet,
): BlockDecorationBuild {
  const ranges = mergeCoverageRanges(invalidate);
  if (ranges.length === 0) return value;
  if (shouldFallbackToFullRebuild(state, ranges)) {
    return normalizeBlockDecorationBuild(createFull(state));
  }

  const filtered = value.decorations.update({
    filter: (from, to) => !rangesOverlapAny(from, to, ranges),
  });
  const keptCoverage = value.coverage.filter(
    (c) => !rangesOverlapAny(c.from, c.to, ranges),
  );
  const partial = normalizeBlockDecorationBuild(createInRanges(state, ranges));
  const decorations = filtered.update({
    add: decorationSetToRanges(partial.decorations),
    sort: true,
  });
  return {
    decorations,
    coverage: mergeCoverageRanges([...keptCoverage, ...partial.coverage]),
  };
}

function rebuildBlockDecorationsIncremental(
  value: BlockDecorationBuild,
  tr: Transaction,
  createInRanges: (
    state: EditorState,
    ranges: readonly CoverageRange[],
  ) => BlockDecorationBuild | DecorationSet,
  expand: (
    state: EditorState,
    ranges: readonly CoverageRange[],
  ) => CoverageRange[],
  changePad: number,
  createFull: (state: EditorState) => BlockDecorationBuild | DecorationSet,
): BlockDecorationBuild {
  const mappedDecorations = value.decorations.map(tr.changes);
  const mappedCoverage = mapCoverage(value.coverage, tr.changes);
  const changed = expand(tr.state, collectChangedRanges(tr, changePad));
  const overlappingCoverage = mappedCoverage.filter((c) =>
    rangesOverlapAny(c.from, c.to, changed),
  );
  const invalidate = expand(
    tr.state,
    mergeCoverageRanges([...changed, ...overlappingCoverage]),
  );

  if (shouldFallbackToFullRebuild(tr.state, invalidate)) {
    return normalizeBlockDecorationBuild(createFull(tr.state));
  }

  return spliceBlockDecorationsInRanges(
    { decorations: mappedDecorations, coverage: mappedCoverage },
    tr.state,
    invalidate,
    createInRanges,
    createFull,
  );
}

/** Empty block build helper. */
export function emptyBlockDecorationBuild(): BlockDecorationBuild {
  return { decorations: Decoration.none, coverage: [] };
}

/**
 * Ask CodeMirror to refresh block height maps after a Live Preview widget
 * changes size asynchronously (image decode, Mermaid SVG, embed HTML, …).
 * Without this, `posAtCoords` can map clicks to the wrong document position.
 *
 * Coalesced per view/frame so bursty image/Mermaid settles do not schedule
 * multiple height-map refreshes during scroll.
 */
const pendingMeasureViews = new WeakSet<EditorView>();

export function scheduleLivePreviewMeasure(view: EditorView): void {
  if (typeof view.requestMeasure !== "function") return;
  if (!view.dom.isConnected) return;
  if (pendingMeasureViews.has(view)) return;
  pendingMeasureViews.add(view);
  requestAnimationFrame(() => {
    pendingMeasureViews.delete(view);
    if (!view.dom.isConnected) return;
    view.requestMeasure();
  });
}

/**
 * Remasure when a widget's laid-out box changes (wrap reflow, async HTML,
 * contenteditable growth). Coalesces to one measure per animation frame.
 * Returns a disconnect function — call it if the widget outlives the node
 * without CM destroying the DOM (rare); MutationObserver cleanup is optional.
 */
export function bindLivePreviewWidgetResizeMeasure(
  view: EditorView,
  root: HTMLElement,
): () => void {
  if (typeof ResizeObserver === "undefined") {
    queueMicrotask(() => scheduleLivePreviewMeasure(view));
    return () => undefined;
  }

  let raf = 0;
  const remasure = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      scheduleLivePreviewMeasure(view);
    });
  };

  const observer = new ResizeObserver(remasure);
  observer.observe(root);
  queueMicrotask(remasure);

  return () => {
    if (raf) window.cancelAnimationFrame(raf);
    observer.disconnect();
  };
}

/**
 * Bind img load/error (and already-complete images) to a remasure.
 * Also remasures once on the next microtask for sync layout settles.
 */
export function bindLivePreviewMediaMeasure(
  view: EditorView,
  root: HTMLElement,
): void {
  const remasure = () => scheduleLivePreviewMeasure(view);
  for (const node of root.querySelectorAll("img")) {
    const img = node as HTMLImageElement;
    if (img.complete) continue;
    img.addEventListener("load", remasure, { once: true });
    img.addEventListener("error", remasure, { once: true });
  }
  queueMicrotask(remasure);
}

/** Convenience for a single Live Preview `<img>` widget. */
export function bindLivePreviewImageMeasure(
  view: EditorView,
  img: HTMLImageElement,
  onSettle?: () => void,
): void {
  const settle = () => {
    onSettle?.();
    scheduleLivePreviewMeasure(view);
  };
  if (img.complete && img.naturalHeight > 0) {
    queueMicrotask(settle);
    return;
  }
  img.addEventListener("load", settle, { once: true });
  img.addEventListener("error", settle, { once: true });
}

/**
 * Generation token for deferred click-to-reveal selection.
 * A later reveal / cancel bumps the token so stale timeouts cannot yank the
 * caret after the user has already clicked elsewhere.
 */
let livePreviewRevealGeneration = 0;

/** Invalidate any pending image/wiki click-to-reveal selection work. */
export function cancelPendingLivePreviewReveals(): void {
  livePreviewRevealGeneration += 1;
}

export function isLivePreviewRevealCurrent(generation: number): boolean {
  return generation === livePreviewRevealGeneration;
}

/**
 * Schedule a click-to-reveal selection after CM's DOM selection flush.
 * Bumps the generation so only the latest scheduled reveal can apply.
 */
export function scheduleLivePreviewReveal(
  view: EditorView,
  apply: (generation: number) => void,
): number {
  const generation = ++livePreviewRevealGeneration;
  window.setTimeout(() => {
    if (!isLivePreviewRevealCurrent(generation)) return;
    if (!view.dom.isConnected) return;
    apply(generation);
  }, 0);
  return generation;
}

/**
 * Remasure height maps when Live Preview mounts, webfonts settle, and the
 * editor scroller width changes (pane resize / readable-line CSS vars).
 * Stale maps leave `posAtCoords` 1–2 lines off under wrapped text + widgets.
 */
export const livePreviewGeometryRemeasure = ViewPlugin.fromClass(
  class {
    private disposed = false;
    private resizeObserver: ResizeObserver | null = null;
    private lastWidth = 0;
    private raf = 0;

    constructor(view: EditorView) {
      scheduleLivePreviewMeasure(view);
      queueMicrotask(() => {
        if (this.disposed || !view.dom.isConnected) return;
        scheduleLivePreviewMeasure(view);
      });
      if (typeof document !== "undefined" && document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (this.disposed || !view.dom.isConnected) return;
          scheduleLivePreviewMeasure(view);
        });
      }

      this.lastWidth = view.scrollDOM.clientWidth;
      if (typeof ResizeObserver === "undefined") return;

      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed || !view.dom.isConnected) return;
        const width = view.scrollDOM.clientWidth;
        if (width === this.lastWidth) return;
        this.lastWidth = width;
        if (this.raf) return;
        this.raf = window.requestAnimationFrame(() => {
          this.raf = 0;
          if (this.disposed || !view.dom.isConnected) return;
          scheduleLivePreviewMeasure(view);
        });
      });
      this.resizeObserver.observe(view.scrollDOM);
    }

    destroy() {
      this.disposed = true;
      if (this.raf) window.cancelAnimationFrame(this.raf);
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    }
  },
);

/**
 * Place a collapsed caret at `from` when clicking a passive replace widget
 * (`ignoreEvent() === true` otherwise leaves the previous selection in place).
 */
export function bindLivePreviewWidgetCaret(
  view: EditorView,
  el: HTMLElement,
  from: number,
): void {
  el.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "a, button, input, textarea, select, [contenteditable='true']",
      )
    ) {
      return;
    }
    cancelPendingLivePreviewReveals();
    event.preventDefault();
    event.stopPropagation();
    const pos = Math.max(0, Math.min(from, view.state.doc.length));
    view.focus();
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: false,
    });
  });
}
