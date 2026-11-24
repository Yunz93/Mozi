import type { AppSettings } from "../types";
import { isTauriEnvironment, waitForTauri } from "../types/filesystem";
import { getKatexRenderMode } from "./markdown-extensions";

const LEGACY_PRESET_PREFIX = "preset:";
const LEGACY_BUNDLED_FONT_ALIAS =
  /markdownpress(?:bundled|latin|presettsangerjinkai02)|tsanger(?: jinkai 02|jinkai02)|仓耳今楷/i;
const SYSTEM_PREFIX = "system:";

export type FontZone = "ui" | "content" | "code";
export type FontSettings = Pick<
  AppSettings,
  "uiFontFamily" | "editorFontFamily" | "previewFontFamily" | "codeFontFamily"
>;

interface FontFaceApiSpec {
  assetUrl: string;
  fontFaceFamily: string;
  fontStyle: "normal" | "italic";
  fontWeight: string;
}

const KATEX_TAURI_FONT_SPECS: FontFaceApiSpec[] = [
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_AMS-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_AMS",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Caligraphic",
    fontStyle: "normal",
    fontWeight: "700",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Caligraphic",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Fraktur-Bold.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Fraktur",
    fontStyle: "normal",
    fontWeight: "700",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Fraktur-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Fraktur",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Main-Bold.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Main",
    fontStyle: "normal",
    fontWeight: "700",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Main-BoldItalic.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Main",
    fontStyle: "italic",
    fontWeight: "700",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Main-Italic.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Main",
    fontStyle: "italic",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Main",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Math-BoldItalic.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Math",
    fontStyle: "italic",
    fontWeight: "700",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Math-Italic.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Math",
    fontStyle: "italic",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_SansSerif-Bold.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_SansSerif",
    fontStyle: "normal",
    fontWeight: "700",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_SansSerif-Italic.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_SansSerif",
    fontStyle: "italic",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_SansSerif-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_SansSerif",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Script-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Script",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Size1-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Size1",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Size2-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Size2",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Size3-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Size3",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Size4-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Size4",
    fontStyle: "normal",
    fontWeight: "400",
  },
  {
    assetUrl: new URL(
      "../../node_modules/katex/dist/fonts/KaTeX_Typewriter-Regular.woff2",
      import.meta.url,
    ).href,
    fontFaceFamily: "KaTeX_Typewriter",
    fontStyle: "normal",
    fontWeight: "400",
  },
];

const UI_FONT_FALLBACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const CONTENT_FONT_FALLBACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const CODE_FONT_FALLBACK =
  '"SFMono-Regular", "JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace';

export const SYSTEM_DEFAULT_FONT_FAMILY = SYSTEM_PREFIX;
export const FONT_DEFAULTS_VERSION = 2;
export const LEGACY_DEFAULT_CODE_FONT_FAMILY = CODE_FONT_FALLBACK;
export const DEFAULT_UI_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;
export const DEFAULT_EDITOR_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;
export const DEFAULT_PREVIEW_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;
export const DEFAULT_CODE_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;

function getZoneFallback(zone: FontZone): string {
  if (zone === "ui") return UI_FONT_FALLBACK;
  if (zone === "code") return CODE_FONT_FALLBACK;
  return CONTENT_FONT_FALLBACK;
}

function escapeFontName(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isGenericFontFamily(value: string): boolean {
  return new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "emoji",
    "math",
    "fangsong",
  ]).has(value.trim().toLowerCase());
}

function resolveAssetUrl(assetUrl: string): string {
  if (typeof window === "undefined") {
    return assetUrl;
  }

  if (assetUrl.startsWith("http")) {
    return assetUrl;
  }

  return new URL(assetUrl, window.location.href).href;
}

function normalizeSingleFontSetting(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  if (trimmed.startsWith(SYSTEM_PREFIX)) {
    return trimmed;
  }

  if (
    trimmed.toLowerCase().startsWith(LEGACY_PRESET_PREFIX) ||
    LEGACY_BUNDLED_FONT_ALIAS.test(trimmed)
  ) {
    return fallback;
  }

  if (!trimmed.includes(",") && !isGenericFontFamily(trimmed)) {
    return `${SYSTEM_PREFIX}${trimmed}`;
  }

  return trimmed;
}

