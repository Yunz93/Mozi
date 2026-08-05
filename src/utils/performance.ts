/**
 * Performance utilities for optimizing UI rendering and large file handling
 */

import { useRef, useCallback, useEffect } from "react";

// Constants for large file handling
export const LARGE_FILE_THRESHOLDS = {
  LINE_COUNT: 5000, // Lines
  CHAR_COUNT: 500000, // Characters
  /** Disable tables/callouts/mermaid above this to keep typing responsive. */
  LIVE_PREVIEW_HEAVY_LINE_COUNT: 2000,
  LIVE_PREVIEW_HEAVY_CHAR_COUNT: 200000,
  RENDER_CHUNK_SIZE: 1000, // Lines per chunk for incremental rendering
} as const;

/** Line count matching `String.prototype.split('\n').length` without allocating line strings. */
export function countLines(content: string): number {
  if (!content) return 0;
  let n = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) n++;
  }
  return n;
}

/**
 * Check if content should be treated as a large file
 */
export function isLargeFile(content: string): boolean {
  if (!content) return false;
  if (content.length > LARGE_FILE_THRESHOLDS.CHAR_COUNT) return true;
  const lineCount = countLines(content);
  return lineCount > LARGE_FILE_THRESHOLDS.LINE_COUNT;
}

/**
 * Get file size metrics
 */
export function getFileMetrics(content: string): {
  lines: number;
  chars: number;
  isLarge: boolean;
} {
  if (!content) return { lines: 0, chars: 0, isLarge: false };
  const lines = countLines(content);
  const chars = content.length;
  return {
    lines,
    chars,
    isLarge:
      lines > LARGE_FILE_THRESHOLDS.LINE_COUNT ||
      chars > LARGE_FILE_THRESHOLDS.CHAR_COUNT,
  };
}

/**
 * Debounce hook with leading/trailing options
 */
export function useDebounce<T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number,
  options: { leading?: boolean; trailing?: boolean } = {
    leading: false,
    trailing: true,
  },
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);
  const isLeadingCalledRef = useRef(false);
  const callbackRef = useRef(callback);
  const optionsRef = useRef(options);

  // Keep refs updated
  useEffect(() => {
    callbackRef.current = callback;
    optionsRef.current = options;
  }, [callback, options]);

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      lastArgsRef.current = args;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      if (optionsRef.current.leading && !isLeadingCalledRef.current) {
        isLeadingCalledRef.current = true;
        callbackRef.current(...args);
      }

      timeoutRef.current = setTimeout(() => {
        if (optionsRef.current.trailing && lastArgsRef.current) {
          if (!optionsRef.current.leading || !isLeadingCalledRef.current) {
            callbackRef.current(...lastArgsRef.current);
          }
        }
        isLeadingCalledRef.current = false;
        timeoutRef.current = null;
      }, delay);
    },
    [delay],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debounced as T;
}

/**
 * Throttle hook for resize events
 */
export function useThrottledResize(
  callback: (width: number, height: number) => void,
  delay: number = 100,
) {
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const callbackRef = useRef(callback);
  const delayRef = useRef(delay);

  // Keep refs updated
  useEffect(() => {
    callbackRef.current = callback;
    delayRef.current = delay;
  }, [callback, delay]);

  const observe = useCallback((element: HTMLElement | null) => {
    // Cleanup previous observer
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }

    if (!element) return;

    const handleResize = (entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;

      // Skip if size hasn't changed significantly (> 1px)
      if (
        Math.abs(width - lastSizeRef.current.width) < 1 &&
        Math.abs(height - lastSizeRef.current.height) < 1
      ) {
        return;
      }

      lastSizeRef.current = { width, height };

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(width, height);
        timeoutRef.current = null;
      }, delayRef.current);
    };

    resizeObserverRef.current = new ResizeObserver(handleResize);
    resizeObserverRef.current.observe(element);

    // Initial call - use setTimeout to avoid sync render issues
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      lastSizeRef.current = { width: rect.width, height: rect.height };
      setTimeout(() => callbackRef.current(rect.width, rect.height), 0);
    }
  }, []); // Empty deps - use refs to avoid recreating

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return observe;
}

/**
 * LRU Cache implementation for memoization
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Content hash for cache keys
 */
export function hashContent(content: string): string {
  let hash = 0;
  const len = Math.min(content.length, 10000); // Limit hash computation
  for (let i = 0; i < len; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `${hash}_${content.length}`;
}

/**
 * Hook for tracking render performance
 */
export function useRenderPerf(label: string, enabled: boolean = false) {
  const renderCountRef = useRef(0);
  const lastLogRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    renderCountRef.current++;
    const now = performance.now();

    // Log every 10 renders or every 5 seconds
    if (renderCountRef.current % 10 === 0 || now - lastLogRef.current > 5000) {
      console.log(`[RenderPerf] ${label}: render #${renderCountRef.current}`);
      lastLogRef.current = now;
    }
  });
}

/**
 * Batch processing for large arrays
 */
export async function processInBatches<T, R>(
  items: T[],
  processor: (item: T) => R | Promise<R>,
  batchSize: number = 10,
  onBatchComplete?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    if (onBatchComplete) {
      onBatchComplete(Math.min(i + batchSize, items.length), items.length);
    }

    // Yield to main thread
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results;
}

/**
 * RAF-based scheduler for non-critical updates
 */
export function scheduleIdleWork(
  work: () => void,
  timeout: number = 100,
): () => void {
  if (typeof window === "undefined") {
    work();
    return () => {};
  }

  if ("requestIdleCallback" in window) {
    const id = requestIdleCallback(work, { timeout });
    return () => cancelIdleCallback(id);
  } else {
    const id = setTimeout(work, 0);
    return () => clearTimeout(id);
  }
}
