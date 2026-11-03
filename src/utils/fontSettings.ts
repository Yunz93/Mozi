import type { AppLanguage, AppSettings } from "../types";
import { isTauriEnvironment, waitForTauri } from "../types/filesystem";
import { getKatexRenderMode } from "./markdown-extensions";

const tsangerJinKaiAssetUrl = new URL(
  "../assets/fonts/TsangerJinKai02-W04.ttf",
  import.meta.url,
).href;

const DYNAMIC_FONT_STYLE_ID = "markdown-press-dynamic-font-faces";
const PRESET_PREFIX = "preset:";
const SYSTEM_PREFIX = "system:";

export type FontZone = "ui" | "content" | "code";
export type FontSettings = Pick<
  AppSettings,
  "uiFontFamily" | "editorFontFamily" | "previewFontFamily" | "codeFontFamily"
>;

export interface BundledFontPreset {
  id: string;
  labelZh: string;
  labelEn: string;
  assetUrl: string;
  fontFaceFamily: string;
  familyNames: string[];
}

interface FontFaceApiSpec {
  assetUrl: string;
  fontFaceFamily: string;
  fontStyle: "normal" | "italic";
  fontWeight: string;
}

export const BUNDLED_FONT_PRESETS: BundledFontPreset[] = [
  {
    id: `${PRESET_PREFIX}tsanger-jinkai`,
    labelZh: "仓耳今楷",
    labelEn: "Tsanger JinKai",
    assetUrl: tsangerJinKaiAssetUrl,
    fontFaceFamily: "MarkdownPressPresetTsangerJinKai02",
    familyNames: [
      "Tsanger JinKai 02",
      "TsangerJinKai02 W04",
      "TsangerJinKai02-W04",
      "TsangerJinKai02",
      "仓耳今楷",
      "仓耳今楷02 W04",
      "仓耳今楷02",
    ],
  },
];

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

const presetById = new Map(
  BUNDLED_FONT_PRESETS.map((preset) => [preset.id, preset]),
);
const presetDataUrlCache = new Map<string, Promise<string>>();

const UI_FONT_FALLBACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const CONTENT_FONT_FALLBACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const CODE_FONT_FALLBACK =
  '"SFMono-Regular", "JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace';

export const SYSTEM_DEFAULT_FONT_FAMILY = SYSTEM_PREFIX;
export const FONT_DEFAULTS_VERSION = 2;
export const LEGACY_DEFAULT_BUNDLED_FONT_FAMILY = `${PRESET_PREFIX}tsanger-jinkai`;
export const LEGACY_DEFAULT_CODE_FONT_FAMILY = CODE_FONT_FALLBACK;
export const DEFAULT_UI_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;
export const DEFAULT_EDITOR_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;
export const DEFAULT_PREVIEW_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;
export const DEFAULT_CODE_FONT_FAMILY = SYSTEM_DEFAULT_FONT_FAMILY;
export const FONT_SETTINGS_STORAGE_KEY = "markdown-press-settings";

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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read blob as data URL"));
    reader.readAsDataURL(blob);
  });
}

async function inlineAssetAsDataUrl(assetUrl: string): Promise<string> {
  const resolvedUrl = resolveAssetUrl(assetUrl);
  const cached = presetDataUrlCache.get(resolvedUrl);
  if (cached) {
    return cached;
  }

  const promise = fetch(resolvedUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(
        `Failed to fetch preset font asset: ${response.status} ${response.statusText}`,
      );
    }

    return blobToDataUrl(await response.blob());
  });

  presetDataUrlCache.set(resolvedUrl, promise);
  return promise;
}

function normalizeSingleFontSetting(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  if (trimmed.startsWith(PRESET_PREFIX)) {
    return presetById.has(trimmed) ? trimmed : fallback;
  }

  if (trimmed.startsWith(SYSTEM_PREFIX)) {
    return trimmed;
  }

  const normalized = trimmed.toLowerCase();
  const matchedPreset = BUNDLED_FONT_PRESETS.find(
    (preset) =>
      preset.id.toLowerCase() === normalized ||
      preset.fontFaceFamily.toLowerCase() === normalized ||
      preset.familyNames.some((name) => name.toLowerCase() === normalized) ||
      preset.familyNames.some((name) =>
        normalized.includes(name.toLowerCase()),
      ),
  );

  if (matchedPreset) {
    return matchedPreset.id;
  }

  if (
    normalized.includes("markdownpressbundled") ||
    normalized.includes("markdownpresslatin")
  ) {
    return fallback;
  }

  if (!trimmed.includes(",") && !isGenericFontFamily(trimmed)) {
    return `${SYSTEM_PREFIX}${trimmed}`;
  }

  return trimmed;
}

