/**
 * Clicks on chrome (sidebar, toolbar, page padding) increment the document
 * click count. The next mousedown in CodeMirror then arrives with
 * `event.detail` 2 or 3, which CM treats as word/line selection — the caret
 * jumps and a large range lights up.
 *
 * If the previous pointer-down was outside the editor (or the editor is
 * blurred), force a single-click caret/drag instead of inheriting that count.
 */

import { EditorSelection, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type MouseSelectionStyle,
} from "@codemirror/view";

export function shouldForceSingleClickSelection(
  viewHasFocus: boolean,
  event: Pick<MouseEvent, "button" | "detail">,
  previousPointerWasOutsideEditor: boolean,
): boolean {
  if (event.button !== 0) return false;
  if (event.detail <= 1) return false;
  return previousPointerWasOutsideEditor || !viewHasFocus;
}

function singleClickSelectionStyle(
  view: EditorView,
  event: MouseEvent,
): MouseSelectionStyle {
  let start = view.posAndSideAtCoords(
    { x: event.clientX, y: event.clientY },
    false,
  );
  let startSel = view.state.selection;
  return {
    update(update) {
      if (update.docChanged) {
        start = {
          pos: update.changes.mapPos(start.pos),
          assoc: start.assoc,
        };
        startSel = startSel.map(update.changes);
      }
    },
    get(curEvent, extend, multiple) {
      const cur = view.posAndSideAtCoords(
        { x: curEvent.clientX, y: curEvent.clientY },
        false,
      );
      const range =
        start.pos === cur.pos
          ? EditorSelection.cursor(cur.pos, cur.assoc)
          : EditorSelection.range(start.pos, cur.pos);
      if (extend) {
        return startSel.replaceRange(
          startSel.main.extend(range.from, range.to),
        );
      }
      if (multiple) {
        return startSel.addRange(range);
      }
      return EditorSelection.create([range]);
    },
  };
}

export function resolveRefocusMouseSelectionStyle(
  view: EditorView,
  event: MouseEvent,
  previousPointerWasOutsideEditor: boolean,
): MouseSelectionStyle | null {
  if (
    !shouldForceSingleClickSelection(
      view.hasFocus,
      event,
      previousPointerWasOutsideEditor,
    )
  ) {
    return null;
  }
  return singleClickSelectionStyle(view, event);
}

class RefocusPointerTracker {
  previousPointerWasOutsideEditor = true;
  private lastPointerWasOutsideEditor = true;
  private readonly onMouseDown: (event: MouseEvent) => void;

  constructor(readonly view: EditorView) {
    this.onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      const inside = target instanceof Node && this.view.dom.contains(target);
      this.previousPointerWasOutsideEditor = this.lastPointerWasOutsideEditor;
      this.lastPointerWasOutsideEditor = !inside;
    };
    window.addEventListener("mousedown", this.onMouseDown, true);
  }

  destroy() {
    window.removeEventListener("mousedown", this.onMouseDown, true);
  }
}

export const refocusPointerTracker = ViewPlugin.fromClass(
  RefocusPointerTracker,
);

export function createRefocusPointerSelectionExtension(): Extension {
  return [
    refocusPointerTracker,
    EditorView.mouseSelectionStyle.of((view, event) => {
      const tracker = view.plugin(refocusPointerTracker);
      const previousOutside =
        tracker?.previousPointerWasOutsideEditor ?? !view.hasFocus;
      return resolveRefocusMouseSelectionStyle(view, event, previousOutside);
    }),
  ];
}
