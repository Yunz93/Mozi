/**
 * IME-aware CodeMirror key handling.
 *
 * CodeMirror already ignores keydown while a composition has produced text
 * (`view.composing`). Chrome/Windows still delivers a confirming Enter *after*
 * compositionend with `isComposing === false`; swallowing that stray key
 * prevents an extra list/table newline without `preventDefault` during the
 * composition itself (which would break candidate confirmation).
 */

import type { Command, EditorView, KeyBinding } from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";

export const IME_CONFIRM_SUPPRESS_MS = 50;

export interface ImeCompositionState {
  onStart: () => void;
  onEnd: () => void;
  isComposing: () => boolean;
  isInConfirmSuppressWindow: () => boolean;
}

export function createImeCompositionState(options?: {
  now?: () => number;
  suppressMs?: number;
}): ImeCompositionState {
  const now = options?.now ?? (() => Date.now());
  const suppressMs = options?.suppressMs ?? IME_CONFIRM_SUPPRESS_MS;
  let composing = false;
  let suppressUntil = 0;

  return {
    onStart() {
      composing = true;
      suppressUntil = 0;
    },
    onEnd() {
      composing = false;
      suppressUntil = now() + suppressMs;
    },
    isComposing() {
      return composing || now() < suppressUntil;
    },
    isInConfirmSuppressWindow() {
      return !composing && now() < suppressUntil;
    },
  };
}

class EditorImeGuard {
  private readonly state = createImeCompositionState();

  isComposing(): boolean {
    return this.state.isComposing();
  }

  isInConfirmSuppressWindow(): boolean {
    return this.state.isInConfirmSuppressWindow();
  }

  onStart(): void {
    this.state.onStart();
  }

  onEnd(): void {
    this.state.onEnd();
  }
}

export const editorImeGuardPlugin = ViewPlugin.fromClass(EditorImeGuard, {
  eventHandlers: {
    compositionstart() {
      this.onStart();
    },
    compositionend() {
      this.onEnd();
    },
  },
});

function imeGuard(view: EditorView): EditorImeGuard | null {
  return view.plugin(editorImeGuardPlugin);
}

export function isEditorImeComposing(view: EditorView): boolean {
  return (
    view.composing ||
    view.compositionStarted ||
    (imeGuard(view)?.isComposing() ?? false)
  );
}

export function isEditorImeConfirmSuppress(view: EditorView): boolean {
  if (view.composing || view.compositionStarted) return false;
  return imeGuard(view)?.isInConfirmSuppressWindow() ?? false;
}

/**
 * Enter after IME confirm: swallow (return true) so no extra newline is
 * inserted. During an active composition, return false so the IME keeps the key.
 */
export function wrapImeConfirmCommand(command: Command): Command {
  return (view) => {
    if (view.composing || view.compositionStarted) return false;
    if (isEditorImeConfirmSuppress(view)) return true;
    return command(view);
  };
}

/** Tab/Backspace: never steal the key from an active or just-finished IME. */
export function wrapImePassthroughCommand(command: Command): Command {
  return (view) => {
    if (isEditorImeComposing(view)) return false;
    return command(view);
  };
}

export function defaultKeymapWithoutEnter(): KeyBinding[] {
  return defaultKeymap.filter((binding) => {
    const keys = [binding.key, binding.mac, binding.win, binding.linux];
    return !keys.some((key) => key === "Enter");
  });
}
