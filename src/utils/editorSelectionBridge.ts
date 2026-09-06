import type { EditorView } from "@codemirror/view";
import { redo as cmRedo, undo as cmUndo } from "@codemirror/commands";

let activeEditorView: EditorView | null = null;
let activeEditorFlush: (() => void) | null = null;
let activeEditorTabId: string | null = null;

interface FocusOptions {
  alignTopRatio?: number;
  focus?: boolean;
}

interface PendingEditorFocusRequest {
  tabId: string | null;
  start: number;
  end: number;
  options?: FocusOptions;
  gestureGeneration: number;
}

const EDITOR_FOCUS_RETRY_DELAYS_MS = [16, 64, 180, 360];
let pendingEditorFocusRequest: PendingEditorFocusRequest | null = null;
let pendingEditorFocusRetryTimers: number[] = [];
let editorUserGestureGeneration = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clearPendingEditorFocusRetries(): void {
  pendingEditorFocusRetryTimers.forEach((timerId) =>
    window.clearTimeout(timerId),
  );
  pendingEditorFocusRetryTimers = [];
}

function applyEditorRangeFocus(
  start: number,
  end: number = start,
  options?: FocusOptions,
): boolean {
  if (!activeEditorView) return false;

  const view = activeEditorView;
  const docLength = view.state.doc.length;
  const anchor = clamp(start, 0, docLength);
  const head = clamp(end, 0, docLength);
  const shouldFocus = options?.focus ?? true;

  if (shouldFocus) {
    view.focus();
  }
  view.dispatch({
    selection: { anchor, head },
    scrollIntoView: shouldFocus,
  });

  const alignTopRatio = clamp(options?.alignTopRatio ?? 0.3, 0, 1);
  const lineTop = view.lineBlockAt(anchor).top;
  const targetScrollTop = Math.max(
    0,
    lineTop - view.scrollDOM.clientHeight * alignTopRatio,
  );
  view.scrollDOM.scrollTop = targetScrollTop;

  return true;
}

function tryFlushPendingEditorFocus(): boolean {
  if (!pendingEditorFocusRequest) return false;
  if (
    pendingEditorFocusRequest.gestureGeneration !== editorUserGestureGeneration
  ) {
    clearPendingEditorFocusRetries();
    pendingEditorFocusRequest = null;
    return false;
  }
  if (
    pendingEditorFocusRequest.tabId != null &&
    activeEditorTabId != null &&
    pendingEditorFocusRequest.tabId !== activeEditorTabId
  ) {
    return false;
  }

  const { start, end, options } = pendingEditorFocusRequest;
  const didFocus = applyEditorRangeFocus(start, end, options);
  if (didFocus) {
    clearPendingEditorFocusRetries();
    pendingEditorFocusRequest = null;
  }
  return didFocus;
}

export function registerActiveEditorView(
  view: EditorView | null,
  tabId?: string | null,
): void {
  activeEditorView = view;
  if (tabId !== undefined) {
    activeEditorTabId = tabId;
  }
  if (view) {
    tryFlushPendingEditorFocus();
  }
}

export function clearActiveEditorView(view: EditorView): void {
  if (activeEditorView === view) {
    activeEditorView = null;
  }
}

export function getActiveEditorView(): EditorView | null {
  return activeEditorView;
}

/**
 * Register the active editor's "flush pending content change" callback.
 * Editor keystrokes are pushed to the store on a short debounce; save paths
 * call `flushActiveEditorPendingChanges` first so the very latest keystrokes
 * are never lost when saving right after typing.
 */
export function registerActiveEditorFlush(flush: (() => void) | null): void {
  activeEditorFlush = flush;
}

export function clearActiveEditorFlush(flush: () => void): void {
  if (activeEditorFlush === flush) {
    activeEditorFlush = null;
  }
}

export function flushActiveEditorPendingChanges(): void {
  activeEditorFlush?.();
}

/**
 * Run undo against the active CodeMirror view. Returns false when no view is
 * mounted or its history has nothing to undo, so callers can fall back to the
 * store-level history. Keeping CodeMirror as the primary undo stack avoids
 * two competing histories fighting over the same document.
 */
export function undoInActiveEditor(): boolean {
  if (!activeEditorView) return false;
  return cmUndo(activeEditorView);
}

/** Redo counterpart of {@link undoInActiveEditor}. */
export function redoInActiveEditor(): boolean {
  if (!activeEditorView) return false;
  return cmRedo(activeEditorView);
}

export function insertTextAtCursor(text: string): boolean {
  if (!activeEditorView) return false;
  const view = activeEditorView;
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Current main selection in the registered editor, if any. */
export function getActiveEditorSelection(): {
  tabId: string | null;
  from: number;
  to: number;
} | null {
  if (!activeEditorView) return null;
  const selection = activeEditorView.state.selection.main;
  return {
    tabId: activeEditorTabId,
    from: selection.from,
    to: selection.to,
  };
}

export function focusEditorRangeByOffset(
  start: number,
  end: number = start,
  options?: FocusOptions,
): boolean {
  return applyEditorRangeFocus(start, end, options);
}

/**
 * Focus an editor range even if CodeMirror is still mounting (e.g. after
 * opening a file from sidebar search). Retries briefly and also flushes when
 * a view is registered via {@link registerActiveEditorView}.
 */
export function requestEditorRangeFocus(
  tabId: string | null | undefined,
  start: number,
  end: number = start,
  options?: FocusOptions,
): boolean {
  clearPendingEditorFocusRetries();
  pendingEditorFocusRequest = {
    tabId: tabId ?? null,
    start,
    end,
    options,
    gestureGeneration: editorUserGestureGeneration,
  };

  const didFocus = tryFlushPendingEditorFocus();
  if (didFocus) return true;

  const lastRetryIndex = EDITOR_FOCUS_RETRY_DELAYS_MS.length - 1;
  pendingEditorFocusRetryTimers = EDITOR_FOCUS_RETRY_DELAYS_MS.map(
    (delay, index) =>
      window.setTimeout(() => {
        const flushed = tryFlushPendingEditorFocus();
        // Drop stale requests after the final retry so a later click/register
        // cannot suddenly jump the caret to an old outline/search offset.
        if (!flushed && index === lastRetryIndex) {
          pendingEditorFocusRequest = null;
        }
      }, delay),
  );
  return false;
}

export function clearPendingEditorRangeFocus(): void {
  clearPendingEditorFocusRetries();
  pendingEditorFocusRequest = null;
}

/**
 * User started interacting with the editor (pointer or key). Drop any
 * outline/search jump that has not applied yet so a late retry cannot yank
 * the caret after the user has already placed it.
 */
export function noteEditorUserGesture(): void {
  editorUserGestureGeneration += 1;
  clearPendingEditorRangeFocus();
}
