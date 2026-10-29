import { describe, it, expect, vi } from "vitest";
import {
  countLines,
  getFileMetrics,
  isLargeFile,
  LRUCache,
  hashContent,
  processInBatches,
  scheduleIdleWork,
} from "./performance";

describe("countLines", () => {
  it("matches split-based line count for non-empty content", () => {
    const samples = ["a", "a\nb", "a\nb\n", "\n\nfoo"];
    for (const s of samples) {
      expect(countLines(s)).toBe(s.split("\n").length);
    }
  });

  it("returns 0 for empty string (metrics treat empty as zero lines)", () => {
    expect(countLines("")).toBe(0);
  });
});

describe("getFileMetrics", () => {
  it("reports zero lines for empty content", () => {
    expect(getFileMetrics("")).toEqual({ lines: 0, chars: 0, isLarge: false });
  });

  it("returns correct metrics for small content", () => {
    const content = "line1\nline2\nline3";
    expect(getFileMetrics(content)).toEqual({
      lines: 3,
      chars: 17,
      isLarge: false,
    });
  });

  it("marks content as large when line count exceeds threshold", () => {
    const content = Array(5001).fill("a").join("\n");
    expect(getFileMetrics(content).isLarge).toBe(true);
  });

  it("marks content as large when char count exceeds threshold", () => {
    const content = "a".repeat(500001);
    expect(getFileMetrics(content).isLarge).toBe(true);
  });
});

describe("isLargeFile", () => {
  it("returns false for empty content", () => {
    expect(isLargeFile("")).toBe(false);
  });

  it("returns false for small content", () => {
    expect(isLargeFile("small file")).toBe(false);
  });

  it("returns true when char count exceeds threshold", () => {
    expect(isLargeFile("a".repeat(500001))).toBe(true);
  });

  it("returns true when line count exceeds threshold", () => {
    expect(isLargeFile(Array(5001).fill("a").join("\n"))).toBe(true);
  });
});

describe("LRUCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LRUCache<string, number>();
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("returns undefined for missing keys", () => {
    const cache = new LRUCache<string, number>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("distinguishes undefined value from missing key", () => {
    const cache = new LRUCache<string, number | undefined>();
    cache.set("a", undefined);
    // get should still return undefined, but the key exists
    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(true);
  });

  it("updates existing keys without increasing size", () => {
    const cache = new LRUCache<string, number>();
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("evicts least recently used item when max size is exceeded", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("marks accessed item as most recently used", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // a is now most recently used
    cache.set("c", 3); // b should be evicted
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("clears all entries", () => {
    const cache = new LRUCache<string, number>();
    cache.set("a", 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("uses default max size of 100", () => {
    const cache = new LRUCache<string, number>();
    for (let i = 0; i < 105; i++) {
      cache.set(String(i), i);
    }
    expect(cache.size).toBe(100);
  });

  it("has() returns true for existing keys", () => {
    const cache = new LRUCache<string, number>();
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });
});

describe("hashContent", () => {
  it("returns consistent hash for same content", () => {
    const content = "hello world";
    expect(hashContent(content)).toBe(hashContent(content));
  });

  it("returns different hashes for different content", () => {
    expect(hashContent("abc")).not.toBe(hashContent("def"));
  });

  it("includes content length in hash", () => {
    const hash = hashContent("abc");
    expect(hash.endsWith("_3")).toBe(true);
  });

  it("includes equal-length edits beyond the first 10000 characters", () => {
    const longContent = "a".repeat(20000);
    const hash = hashContent(longContent);
    expect(hash.endsWith("_20000")).toBe(true);
    expect(hash).not.toBe(hashContent(longContent.slice(0, -1) + "b"));
  });

  it("handles empty string", () => {
    expect(hashContent("")).toBe("0_0");
  });
});

describe("processInBatches", () => {
  it("processes all items and returns results in order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processInBatches(items, (x) => x * 2, 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("handles empty array", async () => {
    const results = await processInBatches([], (x) => x, 10);
    expect(results).toEqual([]);
  });

  it("calls onBatchComplete with correct progress", async () => {
    const onBatchComplete = vi.fn();
    const items = [1, 2, 3, 4];
    await processInBatches(items, (x) => x, 2, onBatchComplete);
    expect(onBatchComplete).toHaveBeenCalledTimes(2);
    expect(onBatchComplete).toHaveBeenNthCalledWith(1, 2, 4);
    expect(onBatchComplete).toHaveBeenNthCalledWith(2, 4, 4);
  });

  it("works without onBatchComplete callback", async () => {
    const items = [1, 2, 3];
    const results = await processInBatches(items, (x) => x * 2, 10);
    expect(results).toEqual([2, 4, 6]);
  });

  it("handles async processor", async () => {
    const items = [1, 2, 3];
    const results = await processInBatches(items, async (x) => x * 3, 2);
    expect(results).toEqual([3, 6, 9]);
  });

  it("uses default batch size of 10", async () => {
    const items = Array.from({ length: 15 }, (_, i) => i);
    const processor = vi.fn((x: number) => x);
    await processInBatches(items, processor);
    expect(processor).toHaveBeenCalledTimes(15);
  });
});

describe("scheduleIdleWork", () => {
  it("executes work immediately when window is undefined (SSR)", () => {
    const work = vi.fn();
    const cleanup = scheduleIdleWork(work, 100);
    expect(work).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("returns a no-op cleanup function in SSR", () => {
    const work = vi.fn();
    const cleanup = scheduleIdleWork(work);
    expect(typeof cleanup).toBe("function");
    cleanup(); // should not throw
  });
});
