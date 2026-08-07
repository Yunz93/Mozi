import type { AppSettings, ImageHostingConfig, Notification } from "../types";
import { ViewMode } from "../types";
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  DEFAULT_AI_SYSTEM_PROMPT_EN,
  DEFAULT_WIKI_PROMPT_TEMPLATE,
  DEFAULT_WIKI_PROMPT_TEMPLATE_EN,
} from "../services/aiPrompts";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_PREVIEW_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  FONT_DEFAULTS_VERSION,
} from "../utils/fontSettings";
import {
  DEFAULT_MARKDOWN_STYLE_PRESET,
  normalizeMarkdownStylePreset,
} from "../utils/markdownStyle";
import { DEFAULT_METADATA_FIELDS } from "../utils/metadataFields";
import { normalizeWikiFolder } from "../utils/wikiGeneration";
import { normalizeTrashFolder } from "../utils/trashFolder";
import { normalizeAttachmentLocation } from "../utils/attachmentLocation";
import {
  normalizeDefaultViewMode,
  normalizeTabSize,
} from "../utils/editorPreferences";
import { normalizeNewNoteLocation } from "../utils/newNoteLocation";
import { getPreferredShortcutModifierToken } from "../utils/shortcuts";

function normalizeThemeMode(themeMode: unknown): AppSettings["themeMode"] {
  return themeMode === "dark" ? "dark" : "light";
}

function normalizeLanguage(language: unknown): AppSettings["language"] {
  return language === "en" ? "en" : "zh-CN";
}

/**
 * UI store state interface
 */
export interface PendingDraftRestore {
  fileId: string;
  fileName: string;
  draftContent: string;
}

export interface PendingAiResult {
  fileId: string;
  previousContent: string;
  newContent: string;
}

export interface UIState {
  isSidebarOpen: boolean;
  isSettingsOpen: boolean;
  /** When opening settings, jump to this tab once (then cleared). */
  settingsFocusTab: "ai" | "index" | "editor" | null;
  isSaving: boolean;
  isAnalyzing: boolean;
  isPublishing: boolean;
  settings: AppSettings;
  notification: Notification | null;
  uiZoomHintPercent: number | null;
  activeHeadingId: string | null;
  /** Draft backup found for a just-opened file, awaiting a restore/discard decision. */
  pendingDraftRestore: PendingDraftRestore | null;
  /** AI enhancement output awaiting an apply/discard decision. */
  pendingAiResult: PendingAiResult | null;
}

/**
 * UI store actions interface
 */
export interface UIActions {
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (
    open: boolean,
    focusTab?: UIState["settingsFocusTab"],
  ) => void;
  clearSettingsFocusTab: () => void;
  setSaving: (saving: boolean) => void;
  setAnalyzing: (analyzing: boolean) => void;
  setPublishing: (publishing: boolean) => void;
  setSettings: (settings: AppSettings) => void;
  updateSettings: (
    updates: Partial<AppSettings> | ((state: UIState) => Partial<AppSettings>),
  ) => void;
  showNotification: (
    msg: string,
    type?: "success" | "error" | "info" | "warning",
  ) => void;
  clearNotification: () => void;
  showUiZoomHint: (percent: number) => void;
  setActiveHeadingId: (id: string | null) => void;
  setPendingDraftRestore: (pending: PendingDraftRestore | null) => void;
  setPendingAiResult: (pending: PendingAiResult | null) => void;
}

/**
 * Default settings
 */
const primaryShortcutModifier = getPreferredShortcutModifierToken();

export const defaultImageHostingConfig: ImageHostingConfig = {
  provider: "none",
  pasteAction: "local",
  keepLocalCopy: true,
  github: { repo: "", branch: "main", path: "images/", customDomain: "" },
  s3: {
    endpoint: "",
    region: "",
    bucket: "",
    pathPrefix: "images/",
    accessKeyId: "",
    customDomain: "",
  },
  aliyunOss: {
    endpoint: "",
    bucket: "",
    pathPrefix: "images/",
    accessKeyId: "",
    customDomain: "",
  },
  qiniu: {
    bucket: "",
    zone: "z0",
    accessKey: "",
    pathPrefix: "images/",
    domain: "",
  },
  custom: {
    uploadUrl: "",
    method: "POST",
    headers: "{}",
    fileFieldName: "file",
    responseUrlJsonPath: "data.url",
  },
};

