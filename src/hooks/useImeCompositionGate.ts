import { useCallback, useRef } from "react";
import { isImeComposingEvent } from "../utils/imeKeyboard";

/**
 * Tracks IME composition across compositionstart/end plus keydown signals.
 *
 * Some browsers deliver the confirming Enter *after* compositionend with
 * `isComposing === false`; deferring the clear avoids treating that as submit.
 */
export function useImeCompositionGate() {
  const composingRef = useRef(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingClear = useCallback(() => {
    if (clearTimerRef.current != null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  const onCompositionStart = useCallback(() => {
    cancelPendingClear();
    composingRef.current = true;
  }, [cancelPendingClear]);

  const onCompositionEnd = useCallback(() => {
    cancelPendingClear();
    // Defer: confirmation Enter can arrive in the same turn after end.
    clearTimerRef.current = setTimeout(() => {
      composingRef.current = false;
      clearTimerRef.current = null;
    }, 0);
  }, [cancelPendingClear]);

  const isComposing = useCallback(
    (event?: {
      isComposing?: boolean;
      keyCode?: number;
      which?: number;
      nativeEvent?: {
        isComposing?: boolean;
        keyCode?: number;
        which?: number;
      };
    }) => {
      if (composingRef.current) return true;
      if (event && isImeComposingEvent(event)) return true;
      return false;
    },
    [],
  );

  return {
    onCompositionStart,
    onCompositionEnd,
    isComposing,
  };
}
