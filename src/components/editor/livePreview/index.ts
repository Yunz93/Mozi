import type { Extension } from "@codemirror/state";
import {
  EMPTY_LIVE_PREVIEW_CONTEXT,
  livePreviewContextFacet,
  type LivePreviewContext,
} from "./context";
import {
  livePreviewHideFormatting,
  livePreviewTheme,
} from "./hideFormattingMarks";
import { livePreviewImages } from "./images";
import { livePreviewMath } from "./math";
import { livePreviewTaskCheckboxes } from "./taskCheckboxes";
import { livePreviewWiki } from "./wiki";
import { livePreviewTables } from "./tables";
import { livePreviewCallouts } from "./callouts";
import { livePreviewMermaid } from "./mermaid";
import {
  livePreviewBlockquotes,
  livePreviewHighlights,
  livePreviewListMarkers,
} from "./listAndHighlight";
import { livePreviewLinks } from "./links";
import { livePreviewGeometryRemeasure } from "./shared";

export type { LivePreviewContext };
export { EMPTY_LIVE_PREVIEW_CONTEXT, livePreviewContextFacet };

/** Context facet only — update without remounting Live Preview plugins. */
export function createLivePreviewContextExtension(
  context: LivePreviewContext = EMPTY_LIVE_PREVIEW_CONTEXT,
): Extension {
  return livePreviewContextFacet.of(context);
}

/**
 * Stable Live Preview extensions, grouped into three pipelines:
 * 1) Viewport inline marks/widgets (hide marks, tasks, lists, links, images)
 * 2) Incremental block index (math, wiki, tables, callouts, mermaid, highlights StateFields)
 * 3) Async resource queues (image/wiki resolve plugins attached to those modules)
 *
 * Keep these in a separate compartment from context so file-tree / callback
 * churn does not destroy widgets and yank scroll/caret on click.
 */
export function createLivePreviewPluginExtensions(): Extension[] {
  const viewportInline: Extension[] = [
    livePreviewTheme,
    livePreviewGeometryRemeasure,
    livePreviewHideFormatting,
    livePreviewTaskCheckboxes,
    livePreviewListMarkers,
    livePreviewBlockquotes,
    livePreviewImages,
    livePreviewLinks,
  ];
  const incrementalBlocks: Extension[] = [
    livePreviewMath,
    livePreviewWiki,
    livePreviewTables,
    livePreviewCallouts,
    livePreviewMermaid,
    livePreviewHighlights,
  ];
  return [...viewportInline, ...incrementalBlocks];
}

/** Full Live Preview extension set for CodeMirror (initial mount). */
export function createLivePreviewExtensions(
  context: LivePreviewContext = EMPTY_LIVE_PREVIEW_CONTEXT,
): Extension[] {
  return [
    createLivePreviewContextExtension(context),
    ...createLivePreviewPluginExtensions(),
  ];
}

export {
  buildLivePreviewHideDecorations,
  livePreviewHideFormatting,
} from "./hideFormattingMarks";
export {
  buildLivePreviewTaskDecorations,
  livePreviewTaskCheckboxes,
} from "./taskCheckboxes";
export { buildLivePreviewImageDecorations, livePreviewImages } from "./images";
export {
  buildLivePreviewMathDecorations,
  findMathRangesInText,
  livePreviewMath,
} from "./math";
export {
  buildLivePreviewWikiDecorations,
  livePreviewWiki,
  clearLivePreviewWikiCaches,
  invalidateLivePreviewWikiCachesForPath,
} from "./wiki";
export { buildLivePreviewTableDecorations, livePreviewTables } from "./tables";
export {
  buildLivePreviewCalloutDecorations,
  findCalloutRanges,
  livePreviewCallouts,
} from "./callouts";
export { livePreviewMermaid } from "./mermaid";
export {
  buildHighlightDecorations,
  buildLivePreviewBlockquoteDecorations,
  buildLivePreviewHighlightDecorations,
  buildLivePreviewListMarkerDecorations,
  findCommentRanges,
  findHighlightRanges,
  livePreviewBlockquotes,
  livePreviewHighlights,
  livePreviewListMarkerReplaceFrom,
  livePreviewListMarkers,
  livePreviewListNestLevel,
} from "./listAndHighlight";
export { buildLivePreviewLinkDecorations, livePreviewLinks } from "./links";
export {
  getLivePreviewOptimizationMode,
  SoftOffPlaceholderWidget,
  softOffReason,
} from "./softOff";
export {
  selectionAffectsCoverage,
  defineLivePreviewBlockDecorationField,
  collectChangedRanges,
  expandRangesToBlocks,
  scheduleLivePreviewMeasure,
  requestLivePreviewRefresh,
  livePreviewRefreshEffect,
  LIVE_PREVIEW_LAYOUT_SETTLE_MS,
  bindLivePreviewWidgetResizeMeasure,
  getLivePreviewDecorationRange,
  LIVE_PREVIEW_VIEWPORT_DECORATION_PAD,
  cancelPendingLivePreviewReveals,
  livePreviewGeometryRemeasure,
  bindLivePreviewClickToReveal,
} from "./shared";
