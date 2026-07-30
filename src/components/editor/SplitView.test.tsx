/** @vitest-environment happy-dom */

import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useAppStore } from "../../store/appStore";
import { ViewMode } from "../../types";

const mockEditorSyncScrollTo = vi.fn();
const mockPreviewSyncScrollTo = vi.fn();
let editorOnScroll: ((percentage: number) => void) | undefined;
let previewOnScroll: ((percentage: number) => void) | undefined;

vi.mock("../stats/WritingStatsDisplay", () => ({
  WritingStatsDisplay: () => null,
}));

vi.mock("./EditorPane", () => ({
  EditorPane: forwardRef(function MockEditorPane(
    props: { onScroll?: (percentage: number) => void },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      cancelScrollSync: vi.fn(),
      syncScrollTo: mockEditorSyncScrollTo,
      scrollToTop: vi.fn(),
    }));

    useEffect(() => {
      editorOnScroll = props.onScroll;
    }, [props.onScroll]);

    return <div data-testid="editor-pane" />;
  }),
}));

vi.mock("./PreviewPane", () => ({
  PreviewPane: forwardRef(function MockPreviewPane(
    props: {
      onScroll?: (percentage: number) => void;
      previewLayoutActive?: boolean;
      previewRenderActive?: boolean;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      cancelScrollSync: vi.fn(),
      syncScrollTo: mockPreviewSyncScrollTo,
      getScrollPosition: () => ({ top: 0, left: 0 }),
      restoreScrollPosition: vi.fn(),
      scrollToTop: vi.fn(),
    }));

    useEffect(() => {
      previewOnScroll = props.onScroll;
    }, [props.onScroll]);

    return (
      <div
        data-testid="preview-pane"
        data-layout-active={String(props.previewLayoutActive)}
        data-render-active={String(props.previewRenderActive)}
      />
    );
  }),
}));

import { SplitView } from "./SplitView";
import {
  beginHeadingNavigationLock,
  endHeadingNavigationLock,
} from "../../utils/previewNavigationBridge";

function seedSplitViewStore(
  overrides: Partial<ReturnType<typeof useAppStore.getState>> = {},
) {
  useAppStore.setState({
    viewMode: ViewMode.EDITOR,
    activeTabId: "tab-a",
    settings: {
      language: "en",
      themeMode: "light",
      markdownStylePreset: "nord",
      fontSize: 16,
      uiFontSize: 16,
      orderedListMode: "strict",
      previewFontFamily: "system",
      codeFontFamily: "system",
    } as never,
    ...overrides,
  } as never);
}

function renderSplitView() {
  return render(
    <SplitView
      isOutlineOpen={false}
      canShowOutline={false}
      canShowOutlineToggle={false}
      contentDensity="comfortable"
      onToggleOutline={vi.fn()}
    />,
  );
}

