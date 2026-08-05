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
  it("treats LIVE as solo edit and PREVIEW as reading", () => {
    expect(isEditorSoloMode(ViewMode.LIVE)).toBe(true);
    expect(isEditorSoloMode(ViewMode.EDITOR)).toBe(true); // EDITOR → LIVE
    expect(isEditorSoloMode(ViewMode.SPLIT)).toBe(true); // SPLIT → LIVE
    expect(isEditorSoloMode(ViewMode.PREVIEW)).toBe(false);
    expect(isEditorVisibleMode(ViewMode.LIVE)).toBe(true);
    expect(isEditorVisibleMode(ViewMode.PREVIEW)).toBe(false);
    expect(isPreviewVisibleMode(ViewMode.PREVIEW)).toBe(true);
    expect(isPreviewVisibleMode(ViewMode.LIVE)).toBe(false);
    expect(isPreviewVisibleMode(ViewMode.SPLIT)).toBe(false);
  });

  it("keeps live/preview and maps legacy editor/split onto live", () => {
    expect(normalizeSessionViewMode(ViewMode.LIVE)).toBe(ViewMode.LIVE);
    expect(normalizeSessionViewMode(ViewMode.PREVIEW)).toBe(ViewMode.PREVIEW);
    expect(normalizeSessionViewMode(ViewMode.EDITOR)).toBe(ViewMode.LIVE);
    expect(normalizeSessionViewMode(ViewMode.SPLIT)).toBe(ViewMode.LIVE);
    expect(resolveLastNonSplitViewMode(ViewMode.LIVE)).toBe(ViewMode.LIVE);
    expect(resolveLastNonSplitViewMode(ViewMode.EDITOR)).toBe(ViewMode.LIVE);
    expect(resolveLastNonSplitViewMode(ViewMode.SPLIT)).toBe(ViewMode.LIVE);
    expect(resolveLastNonSplitViewMode(ViewMode.PREVIEW)).toBe(
      ViewMode.PREVIEW,
    );
  });

  it("cycles live → reading → live", () => {
    expect(getNextViewMode(ViewMode.LIVE)).toBe(ViewMode.PREVIEW);
    expect(getNextViewMode(ViewMode.PREVIEW)).toBe(ViewMode.LIVE);
    expect(getNextViewMode(ViewMode.EDITOR)).toBe(ViewMode.PREVIEW);
    expect(getNextViewMode(ViewMode.SPLIT)).toBe(ViewMode.PREVIEW);
  });
});