export const defaultSettings: AppSettings = {
  language: "zh-CN",
  aiProvider: "deepseek",
  fontDefaultsVersion: FONT_DEFAULTS_VERSION,
  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
  uiFontSize: 16,
  editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
  previewFontFamily: DEFAULT_PREVIEW_FONT_FAMILY,
  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
  fontSize: 16,
  wordWrap: true,
  formatMarkdownOnManualSave: false,
  refreshFrontmatterOnSave: true,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  readableLineLength: true,
  showLineNumbers: false,
  tabSize: 4,
  useTabs: false,
  enableFolding: false,
  spellcheck: false,
  showIndentationGuides: false,
  convertHtmlOnPaste: true,
  resourceFolder: "resources",
  wikiFolder: "wiki",
  trashFolder: ".trash",
  newNoteLocation: "knowledgeBaseRoot",
  newNoteFolder: "notes",
  attachmentLocation: "resourceFolder",
  defaultViewMode: ViewMode.LIVE,
  attachmentPasteFormat: "obsidian",
  orderedListMode: "strict",
  markdownStylePreset: DEFAULT_MARKDOWN_STYLE_PRESET,
  blogRepoUrl: "",
  blogSiteUrl: "",
  blogGithubToken: "",
  wechatAppId: "",
  wechatAppSecret: "",
  geminiApiKey: "",
  geminiModel: "gemini-2.0-flash-exp",
  codexApiBaseUrl: "https://api.openai.com/v1",
  codexApiKey: "",
  codexModel: "gpt-5.2-codex",
  deepseekApiBaseUrl: "https://api.deepseek.com",
  deepseekApiKey: "",
  deepseekModel: "deepseek-v4-flash",
  aiSystemPrompt: "",
  aiSystemPromptZh: DEFAULT_AI_SYSTEM_PROMPT,
  aiSystemPromptEn: DEFAULT_AI_SYSTEM_PROMPT_EN,
  wikiPromptTemplate: "",
  wikiPromptTemplateZh: DEFAULT_WIKI_PROMPT_TEMPLATE,
  wikiPromptTemplateEn: DEFAULT_WIKI_PROMPT_TEMPLATE_EN,
  searchModeDefault: "hybrid",
  embeddingProvider: "builtin",
  embeddingHub: "auto",
  embeddingApiBaseUrl: "http://127.0.0.1:11434/v1",
  embeddingApiKey: "",
  embeddingModel: "nomic-embed-text",
  privacyMode: false,
  imageHosting: defaultImageHostingConfig,
  shortcuts: {
    save: `${primaryShortcutModifier}+S`,
    toggleView: `${primaryShortcutModifier}+3`,
    aiAnalyze: `${primaryShortcutModifier}+5`,
    search: "Cmd+Shift+F",
    sidebarSearch: "Cmd+Shift+S",
    locateCurrentFile: "Cmd+Shift+L",
    settings: `${primaryShortcutModifier}+0`,
    toggleOutline: `${primaryShortcutModifier}+2`,
    toggleSidebar: `${primaryShortcutModifier}+1`,
    toggleTheme: `${primaryShortcutModifier}+4`,
    newNote: `${primaryShortcutModifier}+N`,
    newFolder: `${primaryShortcutModifier}+Shift+N`,
    newWindow: `${primaryShortcutModifier}+Shift+Alt+N`,
    closeTab: `${primaryShortcutModifier}+W`,
    openKnowledgeBase: "Cmd+Shift+K",
    exportPdf: "Cmd+Shift+H",
  },
  knowledgeBases: [],
  lastKnowledgeBasePath: "",
  lastOpenedFilePath: "",
  themeMode: "dark",
  themeFollowSystem: false,
  metadataFields: DEFAULT_METADATA_FIELDS,
  autoSaveInterval: 60000,
  autoCheckForUpdates: true,
  skippedUpdateVersion: "",
  lastUpdateCheckAt: "",
};

/**
 * Initial UI state
 */
export const initialUIState: UIState = {
  isSidebarOpen: true,
  isSettingsOpen: false,
  settingsFocusTab: null,
  isSaving: false,
  isAnalyzing: false,
  isPublishing: false,
  settings: defaultSettings,
  notification: null,
  pendingDraftRestore: null,
  pendingAiResult: null,
  uiZoomHintPercent: null,
  activeHeadingId: null,
};

/**
 * Create UI store slice
 */
