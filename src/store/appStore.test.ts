/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  DEFAULT_AI_SYSTEM_PROMPT_EN,
  DEFAULT_WIKI_PROMPT_TEMPLATE,
  DEFAULT_WIKI_PROMPT_TEMPLATE_EN,
} from "../services/aiPrompts";
import {
  APP_STORE_PERSIST_NAME,
  defaultSettings,
  didAppStoreHydrationFail,
  resolveLocalizedPrompts,
  resolvePersistedFontSettings,
  resolvePersistedAISettings,
  stripNonRuntimeSettings,
  useAppStore,
} from "./appStore";
import {
  FONT_DEFAULTS_VERSION,
  SYSTEM_DEFAULT_FONT_FAMILY,
} from "../utils/fontSettings";
import { resolvePersistedShortcuts } from "./persistMigrations";

afterEach(() => {
  useAppStore.setState({
    openTabs: [],
    activeTabId: null,
    fileContents: {},
    lastSavedContent: {},
  });
});

describe("stripNonRuntimeSettings", () => {
  it("removes AI API keys from persisted settings", () => {
    const settings = stripNonRuntimeSettings({
      geminiApiKey: "gemini-secret",
      codexApiKey: "openai-secret",
      deepseekApiKey: "deepseek-secret",
      language: "zh-CN",
    });

    expect(settings).toEqual({ language: "zh-CN" });
  });

  it("removes image hosting secrets from persisted settings", () => {
    const settings = stripNonRuntimeSettings({
      imageHostingGithubToken: "ghp_secret",
      imageHostingS3SecretAccessKey: "s3-secret",
      imageHostingOssAccessKeySecret: "oss-secret",
      imageHostingQiniuSecretKey: "qiniu-secret",
      language: "en",
    });

    expect(settings).toEqual({ language: "en" });
  });

  it("removes deleted export strikethrough setting from persisted settings", () => {
    const settings = stripNonRuntimeSettings({
      language: "zh-CN",
      exportStrikethroughMode: "raster-safe",
    });

    expect(settings).toEqual({ language: "zh-CN" });
  });
});

describe("defaultSettings", () => {
  it("uses DeepSeek as the default AI provider", () => {
    expect(defaultSettings.aiProvider).toBe("deepseek");
    expect(defaultSettings.deepseekApiBaseUrl).toBe("https://api.deepseek.com");
    expect(defaultSettings.deepseekModel).toBe("deepseek-v4-flash");
  });

  it("defaults new notes to the knowledge base root", () => {
    expect(defaultSettings.newNoteLocation).toBe("knowledgeBaseRoot");
    expect(defaultSettings.newNoteFolder).toBe("notes");
    expect(defaultSettings.attachmentLocation).toBe("resourceFolder");
    expect(defaultSettings.defaultViewMode).toBe("LIVE");
    expect(defaultSettings.tabSize).toBe(4);
    expect(defaultSettings.readableLineLength).toBe(true);
    expect(defaultSettings.convertHtmlOnPaste).toBe(true);
    expect(defaultSettings.fillMissingFrontmatterOnSave).toBe(true);
    expect(defaultSettings.refreshFrontmatterOnSave).toBe(true);
    expect(defaultSettings.indexExcludeGlobs).toEqual([
      ".trash/**",
      "**/node_modules/**",
    ]);
    expect(defaultSettings.shortcuts.commandPalette).toMatch(/Shift\+P$/);
  });
});

describe("persisted shortcut migration", () => {
  it("fills commandPalette when older settings omit it", () => {
    const shortcuts = resolvePersistedShortcuts({
      shortcuts: { save: "Ctrl+S" },
    });
    expect(shortcuts.commandPalette).toBe(
      defaultSettings.shortcuts.commandPalette,
    );
  });
});

describe("persisted AI settings migration", () => {
  it("keeps legacy Gemini-only settings on the Gemini provider", () => {
    const settings = resolvePersistedAISettings({
      geminiModel: "gemini-2.0-flash-exp",
    });

    expect(settings.aiProvider).toBe("gemini");
    expect(settings.geminiModel).toBe("gemini-2.0-flash-exp");
  });
});

describe("persisted font settings migration", () => {
  it("migrates old bundled default font settings to the system default", () => {
    const settings = resolvePersistedFontSettings({
      uiFontFamily: "preset:tsanger-jinkai",
      editorFontFamily: "preset:tsanger-jinkai",
      previewFontFamily: "Tsanger JinKai 02",
      codeFontFamily:
        '"SFMono-Regular", "JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
    });

    expect(settings.fontDefaultsVersion).toBe(FONT_DEFAULTS_VERSION);
    expect(settings.uiFontFamily).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
    expect(settings.editorFontFamily).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
    expect(settings.previewFontFamily).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
    expect(settings.codeFontFamily).toBe(SYSTEM_DEFAULT_FONT_FAMILY);
  });

  it("preserves an explicit bundled font after the default-font migration has run", () => {
    const settings = resolvePersistedFontSettings({
      fontDefaultsVersion: FONT_DEFAULTS_VERSION,
      editorFontFamily: "preset:tsanger-jinkai",
    });

    expect(settings.editorFontFamily).toBe("preset:tsanger-jinkai");
  });
});

