import { describe, expect, it } from "vitest";
import {
  BUNDLED_FONT_PRESETS,
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_PREVIEW_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  SYSTEM_DEFAULT_FONT_FAMILY,
  getDefaultFontSettings,
  getBundledPresetDisplayLabel,
  getBundledPresetLabelForFontFamily,
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
    expect(getDefaultFontSettings()).toEqual({
      uiFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
      editorFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
      previewFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
      codeFontFamily: SYSTEM_DEFAULT_FONT_FAMILY,
    });
  });

  it("resolves system defaults to zone-specific system font stacks", () => {
    const defaults = getDefaultFontSettings();

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

describe("bundled font presets", () => {
  it("shows locale-specific bundled labels while preserving legacy matching", () => {
    const preset = BUNDLED_FONT_PRESETS.find(
      (item) => item.id === "preset:tsanger-jinkai",
    );

    expect(preset?.labelZh).toBe("仓耳今楷");
    expect(preset?.labelEn).toBe("Tsanger JinKai");
    expect(getBundledPresetDisplayLabel(preset!, "zh-CN")).toBe("仓耳今楷");
    expect(getBundledPresetDisplayLabel(preset!, "en")).toBe("Tsanger JinKai");
    expect(normalizeStoredEditorFontFamily("Tsanger JinKai 02")).toBe(
      "preset:tsanger-jinkai",
    );
    expect(normalizeStoredEditorFontFamily("仓耳今楷")).toBe(
      "preset:tsanger-jinkai",
    );
    expect(
      getBundledPresetLabelForFontFamily("Tsanger JinKai 02", "zh-CN"),
    ).toBe("仓耳今楷");
    expect(getBundledPresetLabelForFontFamily("Tsanger JinKai 02", "en")).toBe(
      "Tsanger JinKai",
    );
  });
});
