import { describe, expect, it } from "vitest";
import { ViewMode } from "../types";
import { resolvePreviewOnlyViewModeTransition } from "./viewModeSession";

describe("resolvePreviewOnlyViewModeTransition", () => {
  it("saves the current mode and forces preview when entering a preview-only file", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: false,
        isPreviewOnly: true,
        currentViewMode: ViewMode.LIVE,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: ViewMode.LIVE,
    });
  });

  it("maps legacy editor/split onto live when saving before preview-only", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: false,
        isPreviewOnly: true,
        currentViewMode: ViewMode.EDITOR,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: ViewMode.LIVE,
    });

    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: false,
        isPreviewOnly: true,
        currentViewMode: ViewMode.SPLIT,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: ViewMode.LIVE,
    });
  });

  it("restores the saved mode when leaving a preview-only file", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: true,
        isPreviewOnly: false,
        currentViewMode: ViewMode.PREVIEW,
        viewModeBeforePreviewOnly: ViewMode.LIVE,
      }),
    ).toEqual({
      nextViewMode: ViewMode.LIVE,
      nextViewModeBeforePreviewOnly: null,
    });
  });

  it("maps legacy editor restore onto live", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: true,
        isPreviewOnly: false,
        currentViewMode: ViewMode.PREVIEW,
        viewModeBeforePreviewOnly: ViewMode.EDITOR,
      }),
    ).toEqual({
      nextViewMode: ViewMode.LIVE,
      nextViewModeBeforePreviewOnly: null,
    });
  });

  it("keeps an already-selected preview mode when entering preview-only", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: false,
        isPreviewOnly: true,
        currentViewMode: ViewMode.PREVIEW,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: ViewMode.PREVIEW,
    });
  });

  it("does nothing while staying on markdown files", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: false,
        isPreviewOnly: false,
        currentViewMode: ViewMode.LIVE,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({});
  });
});
