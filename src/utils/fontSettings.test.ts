import { describe, expect, it } from "vitest";
import { defaultSettings } from "../store/uiStore";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_PREVIEW_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  SYSTEM_DEFAULT_FONT_FAMILY,
  getResolvedCodeFontFamily,
  getResolvedEditorFontFamily,
  getResolvedPreviewFontFamily,
  getResolvedUiFontFamily,
  normalizeStoredEditorFontFamily,
} from "./fontSettings";

describe("fontSettings defaults", () => {
  it("uses the system font setting for all default font zones", () => {
    expect(DEFAULT_UI_FONT_FAMILY).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
    expect(DEFAULT_EDITOR_FONT_FAMILY).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
    expect(DEFAULT_PREVIEW_FONT_FAMILY).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
    expect(DEFAULT_CODE_FONT_FAMILY).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
    expect(defaultSettings).toMatchObject({
      uiFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
      editorFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
      previewFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
      codeFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
    });
  });

  it("resolves system defaults to zone-specific system font stacks", () => {
    const defaults = defaultSettings;

    expect(getResolvedUiFontFamily(defaults)).toContain("-apple-system");
    expect(getResolvedEditorFontFamily(defaults)).toContain("PingFang SC");
    expect(getResolvedPreviewFontFamily(defaults)).toContain("PingFang SC");
    expect(getResolvedCodeFontFamily(defaults)).toContain("SFMono-Regular");
    for (const stack of [
      getResolvedEditorFontFamily(defaults),
      getResolvedPreviewFontFamily(defaults),
    ]) {
      expect(stack).toContain("-apple-system");
      expect(stack).toContain("Segoe UI");
      expect(stack).toContain("Microsoft YaHei");
      expect(stack).toContain("sans-serif");
      expect(stack).not.toMatch(/Songti|SimSun|JinKai|Noto Serif/);
    }
  });
});

describe("removed font presets", () => {
  it.each([
    "preset:tsanger-jinkai",
    "Tsanger JinKai 02",
    "TsangerJinKai02-W04",
    "仓耳今楷",
    '"MarkdownPressPresetTsangerJinKai02", sans-serif',
  ])("falls back to the system default for %s", (legacyFontFamily) => {
    expect(normalizeStoredEditorFontFamily(legacyFontFamily)).toBe(
      SYSTEM_DEFAULT_FONT_FAMILY,
    );

    expect(
      getResolvedEditorFontFamily({ editorFontFamily: legacyFontFamily }),
    ).toBe(getResolvedEditorFontFamily(defaultSettings));
  });
});
