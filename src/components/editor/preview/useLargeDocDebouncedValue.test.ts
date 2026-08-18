/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  LARGE_PREVIEW_CONTENT_LENGTH,
  LARGE_PREVIEW_DEBOUNCE_MS,
  useLargeDocDebouncedValue,
} from "./useLargeDocDebouncedValue";

describe("useLargeDocDebouncedValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes small documents through immediately", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLargeDocDebouncedValue(value, "note-a"),
      { initialProps: { value: "hello" } },
    );

    expect(result.current).toBe("hello");
    rerender({ value: "hello world" });
    expect(result.current).toBe("hello world");
  });

  it("debounces updates once the document crosses the large-preview threshold", () => {
    vi.useFakeTimers();
    const large = "x".repeat(LARGE_PREVIEW_CONTENT_LENGTH);
    const { result, rerender } = renderHook(
      ({ value, resetKey }) => useLargeDocDebouncedValue(value, resetKey),
      { initialProps: { value: large, resetKey: "doc-1" } },
    );

    expect(result.current).toBe(large);

    const next = `${large}y`;
    rerender({ value: next, resetKey: "doc-1" });
    expect(result.current).toBe(large);

    act(() => {
      vi.advanceTimersByTime(LARGE_PREVIEW_DEBOUNCE_MS);
    });
    expect(result.current).toBe(next);
  });

  it("flushes immediately when the document identity changes", () => {
    vi.useFakeTimers();
    const first = "a".repeat(LARGE_PREVIEW_CONTENT_LENGTH);
    const second = "b".repeat(LARGE_PREVIEW_CONTENT_LENGTH);
    const { result, rerender } = renderHook(
      ({ value, resetKey }) => useLargeDocDebouncedValue(value, resetKey),
      { initialProps: { value: first, resetKey: "doc-1" } },
    );

    rerender({ value: second, resetKey: "doc-2" });
    expect(result.current).toBe(second);
  });
});