export function createUISlice(
  set: (fn: (state: UIState) => Partial<UIState>) => void,
  get: () => UIState & UIActions,
): UIState & UIActions {
  let notificationTimer: ReturnType<typeof setTimeout> | null = null;
  let uiZoomHintTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    ...initialUIState,

    setSidebarOpen: (open) => set(() => ({ isSidebarOpen: open })),

    setSettingsOpen: (open, focusTab) =>
      set(() => ({
        isSettingsOpen: open,
        settingsFocusTab: open ? (focusTab ?? null) : null,
      })),

    clearSettingsFocusTab: () => set(() => ({ settingsFocusTab: null })),

    setSaving: (saving) => set(() => ({ isSaving: saving })),

    setAnalyzing: (analyzing) => set(() => ({ isAnalyzing: analyzing })),

    setPublishing: (publishing) => set(() => ({ isPublishing: publishing })),

    setSettings: (settings) =>
      set(() => ({
        settings: {
          ...settings,
          language: normalizeLanguage(settings.language),
          themeMode: normalizeThemeMode(settings.themeMode),
          themeFollowSystem: settings.themeFollowSystem === true,
          markdownStylePreset: normalizeMarkdownStylePreset(
            settings.markdownStylePreset,
          ),
          wikiFolder: normalizeWikiFolder(settings.wikiFolder),
          trashFolder: normalizeTrashFolder(settings.trashFolder),
          newNoteLocation: normalizeNewNoteLocation(settings.newNoteLocation),
          attachmentLocation: normalizeAttachmentLocation(
            settings.attachmentLocation,
          ),
          tabSize: normalizeTabSize(settings.tabSize),
          defaultViewMode: normalizeDefaultViewMode(settings.defaultViewMode),
        },
      })),

    updateSettings: (updatesOrFn) =>
      set((state) => {
        const updates =
          typeof updatesOrFn === "function" ? updatesOrFn(state) : updatesOrFn;
        return {
          settings: {
            ...state.settings,
            ...updates,
            language: normalizeLanguage(
              updates.language ?? state.settings.language,
            ),
            themeMode: normalizeThemeMode(
              updates.themeMode ?? state.settings.themeMode,
            ),
            themeFollowSystem:
              typeof updates.themeFollowSystem === "boolean"
                ? updates.themeFollowSystem
                : state.settings.themeFollowSystem === true,
            markdownStylePreset: normalizeMarkdownStylePreset(
              updates.markdownStylePreset ?? state.settings.markdownStylePreset,
            ),
            wikiFolder: normalizeWikiFolder(
              updates.wikiFolder ?? state.settings.wikiFolder,
            ),
            trashFolder: normalizeTrashFolder(
              updates.trashFolder ?? state.settings.trashFolder,
            ),
            newNoteLocation: normalizeNewNoteLocation(
              updates.newNoteLocation ?? state.settings.newNoteLocation,
            ),
            attachmentLocation: normalizeAttachmentLocation(
              updates.attachmentLocation ?? state.settings.attachmentLocation,
            ),
            tabSize: normalizeTabSize(
              updates.tabSize ?? state.settings.tabSize,
            ),
            defaultViewMode: normalizeDefaultViewMode(
              updates.defaultViewMode ?? state.settings.defaultViewMode,
            ),
          },
        };
      }),

    showNotification: (msg, type) => {
      if (notificationTimer) {
        clearTimeout(notificationTimer);
      }

      set(() => ({ notification: { msg, type: type ?? "success" } }));
      notificationTimer = setTimeout(() => {
        notificationTimer = null;
        set(() => ({ notification: null }));
      }, 3000);
    },

    clearNotification: () => {
      if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
      }

      set(() => ({ notification: null }));
    },

    showUiZoomHint: (percent) => {
      if (uiZoomHintTimer) {
        clearTimeout(uiZoomHintTimer);
      }

      set(() => ({ uiZoomHintPercent: percent }));
      uiZoomHintTimer = setTimeout(() => {
        uiZoomHintTimer = null;
        set(() => ({ uiZoomHintPercent: null }));
      }, 1200);
    },

    setActiveHeadingId: (id) => set(() => ({ activeHeadingId: id })),

    setPendingDraftRestore: (pending) =>
      set(() => ({ pendingDraftRestore: pending })),

    setPendingAiResult: (pending) => set(() => ({ pendingAiResult: pending })),
  };
}

export { normalizeLanguage, normalizeThemeMode };
