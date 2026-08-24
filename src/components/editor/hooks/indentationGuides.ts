/**
 * Lightweight indentation guide decorations for CodeMirror.
 * Marks each indent column (based on EditorState.tabSize) on leading whitespace.
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const indentGuideMark = Decoration.mark({ class: "cm-indent-guide" });
const LIST_LINE_RE = /^[ \t]*(?:>[ \t]*)*(?:[-+*] |\d+[.)] )/;

function buildIndentGuideDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tabSize = view.state.tabSize;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      if (LIST_LINE_RE.test(text)) {
        pos = line.to + 1;
        continue;
      }
      let col = 0;

      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch !== " " && ch !== "\t") break;

        const markCol = col;
        col += ch === "\t" ? tabSize - (col % tabSize) : 1;

        if (markCol % tabSize === 0) {
          const fromPos = line.from + i;
          builder.add(fromPos, fromPos + 1, indentGuideMark);
        }
      }

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

export function indentationGuides() {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildIndentGuideDecorations(view);
        }

        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.geometryChanged
          ) {
            this.decorations = buildIndentGuideDecorations(update.view);
          }
        }
      },
      {
        decorations: (value) => value.decorations,
      },
    ),
    EditorView.baseTheme({
      ".cm-indent-guide": {
        position: "relative",
      },
      ".cm-indent-guide::before": {
        content: '""',
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        borderLeft:
          "1px solid color-mix(in srgb, currentColor 16%, transparent)",
        pointerEvents: "none",
      },
    }),
  ];
}
