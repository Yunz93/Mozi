/**
 * Pointer-selection bugs that share this extension:
 *
 * 1. Clicks on chrome (sidebar, toolbar, page padding) increment the document
 *    click count. The next mousedown in CodeMirror then arrives with
 *    `event.detail` 2 or 3, which CM treats as word/line selection.
 *
 * 2. After scroll or Live Preview widget settle, the height map can be stale:
 *    mousedown `posAtCoords` lands near the document start (or a nearby line),
 *    then mouseup / remasure maps the same pixels to the real click site. CM
 *    treats that as a drag and selects everything in between. This happens on
 *    the first click after opening a file *and* on later in-editor clicks.
 *
 * 3. Hidden formatting marks revealing mid-gesture shift layout, which is the
 *    same stale-map-as-drag failure.
 *
 * For every left-button click except a genuine in-editor double/triple click,
 * force a single-click caret/drag, re-resolve positions from pixel
 * coordinates, and ignore tiny pointer jitter as a drag.
 */

import { EditorSelection, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type MouseSelectionStyle,
  type ViewUpdate,
} from "@codemirror/view";
import { setEditorPointerSelecting } from "../livePreview/shared";

/** Pixel movement below this is a click, not a drag — height-map drift is larger. */
export const CLICK_DRAG_THRESHOLD_PX = 4;

export function shouldForceSingleClickSelection(
  viewHasFocus: boolean,
  event: Pick<MouseEvent, "button" | "detail">,
  previousPointerWasOutsideEditor: boolean,
): boolean {
  if (event.button !== 0) return false;
  if (event.detail > 1 && viewHasFocus && !previousPointerWasOutsideEditor) {
    return false;
  }
  return true;
}

export function pointerMovedEnoughForDrag(
  start: Pick<MouseEvent, "clientX" | "clientY">,
  current: Pick<MouseEvent, "clientX" | "clientY">,
): boolean {
  const dx = current.clientX - start.clientX;
  const dy = current.clientY - start.clientY;
  return Math.hypot(dx, dy) >= CLICK_DRAG_THRESHOLD_PX;
}

export function mouseStyleShouldReselect(update: ViewUpdate): boolean {
  return update.geometryChanged || update.heightChanged;
}

function posAtEvent(
  view: EditorView,
  event: Pick<MouseEvent, "clientX" | "clientY">,
): { pos: number; assoc: number } {
  return view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
}

export function singleClickSelectionStyle(
  view: EditorView,
  event: MouseEvent,
): MouseSelectionStyle {
  const startEvent = {
    clientX: event.clientX,
    clientY: event.clientY,
  };
  let startSel = view.state.selection;
  return {
    update(update) {
      if (update.docChanged) {
        startSel = startSel.map(update.changes);
      }
      return mouseStyleShouldReselect(update);
    },
    get(curEvent, extend, multiple) {
      const cur = posAtEvent(view, curEvent);
      const isDrag = pointerMovedEnoughForDrag(startEvent, curEvent);
      const start = isDrag ? posAtEvent(view, startEvent) : cur;
      const range =
        !isDrag || start.pos === cur.pos
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
  private readonly onMouseUp: (event: MouseEvent) => void;

  constructor(readonly view: EditorView) {
    this.onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      const inside = target instanceof Node && this.view.dom.contains(target);
      this.previousPointerWasOutsideEditor = this.lastPointerWasOutsideEditor;
      this.lastPointerWasOutsideEditor = !inside;
      if (inside) {
        setEditorPointerSelecting(true);
      }
    };
    this.onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      setEditorPointerSelecting(false, this.view);
    };
    window.addEventListener("mousedown", this.onMouseDown, true);
    window.addEventListener("mouseup", this.onMouseUp, true);
  }

  destroy() {
    window.removeEventListener("mousedown", this.onMouseDown, true);
    window.removeEventListener("mouseup", this.onMouseUp, true);
    setEditorPointerSelecting(false);
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
