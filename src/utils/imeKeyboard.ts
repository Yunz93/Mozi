/**
 * IME (input method) composition helpers.
 *
 * Confirming a candidate with Enter/Space often emits a keydown that looks like
 * a real Enter. Callers that submit/confirm on Enter must ignore those events.
 */

type ImeKeyboardLike = {
  isComposing?: boolean;
  /** Legacy: many browsers report 229 while an IME is active. */
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
};

function hasImeSignal(event: {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}): boolean {
  return (
    event.isComposing === true || event.keyCode === 229 || event.which === 229
  );
}

/** True while an IME is composing (or confirming) text. */
export function isImeComposingEvent(event: ImeKeyboardLike): boolean {
  if (hasImeSignal(event)) return true;
  if (event.nativeEvent && hasImeSignal(event.nativeEvent)) return true;
  return false;
}

type EnterKeyLike = ImeKeyboardLike & {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

/**
 * Plain Enter meant to confirm/submit — not during IME composition, and not a
 * modified chord (Cmd/Ctrl/Alt). Shift is allowed so callers can branch on it.
 */
export function isPlainEnterKey(event: EnterKeyLike): boolean {
  if (isImeComposingEvent(event)) return false;
  if (event.key !== "Enter") return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return true;
}
