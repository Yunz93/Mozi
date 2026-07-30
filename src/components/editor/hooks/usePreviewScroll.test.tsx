/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePreviewScroll } from "./usePreviewScroll";

describe("usePreviewScroll", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("emits normalized scroll percentage for user scrolls", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const onScroll = vi.fn();
    const { result } = renderHook(() => usePreviewScroll({ onScroll }));
    const element = document.createElement("div");
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: 500,
    });
    element.scrollTop = 250;

    act(() => {
      result.current.handleScroll(element);
    });

    expect(onScroll).toHaveBeenCalledWith(0.5);
  });

  it("suppresses onScroll while programmatic sync is active", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const onScroll = vi.fn();
    const { result } = renderHook(() => usePreviewScroll({ onScroll }));
    const element = document.createElement("div");
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: 500,
    });

    act(() => {
      result.current.syncScrollTo(element, 0.8, { immediate: true });
      element.scrollTop = 400;
      result.current.handleScroll(element);
    });

    expect(onScroll).not.toHaveBeenCalled();
  });

  it("stores pending percentage when layout height is zero and flushes later", () => {
    const { result } = renderHook(() => usePreviewScroll({}));
    const element = document.createElement("div");
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: 500,
    });

    act(() => {
      result.current.syncScrollTo(element, 0.4);
    });

    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      value: 1500,
    });
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: 500,
    });

    act(() => {
      result.current.flushPendingScrollSync(element);
    });

    expect(element.scrollTop).toBe(400);
  });

  it("cancels in-flight sync animation", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 99),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { result } = renderHook(() => usePreviewScroll({}));
    const element = document.createElement("div");
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: 500,
    });

    act(() => {
      result.current.syncScrollTo(element, 0.75);
      expect(result.current.isSyncing()).toBe(true);
      result.current.cancelScrollSync();
    });

    expect(result.current.isSyncing()).toBe(false);
  });
});