function resolveFontSettingToCss(fontSetting: string, zone: FontZone): string {
  if (fontSetting.startsWith(PRESET_PREFIX)) {
    const preset = presetById.get(fontSetting);
    if (!preset) return getZoneFallback(zone);
    return `"${escapeFontName(preset.fontFaceFamily)}", ${getZoneFallback(zone)}`;
  }

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

function collectUsedPresetIds(settings: FontSettings): string[] {
  const normalizedValues = [
    normalizeStoredUiFontFamily(settings.uiFontFamily),
    normalizeStoredEditorFontFamily(settings.editorFontFamily),
    normalizeStoredPreviewFontFamily(settings.previewFontFamily),
    normalizeStoredCodeFontFamily(settings.codeFontFamily),
  ];

  return Array.from(
    new Set(
      normalizedValues.filter((value) => value.startsWith(PRESET_PREFIX)),
    ),
  );
}

function buildPresetFontFaceCss(
  preset: BundledFontPreset,
  assetUrl: string,
): string {
  const resolvedUrl = resolveAssetUrl(assetUrl);
  return `
@font-face {
  font-family: "${escapeFontName(preset.fontFaceFamily)}";
  src: url("${resolvedUrl}") format("truetype");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
`.trim();
}

function buildPresetFontFaceApiSpec(
  preset: BundledFontPreset,
): FontFaceApiSpec {
  return {
    assetUrl: preset.assetUrl,
    fontFaceFamily: preset.fontFaceFamily,
    fontStyle: "normal",
    fontWeight: "400",
  };
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

export function getDefaultFontSettings(): FontSettings {
  return {
    uiFontFamily: DEFAULT_UI_FONT_FAMILY,
    editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    previewFontFamily: DEFAULT_PREVIEW_FONT_FAMILY,
    codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
  };
}

export function getInitialFontSettingsFromLocalStorage(): FontSettings {
  const defaults = getDefaultFontSettings();
  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(FONT_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    type LegacyFontSettingsPayload = Partial<AppSettings> & {
      englishFontFamily?: string;
      chineseFontFamily?: string;
      fontFamily?: string;
    };
    const parsed = JSON.parse(raw) as {
      state?: { settings?: LegacyFontSettingsPayload };
      settings?: LegacyFontSettingsPayload;
    };
    const persistedSettings: LegacyFontSettingsPayload =
      parsed?.state?.settings ?? parsed?.settings ?? {};

    return {
      uiFontFamily: normalizeStoredUiFontFamily(persistedSettings.uiFontFamily),
      editorFontFamily: normalizeStoredEditorFontFamily(
        persistedSettings.editorFontFamily ??
          persistedSettings.chineseFontFamily ??
          persistedSettings.englishFontFamily ??
          persistedSettings.fontFamily,
      ),
      previewFontFamily: normalizeStoredPreviewFontFamily(
        persistedSettings.previewFontFamily ??
          persistedSettings.chineseFontFamily ??
          persistedSettings.englishFontFamily ??
          persistedSettings.fontFamily,
      ),
      codeFontFamily: normalizeStoredCodeFontFamily(
        persistedSettings.codeFontFamily,
      ),
    };
  } catch {
    return defaults;
  }
}

export function buildSystemFontFamily(fontName: string): string {
  return `${SYSTEM_PREFIX}${fontName.trim()}`;
}

export function getBundledPresetDisplayLabel(
  preset: BundledFontPreset,
  language: AppLanguage,
): string {
  return language === "en" ? preset.labelEn : preset.labelZh;
}

export function getBundledPresetLabelForFontFamily(
  fontName: string,
  language: AppLanguage = "zh-CN",
): string | null {
  const normalized = fontName.trim().toLowerCase();
  const preset = BUNDLED_FONT_PRESETS.find(
    (item) =>
      item.labelZh.toLowerCase() === normalized ||
      item.labelEn.toLowerCase() === normalized ||
      item.fontFaceFamily.toLowerCase() === normalized ||
      item.familyNames.some((name) => name.toLowerCase() === normalized),
  );

  return preset ? getBundledPresetDisplayLabel(preset, language) : null;
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

export function getBundledPresetAssetUrl(presetId: string): string | null {
  return presetById.get(presetId)?.assetUrl ?? null;
}

export async function getBundledPresetDataUrl(
  presetId: string,
): Promise<string | null> {
  const assetUrl = getBundledPresetAssetUrl(presetId);
  if (!assetUrl) {
    return null;
  }

  return inlineAssetAsDataUrl(assetUrl);
}

export async function getBundledPresetDataUrlOverrides(
  settings: FontSettings,
): Promise<Record<string, string>> {
  const overrides = await Promise.all(
    collectUsedPresetIds(settings).map(async (presetId) => {
      try {
        const dataUrl = await getBundledPresetDataUrl(presetId);
        return dataUrl ? ([presetId, dataUrl] as const) : null;
      } catch (error) {
        console.warn(`Failed to inline preset font ${presetId}:`, error);
        return null;
      }
    }),
  );

  return Object.fromEntries(
    overrides.filter((entry): entry is readonly [string, string] =>
      Boolean(entry),
    ),
  );
}

export function buildDynamicFontFaceCss(
  settings: FontSettings,
  overrides: Partial<Record<string, string>> = {},
): string {
  return collectUsedPresetIds(settings)
    .map((presetId) => {
      const preset = presetById.get(presetId);
      if (!preset) return "";
      return buildPresetFontFaceCss(
        preset,
        overrides[presetId] ?? preset.assetUrl,
      );
    })
    .filter(Boolean)
    .join("\n\n");
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

export async function ensureDynamicFontFaces(
  settings: FontSettings,
): Promise<void> {
  if (typeof document === "undefined") return;

  if (isTauriEnvironment()) {
    try {
      await waitForTauri(800);
    } catch {
      // ignore - continue with best-effort environment detection
    }
  }

  const useTauriFontFaceApi = isTauriEnvironment();
  const shouldLoadKatexViaFontFaceApi =
    useTauriFontFaceApi && getKatexRenderMode() !== "mathml";
  const usedPresetIds = collectUsedPresetIds(settings);

  if (useTauriFontFaceApi) {
    // WKWebView 无法通过 CSS @font-face { src: url("tauri://...") } 加载字体。
    // 改用 JS Fetch + FontFace API 绕过 CSS 资源加载器。
    // 参见 src/utils/webkitCompat.ts — Quirk 2
    const results = await Promise.allSettled(
      [
        ...usedPresetIds
          .map((presetId) => {
            const preset = presetById.get(presetId);
            if (!preset) return null;
            return buildPresetFontFaceApiSpec(preset);
          })
          .filter((spec): spec is FontFaceApiSpec => Boolean(spec)),
      ].map((spec) => loadFontViaFontFaceApi(spec)),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("[fontSettings] FontFace API load failed:", result.reason);
      }
    }
  }

  if (shouldLoadKatexViaFontFaceApi) {
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

  // Inject @font-face CSS. In Tauri the font data is already loaded via
  // FontFace API above, so the CSS declaration just makes the family name
  // available in the cascade (the src: url() won't actually be needed).
  // In web builds, the CSS src: url() (with data: overrides) is the primary
  // loading mechanism.
  const overrides = useTauriFontFaceApi
    ? {}
    : await getBundledPresetDataUrlOverrides(settings);
  const css = buildDynamicFontFaceCss(settings, overrides);

  let styleElement = document.getElementById(
    DYNAMIC_FONT_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = DYNAMIC_FONT_STYLE_ID;
    document.head.appendChild(styleElement);
  }

  if (styleElement.textContent !== css) {
    styleElement.textContent = css;
  }

  if (!useTauriFontFaceApi && css && document.fonts) {
    const loadTargets = usedPresetIds
      .map((presetId) => presetById.get(presetId)?.fontFaceFamily)
      .filter((name): name is string => Boolean(name))
      .map((name) => document.fonts.load(`1em "${name}"`, "Aa测"));
    await Promise.all(loadTargets);
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