describe("SplitView scroll handshake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorOnScroll = undefined;
    previewOnScroll = undefined;
    seedSplitViewStore();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    endHeadingNavigationLock();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useAppStore.setState({
      activeTabId: null,
      viewMode: ViewMode.EDITOR,
    } as never);
  });

  it("does not sync preview scroll in editor-only mode", async () => {
    renderSplitView();

    await waitFor(() => {
      expect(editorOnScroll).toBeTypeOf("function");
    });

    act(() => {
      editorOnScroll?.(0.42);
    });

    expect(mockPreviewSyncScrollTo).not.toHaveBeenCalled();
  });

  it("syncs preview scroll in split mode", async () => {
    seedSplitViewStore({ viewMode: ViewMode.SPLIT });
    renderSplitView();

    await waitFor(() => {
      expect(editorOnScroll).toBeTypeOf("function");
    });

    await act(async () => {
      editorOnScroll?.(0.42);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    expect(mockPreviewSyncScrollTo).toHaveBeenCalledWith(0.42, {
      immediate: true,
    });
  });

  it("does not sync editor scroll from preview in reading mode", async () => {
    seedSplitViewStore({ viewMode: ViewMode.PREVIEW });
    renderSplitView();

    await waitFor(() => {
      expect(previewOnScroll).toBeTypeOf("function");
    });

    act(() => {
      previewOnScroll?.(0.55);
    });

    expect(mockEditorSyncScrollTo).not.toHaveBeenCalled();
  });

  it("marks preview layout inactive in editor-only mode", async () => {
    seedSplitViewStore({ viewMode: ViewMode.EDITOR });
    renderSplitView();

    await waitFor(() => {
      const preview = document.querySelector(
        '[data-testid="preview-pane"]',
      ) as HTMLElement;
      expect(preview.dataset.layoutActive).toBe("false");
    });
  });

  it("marks preview layout active in split mode", async () => {
    seedSplitViewStore({ viewMode: ViewMode.SPLIT });
    renderSplitView();

    await waitFor(() => {
      const preview = document.querySelector(
        '[data-testid="preview-pane"]',
      ) as HTMLElement;
      expect(preview.dataset.layoutActive).toBe("true");
    });
  });

  it("re-anchors the reading pane when switching from editor to reading", async () => {
    seedSplitViewStore({ viewMode: ViewMode.EDITOR });
    renderSplitView();

    await waitFor(() => {
      expect(editorOnScroll).toBeTypeOf("function");
    });

    act(() => {
      editorOnScroll?.(0.25);
    });

    mockEditorSyncScrollTo.mockClear();
    mockPreviewSyncScrollTo.mockClear();

    act(() => {
      useAppStore.setState({ viewMode: ViewMode.PREVIEW } as never);
    });

    await waitFor(() => {
      expect(mockPreviewSyncScrollTo).toHaveBeenCalledWith(0.25, {
        immediate: true,
      });
    });
  });

  it("re-anchors the editor when leaving reading mode", async () => {
    seedSplitViewStore({ viewMode: ViewMode.PREVIEW });
    renderSplitView();

    await waitFor(() => {
      expect(previewOnScroll).toBeTypeOf("function");
    });

    act(() => {
      previewOnScroll?.(0.7);
    });

    mockEditorSyncScrollTo.mockClear();
    mockPreviewSyncScrollTo.mockClear();

    act(() => {
      useAppStore.setState({ viewMode: ViewMode.EDITOR } as never);
    });

    await waitFor(() => {
      expect(mockEditorSyncScrollTo).toHaveBeenCalledWith(0.7, {
        immediate: true,
      });
    });
  });

  it("restores per-tab scroll anchors when switching active tabs", async () => {
    renderSplitView();

    await waitFor(() => {
      expect(editorOnScroll).toBeTypeOf("function");
    });

    act(() => {
      editorOnScroll?.(0.6);
    });

    mockEditorSyncScrollTo.mockClear();
    mockPreviewSyncScrollTo.mockClear();

    act(() => {
      useAppStore.setState({ activeTabId: "tab-b" } as never);
    });

    await waitFor(() => {
      expect(mockEditorSyncScrollTo).toHaveBeenCalledWith(0, {
        immediate: true,
      });
    });

    mockEditorSyncScrollTo.mockClear();
    mockPreviewSyncScrollTo.mockClear();

    act(() => {
      useAppStore.setState({ activeTabId: "tab-a" } as never);
    });

    await waitFor(() => {
      expect(mockEditorSyncScrollTo).toHaveBeenCalledWith(0.6, {
        immediate: true,
      });
    });
  });

  it("resyncs the reading pane after the width transition completes", () => {
    vi.useFakeTimers();
    seedSplitViewStore({ viewMode: ViewMode.EDITOR });
    renderSplitView();

    act(() => {
      editorOnScroll?.(0.33);
    });

    mockEditorSyncScrollTo.mockClear();
    mockPreviewSyncScrollTo.mockClear();

    act(() => {
      useAppStore.setState({ viewMode: ViewMode.PREVIEW } as never);
    });

    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(mockPreviewSyncScrollTo).toHaveBeenCalledWith(0.33, {
      immediate: true,
    });
  });

  it("restores preview scroll anchor for tabs last viewed in reading mode", async () => {
    seedSplitViewStore({ viewMode: ViewMode.PREVIEW });
    renderSplitView();

    await waitFor(() => {
      expect(previewOnScroll).toBeTypeOf("function");
    });

    act(() => {
      previewOnScroll?.(0.18);
    });

    mockPreviewSyncScrollTo.mockClear();

    act(() => {
      useAppStore.setState({ activeTabId: "tab-b" } as never);
    });

    mockPreviewSyncScrollTo.mockClear();

    act(() => {
      useAppStore.setState({
        activeTabId: "tab-a",
        viewMode: ViewMode.PREVIEW,
      } as never);
    });

    expect(mockPreviewSyncScrollTo).toHaveBeenCalledWith(0.18, {
      immediate: true,
    });
    expect(mockEditorSyncScrollTo).not.toHaveBeenCalled();
  });

  it("suppresses percentage sync while outline heading navigation is locked", async () => {
    seedSplitViewStore({ viewMode: ViewMode.SPLIT });
    renderSplitView();

    await waitFor(() => {
      expect(editorOnScroll).toBeTypeOf("function");
      expect(previewOnScroll).toBeTypeOf("function");
    });

    mockPreviewSyncScrollTo.mockClear();
    mockEditorSyncScrollTo.mockClear();
    beginHeadingNavigationLock(1000);

    act(() => {
      editorOnScroll?.(0.42);
      previewOnScroll?.(0.55);
    });

    expect(mockPreviewSyncScrollTo).not.toHaveBeenCalled();
    expect(mockEditorSyncScrollTo).not.toHaveBeenCalled();
  });
});
