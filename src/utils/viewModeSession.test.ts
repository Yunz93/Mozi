import { describe, expect, it } from "vitest";
import { ViewMode } from "../types";
import { resolvePreviewOnlyViewModeTransition } from "./viewModeSession";

describe("resolvePreviewOnlyViewModeTransition", () => {
  it("saves the current mode and forces preview when entering a preview-only file", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: false,
        isPreviewOnly: true,
        currentViewMode: ViewMode.SPLIT,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: ViewMode.SPLIT,
    });
  });

  it("preserves source mode when saving before preview-only", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: false,
        isPreviewOnly: true,
        currentViewMode: ViewMode.EDITOR,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({
      nextViewMode: ViewMode.PREVIEW,
      nextViewModeBeforePreviewOnly: ViewMode.EDITOR,
    });
  });

  it("restores the saved mode when leaving a preview-only file", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: true,
        isPreviewOnly: false,
        currentViewMode: ViewMode.PREVIEW,
        viewModeBeforePreviewOnly: ViewMode.EDITOR,
      }),
    ).toEqual({
      nextViewMode: ViewMode.EDITOR,
      nextViewModeBeforePreviewOnly: null,
    });
  });

  it("maps legacy live restore onto editor", () => {
    expect(
      resolvePreviewOnlyViewModeTransition({
        wasPreviewOnly: true,
        isPreviewOnly: false,
        currentViewMode: ViewMode.PREVIEW,
        viewModeBeforePreviewOnly: ViewMode.LIVE,
      }),
    ).toEqual({
      nextViewMode: ViewMode.EDITOR,
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
        currentViewMode: ViewMode.EDITOR,
        viewModeBeforePreviewOnly: null,
      }),
    ).toEqual({});
  });
});
