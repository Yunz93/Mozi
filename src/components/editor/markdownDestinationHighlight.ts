/**
 * Lezer/CommonMark stop a bare markdown destination at the first space (and
 * may not tokenize a CJK-only dest as URL). Mark the full destination so
 * source and revealed Live Preview source look like one link.
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  collectMarkdownImageRanges,
  collectMarkdownLinkRanges,
} from "../../utils/markdownInlineRanges";

const destinationMark = Decoration.mark({
  class: "tok-link mp-tok-link cm-md-link-dest",
});

export function buildSpacedDestinationDecorations(
  view: EditorView,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { from, to } = view.viewport;
  const docText = view.state.doc.sliceString(from, to);
  const ranges = [
    ...collectMarkdownImageRanges(docText, 0, docText.length),
    ...collectMarkdownLinkRanges(docText, 0, docText.length),
  ]
    .map((range) => ({
      urlFrom: range.urlFrom + from,
      urlTo: range.urlTo + from,
    }))
    .filter((range) => range.urlTo > range.urlFrom)
    .sort((a, b) => a.urlFrom - b.urlFrom || a.urlTo - b.urlTo);

  let lastTo = -1;
  for (const range of ranges) {
    if (range.urlFrom < lastTo) continue;
    builder.add(range.urlFrom, range.urlTo, destinationMark);
    lastTo = range.urlTo;
  }
  return builder.finish();
}

export const markdownDestinationHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildSpacedDestinationDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildSpacedDestinationDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
