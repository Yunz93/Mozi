/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createUISlice, type UIActions, type UIState } from "./uiStore";

afterEach(() => vi.useRealTimers());

describe("notification lifetime", () => {
  it("keeps actionable messages available for 30 seconds", () => {
    vi.useFakeTimers();
    const store = create<UIState & UIActions>((set, get) =>
      createUISlice(set, get),
    );
    store.getState().showNotification("IP 203.0.113.8", "error", 30_000);
    vi.advanceTimersByTime(29_999);
    expect(store.getState().notification?.msg).toBe("IP 203.0.113.8");
    vi.advanceTimersByTime(1);
    expect(store.getState().notification).toBeNull();
  });

  it("keeps ordinary notifications at three seconds and cancels replaced timers", () => {
    vi.useFakeTimers();
    const store = create<UIState & UIActions>((set, get) =>
      createUISlice(set, get),
    );
    store.getState().showNotification("IP 203.0.113.8", "error", 30_000);
    vi.advanceTimersByTime(1_000);
    store.getState().showNotification("Saved");
    vi.advanceTimersByTime(2_999);
    expect(store.getState().notification?.msg).toBe("Saved");
    vi.advanceTimersByTime(1);
    expect(store.getState().notification).toBeNull();
    store.getState().showNotification("Another IP", "error", 30_000);
    store.getState().clearNotification();
    vi.advanceTimersByTime(30_000);
    expect(store.getState().notification).toBeNull();
  });

  it("does not let an earlier timeout dismiss a newer long-lived message", () => {
    vi.useFakeTimers();
    const store = create<UIState & UIActions>((set, get) =>
      createUISlice(set, get),
    );
    store.getState().showNotification("Saved");
    vi.advanceTimersByTime(2_000);
    store.getState().showNotification("IP 203.0.113.8", "error", 30_000);
    vi.advanceTimersByTime(1_000);
    expect(store.getState().notification?.msg).toBe("IP 203.0.113.8");
    vi.advanceTimersByTime(28_999);
    expect(store.getState().notification?.msg).toBe("IP 203.0.113.8");
    vi.advanceTimersByTime(1);
    expect(store.getState().notification).toBeNull();
  });
});