function resolveFontSettingToCss(fontSetting: string, zone: FontZone): string {
  if (fontSetting.startsWith(SYSTEM_PREFIX)) {
    const fontName = fontSetting.slice(SYSTEM_PREFIX.length).trim();
    return fontName
      ? `"${escapeFontName(fontName)}", ${getZoneFallback(zone)}`
      : getZoneFallback(zone);
  }

  if (fontSetting.includes(",") || isGenericFontFamily(fontSetting)) {
    return fontSetting;
  }

  return `"${escapeFontName(fontSetting)}", ${getZoneFallback(zone)}`;
}

export function normalizeStoredUiFontFamily(value: string | undefined): string {
  return normalizeSingleFontSetting(value, DEFAULT_UI_FONT_FAMILY);
}

export function normalizeStoredEditorFontFamily(
  value: string | undefined,
): string {
  return normalizeSingleFontSetting(value, DEFAULT_EDITOR_FONT_FAMILY);
}

export function normalizeStoredPreviewFontFamily(
  value: string | undefined,
): string {
  return normalizeSingleFontSetting(value, DEFAULT_PREVIEW_FONT_FAMILY);
}

export function normalizeStoredCodeFontFamily(
  value: string | undefined,
): string {
  return normalizeSingleFontSetting(value, DEFAULT_CODE_FONT_FAMILY);
}

export function buildSystemFontFamily(fontName: string): string {
  return `${SYSTEM_PREFIX}${fontName.trim()}`;
}

export function getResolvedUiFontFamily(
  settings: Pick<AppSettings, "uiFontFamily">,
): string {
  return resolveFontSettingToCss(
    normalizeStoredUiFontFamily(settings.uiFontFamily),
    "ui",
  );
}

export function getResolvedEditorFontFamily(
  settings: Pick<AppSettings, "editorFontFamily">,
): string {
  return resolveFontSettingToCss(
    normalizeStoredEditorFontFamily(settings.editorFontFamily),
    "content",
  );
}

export function getResolvedPreviewFontFamily(
  settings: Pick<AppSettings, "previewFontFamily">,
): string {
  return resolveFontSettingToCss(
    normalizeStoredPreviewFontFamily(settings.previewFontFamily),
    "content",
  );
}

export function getResolvedCodeFontFamily(
  settings: Pick<AppSettings, "codeFontFamily">,
): string {
  return resolveFontSettingToCss(
    normalizeStoredCodeFontFamily(settings.codeFontFamily),
    "code",
  );
}

async function loadFontViaFontFaceApi(spec: FontFaceApiSpec): Promise<void> {
  if (!document.fonts) return;

  const resolvedUrl = resolveAssetUrl(spec.assetUrl);
  const existing = Array.from(document.fonts).find(
    (f) =>
      f.family === spec.fontFaceFamily &&
      f.style === spec.fontStyle &&
      f.weight === spec.fontWeight,
  );
  if (existing?.status === "loaded") return;

  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch font ${spec.fontFaceFamily}: ${response.status}`,
    );
  }

  const buffer = await response.arrayBuffer();
  const face = new FontFace(spec.fontFaceFamily, buffer, {
    style: spec.fontStyle,
    weight: spec.fontWeight,
    display: "swap",
  });
  await face.load();
  document.fonts.add(face);
}

export async function ensureKatexFontFaces(): Promise<void> {
  if (typeof document === "undefined" || !isTauriEnvironment()) return;

  try {
    await waitForTauri(800);
  } catch {
    // 等待失败时继续检查当前运行环境。
  }

  if (!isTauriEnvironment() || getKatexRenderMode() === "mathml") return;

  const results = await Promise.allSettled(
    KATEX_TAURI_FONT_SPECS.map((spec) => loadFontViaFontFaceApi(spec)),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn(
        "[fontSettings] KaTeX FontFace API load failed:",
        result.reason,
      );
    }
  }
}

export function buildPreviewExportFontFamily(
  settings: Pick<AppSettings, "previewFontFamily">,
): string {
  return getResolvedPreviewFontFamily(settings);
}

export function buildCodeExportFontFamily(
  settings: Pick<AppSettings, "codeFontFamily">,
): string {
  return getResolvedCodeFontFamily(settings);
}
