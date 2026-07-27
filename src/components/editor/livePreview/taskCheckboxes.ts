/**
 * Clickable task-list checkboxes for Live Preview.
 * Replaces `[ ]` / `[x]` TaskMarker nodes when the cursor is not on that line.
 */

import { RangeSetBuilder, type EditorState } from "@codemirror/state";
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
  ensureLivePreviewViewportTree,
  getLivePreviewDecorationRange,
  maxVisibleParseTo,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
} from "./shared";

class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
    readonly markerTo: number,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return (
      this.checked === other.checked &&
      this.markerFrom === other.markerFrom &&
      this.markerTo === other.markerTo
    );
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-live-preview-task";
    button.setAttribute("data-checked", this.checked ? "true" : "false");
    button.setAttribute("aria-checked", this.checked ? "true" : "false");
    button.setAttribute("role", "checkbox");
    button.tabIndex = -1;
    button.title = this.checked ? "Mark as incomplete" : "Mark as complete";

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.markerFrom, to: this.markerTo, insert: next },
      });
    });

    return button;
  }

  ignoreEvent() {
    return false;
  }
}

function selectionOnLine(state: EditorState, from: number): boolean {
  const line = state.doc.lineAt(from);
  for (const range of state.selection.ranges) {
    if (range.from <= line.to && range.to >= line.from) {
      return true;
    }
  }
  return false;
}

export function buildLivePreviewTaskDecorations(
  view: EditorView,
): DecorationSet {
  if (isLargeEditorState(view.state)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const parseTo = maxVisibleParseTo(view);
  const tree = ensureLivePreviewViewportTree(view, parseTo);
  const { from: viewportFrom, to: viewportTo } =
    getLivePreviewDecorationRange(view);

  tree.iterate({
    from: viewportFrom,
    to: viewportTo,
    enter: (node) => {
      if (node.name !== "TaskMarker") return;
      const { from, to } = node;
      if (from >= to) return;
      if (selectionOnLine(state, from)) return;

      const text = state.doc.sliceString(from, to);
      const checked = /^\[[xX]\]$/.test(text);
      if (!checked && text !== "[ ]") return;

      builder.add(
        from,
        to,
        Decoration.replace({
          widget: new TaskCheckboxWidget(checked, from, to),
        }),
      );
    },
  });

  return builder.finish();
}

export const livePreviewTaskCheckboxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly viewportWindow = new ViewportDecorationWindow();

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewTaskDecorations(view);
      this.viewportWindow.mark(view);
    }

    update(update: ViewUpdate) {
      if (
        shouldRebuildLivePreviewDecorations(
          update,
          "marks",
          this.viewportWindow,
        )
      ) {
        this.decorations = buildLivePreviewTaskDecorations(update.view);
        this.viewportWindow.mark(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
