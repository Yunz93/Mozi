/** @vitest-environment happy-dom */

import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, defaultSettings } from "../store/appStore";
import { useFocusMode } from "./useFocusMode";

const native = vi.hoisted(() => ({
  isFullscreen: vi.fn(),
  setFullscreen: vi.fn(),
  onResized: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("../utils/editorSelectionBridge", () => ({
  getActiveEditorView: () => ({ focus: native.focus }),
}));
vi.mock("../components/editor/behavior/imeGuard", () => ({
  isEditorImeComposing: () => false,
}));

function Harness({ overlays = {} }: { overlays?: Record<string, boolean> }) {
  useFocusMode(
    useAppStore((state) => state.settings.focusMode),
    overlays,
  );
  return null;
}

describe("focus fullscreen session", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    native.isFullscreen.mockResolvedValue(false);
    native.setFullscreen.mockResolvedValue(undefined);
    native.onResized.mockResolvedValue(vi.fn());
    useAppStore.setState({
      settings: { ...defaultSettings, language: "zh-CN" },
      isSidebarOpen: true,
    });
  });
  afterEach(cleanup);

  it("enters fullscreen and exits on Escape without changing the saved sidebar or typewriter mode", async () => {
    render(<Harness />);
    act(() =>
      useAppStore
        .getState()
        .updateSettings({ focusMode: true, typewriterMode: true }),
    );
    await waitFor(() =>
      expect(native.setFullscreen).toHaveBeenCalledWith(true),
    );
    expect(native.focus).toHaveBeenCalled();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await waitFor(() =>
      expect(native.setFullscreen).toHaveBeenLastCalledWith(false),
    );
    expect(useAppStore.getState().settings.focusMode).toBe(false);
    expect(useAppStore.getState().settings.typewriterMode).toBe(true);
    expect(useAppStore.getState().isSidebarOpen).toBe(true);
  });

  it("preserves a window that was already fullscreen", async () => {
    native.isFullscreen.mockResolvedValue(true);
    render(<Harness />);
    act(() => useAppStore.getState().updateSettings({ focusMode: true }));
    await waitFor(() => expect(native.onResized).toHaveBeenCalled());
    act(() => useAppStore.getState().updateSettings({ focusMode: false }));
    await act(async () => {});
    expect(native.setFullscreen).not.toHaveBeenCalled();
  });

  it("serializes a quick off and on while native entry is pending", async () => {
    let complete!: () => void;
    native.setFullscreen.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(<Harness />);
    act(() => useAppStore.getState().updateSettings({ focusMode: true }));
    await waitFor(() =>
      expect(native.setFullscreen).toHaveBeenCalledWith(true),
    );
    act(() => useAppStore.getState().updateSettings({ focusMode: false }));
    act(() => useAppStore.getState().updateSettings({ focusMode: true }));
    await act(async () => complete());
    await waitFor(() =>
      expect(
        native.setFullscreen.mock.calls.map(([enabled]) => enabled),
      ).toEqual([true, false, true]),
    );
    expect(useAppStore.getState().settings.focusMode).toBe(true);
  });

  it("leaves focus mode when the native fullscreen control exits", async () => {
    render(<Harness />);
    act(() => useAppStore.getState().updateSettings({ focusMode: true }));
    await waitFor(() => expect(native.onResized).toHaveBeenCalled());
    await act(async () => {
      await native.onResized.mock.calls[0][0]();
    });
    expect(useAppStore.getState().settings.focusMode).toBe(false);
    expect(native.setFullscreen).toHaveBeenCalledTimes(1);
  });

  it("handles F8 before a nested table input consumes the key", async () => {
    render(<Harness />);
    act(() => useAppStore.getState().updateSettings({ focusMode: true }));
    await waitFor(() => expect(native.onResized).toHaveBeenCalled());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.addEventListener("keydown", (event) => event.stopPropagation());
    const event = new KeyboardEvent("keydown", {
      key: "F8",
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(event));
    expect(useAppStore.getState().settings.focusMode).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    input.remove();
  });

  it("exits focus when a new overlay is requested", async () => {
    const { rerender } = render(<Harness overlays={{ search: false }} />);
    act(() => useAppStore.getState().updateSettings({ focusMode: true }));
    await waitFor(() => expect(native.onResized).toHaveBeenCalled());
    rerender(<Harness overlays={{ search: true }} />);
    await waitFor(() =>
      expect(useAppStore.getState().settings.focusMode).toBe(false),
    );
  });

  it("can enter focus from an already open settings panel", async () => {
    render(<Harness overlays={{ settings: true }} />);
    act(() => useAppStore.getState().updateSettings({ focusMode: true }));
    await waitFor(() => expect(native.onResized).toHaveBeenCalled());
    expect(useAppStore.getState().settings.focusMode).toBe(true);
  });
});
