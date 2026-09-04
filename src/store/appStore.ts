import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ViewMode } from "../types";
import { createFileSlice, type FileState, type FileActions } from "./fileStore";
import { createTabSlice, type TabState, type TabActions } from "./tabStore";
import {
  createEditorSlice,
  type EditorState,
  type EditorActions,
  selectContent,
} from "./editorStore";
import {
  createUISlice,
  type UIState,
  type UIActions,
  defaultSettings,
  normalizeLanguage,
  normalizeThemeMode,
} from "./uiStore";
import {
  createVaultIndexSlice,
  type VaultIndexState,
  type VaultIndexActions,
} from "./vaultIndexStore";
import { normalizeAttachmentLocation } from "../utils/attachmentLocation";
import {
  normalizeDefaultViewMode,
  normalizeTabSize,
} from "../utils/editorPreferences";
import { resolveLastNonSplitViewMode } from "../utils/viewMode";
import { normalizeMetadataFields } from "../utils/metadataFields";
import { normalizeTrashFolder } from "../utils/trashFolder";
import { normalizeWikiFolder } from "../utils/wikiGeneration";
import {
  normalizeNewNoteFolder,
  normalizeNewNoteLocation,
} from "../utils/newNoteLocation";
import { normalizeMarkdownStylePreset } from "../utils/markdownStyle";
import {
  resolveLocalizedPrompts,
  resolvePersistedAISettings,
  resolvePersistedBlogRepoUrl,
  resolvePersistedBlogSiteUrl,
  resolvePersistedFontSettings,
  resolvePersistedShortcuts,
  sanitizeSettingsForPersistence,
  stripNonRuntimeSettings,
} from "./persistMigrations";
import { DEFAULT_INDEX_EXCLUDE_GLOBS } from "../utils/pathGlob";

export const APP_STORE_PERSIST_NAME = "markdown-press-settings";

let appStoreHydrationFailed = false;

/** persist 反序列化失败时标记，避免启动页永远卡住。 */
export function markAppStoreHydrationFailed(): void {
  appStoreHydrationFailed = true;
}

export function didAppStoreHydrationFail(): boolean {
  return appStoreHydrationFailed;
}

// Re-export types from slice stores
export type {
  FileState,
  FileActions,
  TabState,
  TabActions,
  EditorState,
  EditorActions,
  UIState,
  UIActions,
  VaultIndexState,
  VaultIndexActions,
};
// Re-export selector for convenience
export { selectContent };
// Re-export default settings for convenience
export { defaultSettings };
// Re-export persistence migration helpers (kept here for backwards-compatible
// imports and unit tests).
export {
  resolveLocalizedPrompts,
  resolvePersistedAISettings,
  resolvePersistedFontSettings,
  stripNonRuntimeSettings,
} from "./persistMigrations";

// Complete AppState combines all slices
export interface AppState
  extends
    FileState,
    TabState,
    EditorState,
    UIState,
    VaultIndexState,
    FileActions,
    TabActions,
    EditorActions,
    UIActions,
    VaultIndexActions {}

/**
 * Create the combined store using slice pattern
 */
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Combine all slice states and actions
      ...createFileSlice(set as any, get as any),
      ...createTabSlice(set as any, get as any),
      ...createEditorSlice(set as any, get as any),
      ...createUISlice(set as any, get as any),
      ...createVaultIndexSlice(set as any, get as any),
    }),
    {
      name: APP_STORE_PERSIST_NAME,
      partialize: (state) => ({
        settings: sanitizeSettingsForPersistence((state as any).settings),
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (!error) return;
        console.error("Failed to rehydrate app settings", error);
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.removeItem(APP_STORE_PERSIST_NAME);
          }
        } catch {
          // localStorage 可能不可用
        }
        markAppStoreHydrationFailed();
      },
      merge: (persistedState, currentState) => {
        const persistedSettings = stripNonRuntimeSettings(
          (persistedState as any)?.settings ?? {},
        );
        const resolvedAISettings =
          resolvePersistedAISettings(persistedSettings);
        const resolvedLocalizedPrompts =
          resolveLocalizedPrompts(persistedSettings);
        const resolvedFontSettings =
          resolvePersistedFontSettings(persistedSettings);
        const mergedSettings = {
          ...defaultSettings,
          ...persistedSettings,
          blogRepoUrl: resolvePersistedBlogRepoUrl(persistedSettings),
          blogSiteUrl: resolvePersistedBlogSiteUrl(persistedSettings),
          ...resolvedFontSettings,
          ...resolvedAISettings,
          ...resolvedLocalizedPrompts,
          language: normalizeLanguage(
            persistedSettings.language ?? defaultSettings.language,
          ),
          themeMode: normalizeThemeMode(
            persistedSettings.themeMode ?? defaultSettings.themeMode,
          ),
          themeFollowSystem: persistedSettings.themeFollowSystem === true,
          markdownStylePreset: normalizeMarkdownStylePreset(
            persistedSettings.markdownStylePreset,
          ),
          wikiFolder: normalizeWikiFolder(
            typeof persistedSettings.wikiFolder === "string"
              ? persistedSettings.wikiFolder
              : defaultSettings.wikiFolder,
          ),
          trashFolder: normalizeTrashFolder(
            persistedSettings.trashFolder ?? defaultSettings.trashFolder,
          ),
          newNoteLocation: normalizeNewNoteLocation(
            persistedSettings.newNoteLocation ??
              defaultSettings.newNoteLocation,
          ),
          newNoteFolder: normalizeNewNoteFolder(
            persistedSettings.newNoteFolder ?? defaultSettings.newNoteFolder,
          ),
          attachmentLocation: normalizeAttachmentLocation(
            persistedSettings.attachmentLocation ??
              defaultSettings.attachmentLocation,
          ),
          tabSize: normalizeTabSize(
            persistedSettings.tabSize ?? defaultSettings.tabSize,
          ),
          defaultViewMode: normalizeDefaultViewMode(
            persistedSettings.defaultViewMode ??
              defaultSettings.defaultViewMode,
          ),
          metadataFields: normalizeMetadataFields(
            persistedSettings.metadataFields,
          ),
          shortcuts: resolvePersistedShortcuts(persistedSettings),
          indexExcludeGlobs: Array.isArray(persistedSettings.indexExcludeGlobs)
            ? persistedSettings.indexExcludeGlobs.filter(
                (item): item is string =>
                  typeof item === "string" && item.trim().length > 0,
              )
            : [...DEFAULT_INDEX_EXCLUDE_GLOBS],
        };

        return {
          ...currentState,
          ...(persistedState as any),
          settings: mergedSettings,
          // Never hydrate bulky/runtime link index from settings persist blob.
          linkIndex: currentState.linkIndex,
          linkIndexProgress: currentState.linkIndexProgress,
          chunkIndex: currentState.chunkIndex,
          semanticReady: currentState.semanticReady,
          semanticVectorCount: currentState.semanticVectorCount,
          // Session starts from the configured default; file switches keep the live mode.
          viewMode: mergedSettings.defaultViewMode,
          lastNonSplitViewMode: resolveLastNonSplitViewMode(
            mergedSettings.defaultViewMode,
          ),
          viewModeBeforePreviewOnly: null,
        };
      },
    },
  ),
);
