import { describe, expect, it } from "vitest";
import { ViewMode } from "../types";
import {
  getNextViewMode,
  isEditorSoloMode,
  isEditorVisibleMode,
  isPreviewVisibleMode,
  normalizeSessionViewMode,
  resolveLastNonSplitViewMode,
} from "./viewMode";

describe("viewMode helpers", () => {
  it("treats EDITOR as solo and SPLIT as dual-pane", () => {
    expect(isEditorSoloMode(ViewMode.EDITOR)).toBe(true);
    expect(isEditorSoloMode(ViewMode.LIVE)).toBe(true); // LIVE → EDITOR
    expect(isEditorSoloMode(ViewMode.SPLIT)).toBe(false);
    expect(isEditorVisibleMode(ViewMode.EDITOR)).toBe(true);
    expect(isEditorVisibleMode(ViewMode.SPLIT)).toBe(true);
    expect(isEditorVisibleMode(ViewMode.PREVIEW)).toBe(false);
    expect(isPreviewVisibleMode(ViewMode.SPLIT)).toBe(true);
    expect(isPreviewVisibleMode(ViewMode.PREVIEW)).toBe(true);
    expect(isPreviewVisibleMode(ViewMode.EDITOR)).toBe(false);
  });

  it("keeps editor/split/preview and maps legacy live onto editor", () => {
    expect(normalizeSessionViewMode(ViewMode.EDITOR)).toBe(ViewMode.EDITOR);
    expect(normalizeSessionViewMode(ViewMode.SPLIT)).toBe(ViewMode.SPLIT);
    expect(normalizeSessionViewMode(ViewMode.PREVIEW)).toBe(ViewMode.PREVIEW);
    expect(normalizeSessionViewMode(ViewMode.LIVE)).toBe(ViewMode.EDITOR);
    expect(resolveLastNonSplitViewMode(ViewMode.EDITOR)).toBe(ViewMode.EDITOR);
    expect(resolveLastNonSplitViewMode(ViewMode.SPLIT)).toBe(ViewMode.EDITOR);
    expect(resolveLastNonSplitViewMode(ViewMode.LIVE)).toBe(ViewMode.EDITOR);
    expect(resolveLastNonSplitViewMode(ViewMode.PREVIEW)).toBe(
      ViewMode.PREVIEW,
    );
  });

  it("cycles source → split → reading → source", () => {
    expect(getNextViewMode(ViewMode.EDITOR)).toBe(ViewMode.SPLIT);
    expect(getNextViewMode(ViewMode.SPLIT)).toBe(ViewMode.PREVIEW);
    expect(getNextViewMode(ViewMode.PREVIEW)).toBe(ViewMode.EDITOR);
    expect(getNextViewMode(ViewMode.LIVE)).toBe(ViewMode.SPLIT);
  });
});
