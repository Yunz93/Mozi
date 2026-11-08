import { useShallow } from "zustand/react/shallow";
import { useCallback } from "react";
import { useAppStore } from "../store/appStore";
import type { AppSettings, MetadataField } from "../types";

/**
 * Hook for settings management
 */
export function useSettings() {
  const {
    settings,
    setSettings,
    updateSettings,
    isSettingsOpen,
    setSettingsOpen,
  } = useAppStore(
    useShallow((state) => ({
      settings: state.settings,
      setSettings: state.setSettings,
      updateSettings: state.updateSettings,
      isSettingsOpen: state.isSettingsOpen,
      setSettingsOpen: state.setSettingsOpen,
    })),
  );

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, [setSettingsOpen]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, [setSettingsOpen]);

  const toggleTheme = useCallback(() => {
    updateSettings((state) => {
      const current = state.settings.themeMode;
      return {
        themeMode: current === "dark" ? "light" : "dark",
        // An explicit toggle is a manual choice; stop following the OS theme.
        themeFollowSystem: false,
      };
    });
  }, [updateSettings]);

  const updateFontSize = useCallback(
    (fontSize: number) => {
      updateSettings({ fontSize });
    },
    [updateSettings],
  );

  const toggleWordWrap = useCallback(() => {
    updateSettings((state) => ({ wordWrap: !state.settings.wordWrap }));
  }, [updateSettings]);

  const updateEditorFontFamily = useCallback(
    (editorFontFamily: string) => {
      updateSettings({ editorFontFamily });
    },
    [updateSettings],
  );

  const updatePreviewFontFamily = useCallback(
    (previewFontFamily: string) => {
      updateSettings({ previewFontFamily });
    },
    [updateSettings],
  );

  const updateCodeFontFamily = useCallback(
    (codeFontFamily: string) => {
      updateSettings({ codeFontFamily });
    },
    [updateSettings],
  );

  const updateBlogRepoUrl = useCallback(
    (blogRepoUrl: string) => {
      updateSettings({ blogRepoUrl });
    },
    [updateSettings],
  );

  const updateBlogSiteUrl = useCallback(
    (blogSiteUrl: string) => {
      updateSettings({ blogSiteUrl });
    },
    [updateSettings],
  );

  const updateShortcuts = useCallback(
    (shortcuts: AppSettings["shortcuts"]) => {
      updateSettings({ shortcuts });
    },
    [updateSettings],
  );

  const updateMetadataFields = useCallback(
    (metadataFields: MetadataField[]) => {
      updateSettings({ metadataFields });
    },
    [updateSettings],
  );

  const addMetadataField = useCallback(
    (key: string, defaultValue: string, description = "") => {
      updateSettings((state) => ({
        metadataFields: [
          ...state.settings.metadataFields,
          { key, defaultValue, description },
        ],
      }));
    },
    [updateSettings],
  );

  const removeMetadataField = useCallback(
    (index: number) => {
      updateSettings((state) => {
        if (index < 0 || index >= state.settings.metadataFields.length)
          return {};
        const newFields = state.settings.metadataFields.filter(
          (_, i) => i !== index,
        );
        return { metadataFields: newFields };
      });
    },
    [updateSettings],
  );

  const updateMetadataField = useCallback(
    (index: number, updates: Partial<MetadataField>) => {
      updateSettings((state) => {
        if (index < 0 || index >= state.settings.metadataFields.length)
          return {};
        const newFields = state.settings.metadataFields.map((field, i) =>
          i === index ? { ...field, ...updates } : field,
        );
        return { metadataFields: newFields };
      });
    },
    [updateSettings],
  );

  return {
    settings,
    setSettings,
    updateSettings,
    isSettingsOpen,
    openSettings,
    closeSettings,
    toggleTheme,
    updateFontSize,
    toggleWordWrap,
    updateEditorFontFamily,
    updatePreviewFontFamily,
    updateCodeFontFamily,
    updateBlogRepoUrl,
    updateBlogSiteUrl,
    updateShortcuts,
    updateMetadataFields,
    addMetadataField,
    removeMetadataField,
    updateMetadataField,
  };
}
