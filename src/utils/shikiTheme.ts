import type { MarkdownStylePreset, ThemeMode } from "../types";
import {
  getMarkdownStyleTokens,
  MARKDOWN_STYLE_PRESETS,
  normalizeMarkdownStylePreset,
} from "./markdownStyle";

type ShikiThemeRegistration = {
  name: string;
  displayName?: string;
  type: "light" | "dark";
  fg: string;
  bg: string;
  settings: Array<{
    scope?: string | string[];
    settings: {
      foreground?: string;
      fontStyle?: string;
    };
  }>;
  colors?: Record<string, string>;
};

function getThemeName(
  preset: MarkdownStylePreset,
  themeMode: ThemeMode,
): string {
  return `markdown-press-${preset}-${themeMode}`;
}

function toDisplayName(
  preset: MarkdownStylePreset,
  themeMode: ThemeMode,
): string {
  return `Moji ${preset.charAt(0).toUpperCase()}${preset.slice(1)} ${themeMode.charAt(0).toUpperCase()}${themeMode.slice(1)}`;
}

function createTheme(
  preset: MarkdownStylePreset,
  themeMode: ThemeMode,
): ShikiThemeRegistration {
  const tokens = getMarkdownStyleTokens(preset, themeMode);
  return {
    name: getThemeName(preset, themeMode),
    displayName: toDisplayName(preset, themeMode),
    type: themeMode,
    fg: tokens.codeText,
    bg: tokens.codeBg,
    colors: {
      "editor.foreground": tokens.codeText,
      "editor.background": tokens.codeBg,
    },
    settings: [
      { settings: { foreground: tokens.codeText } },
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: tokens.codeComment, fontStyle: "italic" },
      },
      {
        scope: [
          "keyword",
          "storage",
          "storage.modifier",
          "storage.type",
          "keyword.control",
        ],
        settings: { foreground: tokens.codeKeyword },
      },
      {
        scope: ["keyword.operator"],
        settings: { foreground: tokens.codeOperator },
      },
      {
        scope: ["string", "string.template", "constant.other.symbol"],
        settings: { foreground: tokens.codeString },
      },
      {
        scope: ["constant.numeric"],
        settings: { foreground: tokens.codeNumber },
      },
      {
        scope: [
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
        ],
        settings: { foreground: tokens.codeOperator },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
        ],
        settings: { foreground: tokens.codeFunction },
      },
      {
        scope: [
          "entity.name.type",
          "support.type",
          "support.class",
          "entity.name.tag",
        ],
        settings: { foreground: tokens.codeType },
      },
      {
        scope: ["variable", "identifier"],
        settings: { foreground: tokens.codeVariable },
      },
      {
        scope: [
          "variable.other.property",
          "meta.object-literal.key",
          "entity.other.attribute-name",
        ],
        settings: { foreground: tokens.codeProperty },
      },
      {
        scope: ["punctuation", "meta.brace", "meta.delimiter"],
        settings: { foreground: tokens.codeComment },
      },
    ],
  };
}

export const MARKDOWN_PRESS_SHIKI_THEMES = MARKDOWN_STYLE_PRESETS.flatMap(
  (preset) => [createTheme(preset, "light"), createTheme(preset, "dark")],
);

export function getMarkdownPressShikiTheme(
  themeMode: ThemeMode,
  markdownStylePreset: MarkdownStylePreset = "nord",
): string {
  return getThemeName(
    normalizeMarkdownStylePreset(markdownStylePreset),
    themeMode,
  );
}
