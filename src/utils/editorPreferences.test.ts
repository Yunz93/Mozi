import { describe, expect, it } from "vitest";
import { ViewMode } from "../types";
import {
  buildCloseBracketChars,
  buildIndentUnitString,
  normalizeDefaultViewMode,
  normalizeTabSize,
} from "./editorPreferences";

describe("normalizeTabSize", () => {
  it("clamps to 2 or 4", () => {
    expect(normalizeTabSize(2)).toBe(2);
    expect(normalizeTabSize(4)).toBe(4);
    expect(normalizeTabSize(3)).toBe(4);
    expect(normalizeTabSize("2")).toBe(2);
    expect(normalizeTabSize(undefined)).toBe(4);
  });
});

describe("normalizeDefaultViewMode", () => {
  it("defaults unknown values to live", () => {
    expect(normalizeDefaultViewMode(undefined)).toBe(ViewMode.LIVE);
    expect(normalizeDefaultViewMode("nope")).toBe(ViewMode.LIVE);
  });

  it("keeps live/preview and maps legacy editor/split to live", () => {
    expect(normalizeDefaultViewMode("LIVE")).toBe(ViewMode.LIVE);
    expect(normalizeDefaultViewMode(ViewMode.LIVE)).toBe(ViewMode.LIVE);
    expect(normalizeDefaultViewMode(ViewMode.PREVIEW)).toBe(ViewMode.PREVIEW);
    expect(normalizeDefaultViewMode("EDITOR")).toBe(ViewMode.LIVE);
    expect(normalizeDefaultViewMode(ViewMode.EDITOR)).toBe(ViewMode.LIVE);
    expect(normalizeDefaultViewMode("SPLIT")).toBe(ViewMode.LIVE);
    expect(normalizeDefaultViewMode(ViewMode.SPLIT)).toBe(ViewMode.LIVE);
  });
});

describe("buildIndentUnitString", () => {
  it("returns spaces or a tab based on settings", () => {
    expect(buildIndentUnitString(2, false)).toBe("  ");
    expect(buildIndentUnitString(4, false)).toBe("    ");
    expect(buildIndentUnitString(4, true)).toBe("\t");
  });
});

describe("buildCloseBracketChars", () => {
  it("combines bracket and markdown pairs", () => {
    expect(buildCloseBracketChars(false, false)).toEqual([]);
    expect(buildCloseBracketChars(true, false)).toEqual([
      "(",
      "[",
      "{",
      "'",
      '"',
    ]);
    expect(buildCloseBracketChars(false, true)).toEqual(["*", "_", "`", "~"]);
    expect(buildCloseBracketChars(true, true)).toEqual([
      "(",
      "[",
      "{",
      "'",
      '"',
      "*",
      "_",
      "`",
      "~",
    ]);
  });
});
