import { useEffect, useRef, useState } from "react";

/** Documents at or above this size get a debounced preview pipeline. */
export const LARGE_PREVIEW_CONTENT_LENGTH = 40_000;
export const LARGE_PREVIEW_DEBOUNCE_MS = 250;

/**
 * Pass small documents through immediately, but debounce updates for very
 * large documents so each keystroke does not trigger a full markdown
 * re-render (KaTeX/Shiki/Mermaid pipeline) while typing.
 *
 * `resetKey` forces an immediate (non-debounced) update, used on document
 * switches so a newly opened large file is not shown stale.
 */
export function useLargeDocDebouncedValue(
  value: string,
  resetKey: string | null,
): string {
  const [debounced, setDebounced] = useState(value);
  const resetKeyRef = useRef(resetKey);
  const isLarge = value.length >= LARGE_PREVIEW_CONTENT_LENGTH;

  useEffect(() => {
    if (!isLarge || resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      setDebounced(value);
      return;
    }

    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, LARGE_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value, isLarge, resetKey]);

  return isLarge ? debounced : value;
}