describe("resolveLocalizedPrompts", () => {
  it("maps legacy built-in English prompts back to localized defaults", () => {
    const prompts = resolveLocalizedPrompts({
      aiSystemPrompt: DEFAULT_AI_SYSTEM_PROMPT_EN,
      wikiPromptTemplate: DEFAULT_WIKI_PROMPT_TEMPLATE_EN,
    });

    expect(prompts.aiSystemPromptZh).toBe(DEFAULT_AI_SYSTEM_PROMPT);
    expect(prompts.aiSystemPromptEn).toBe(DEFAULT_AI_SYSTEM_PROMPT_EN);
    expect(prompts.wikiPromptTemplateZh).toBe(DEFAULT_WIKI_PROMPT_TEMPLATE);
    expect(prompts.wikiPromptTemplateEn).toBe(DEFAULT_WIKI_PROMPT_TEMPLATE_EN);
  });

  it("preserves custom legacy prompts for both languages when no localized fields exist", () => {
    const prompts = resolveLocalizedPrompts({
      aiSystemPrompt: "Custom shared prompt",
      wikiPromptTemplate: "Custom shared wiki prompt",
    });

    expect(prompts.aiSystemPromptZh).toBe("Custom shared prompt");
    expect(prompts.aiSystemPromptEn).toBe("Custom shared prompt");
    expect(prompts.wikiPromptTemplateZh).toBe("Custom shared wiki prompt");
    expect(prompts.wikiPromptTemplateEn).toBe("Custom shared wiki prompt");
  });

  it("keeps explicit localized prompt overrides", () => {
    const prompts = resolveLocalizedPrompts({
      aiSystemPrompt: DEFAULT_AI_SYSTEM_PROMPT_EN,
      aiSystemPromptZh: "显式中文提示词",
      wikiPromptTemplate: DEFAULT_WIKI_PROMPT_TEMPLATE,
      wikiPromptTemplateEn: "Explicit English wiki prompt",
    });

    expect(prompts.aiSystemPromptZh).toBe("显式中文提示词");
    expect(prompts.aiSystemPromptEn).toBe(DEFAULT_AI_SYSTEM_PROMPT_EN);
    expect(prompts.wikiPromptTemplateZh).toBe(DEFAULT_WIKI_PROMPT_TEMPLATE);
    expect(prompts.wikiPromptTemplateEn).toBe("Explicit English wiki prompt");
  });
});

describe("tab saved baseline", () => {
  it("treats content loaded from disk as saved when opening a tab", () => {
    const fileId = "/vault/note.md";

    useAppStore.getState().addTab(fileId, "# Loaded from disk\n");

    expect(useAppStore.getState().fileContents[fileId]).toBe(
      "# Loaded from disk\n",
    );
    expect(useAppStore.getState().lastSavedContent[fileId]).toBe(
      "# Loaded from disk\n",
    );
    expect(useAppStore.getState().hasUnsavedChanges(fileId)).toBe(false);
  });

  it("replaces the previous open document instead of stacking tabs", () => {
    useAppStore.getState().addTab("/vault/a.md", "A");
    useAppStore.getState().addTab("/vault/b.md", "B");

    const state = useAppStore.getState();
    expect(state.openTabs).toEqual(["/vault/b.md"]);
    expect(state.activeTabId).toBe("/vault/b.md");
    expect(state.fileContents).toEqual({ "/vault/b.md": "B" });
    expect(state.fileContents["/vault/a.md"]).toBeUndefined();
  });
});

describe("app store hydration recovery", () => {
  it("finishes hydration with defaults when persisted JSON is corrupt", async () => {
    localStorage.setItem(APP_STORE_PERSIST_NAME, '{"state":');
    const persist = (
      useAppStore as unknown as {
        persist: {
          rehydrate: () => Promise<void> | void;
          hasHydrated: () => boolean;
        };
      }
    ).persist;

    await persist.rehydrate();

    expect(persist.hasHydrated() || didAppStoreHydrationFail()).toBe(true);
    expect(useAppStore.getState().settings.language).toBe(
      defaultSettings.language,
    );
    expect(useAppStore.getState().settings.aiProvider).toBe(
      defaultSettings.aiProvider,
    );
  });
});
