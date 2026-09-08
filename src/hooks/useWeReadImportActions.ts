import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { hydrateSensitiveSettingsSafely } from "../app/hydrateSensitiveSettingsSafely";
import { useFileSystem } from "./useFileSystem";
import { useI18n } from "./useI18n";
import { localizeKnownError } from "../utils/i18n";
import { getFileSystem, isTauriEnvironment } from "../types/filesystem";
import {
  fetchAllNotebooksCached,
  searchStoreBooks,
} from "../utils/weread/wereadApi";
import {
  importWereadBooks,
  type WereadImportBookResult,
} from "../utils/weread/wereadImport";
import {
  requestWeReadImportDialog,
  setWeReadImportDialogHandler,
  type WeReadImportDialogOptions,
} from "../utils/weread/wereadImportEvents";
import type {
  WereadConflictMode,
  WereadNotebook,
  WereadStoreBook,
} from "../utils/weread/wereadTypes";

export function useWeReadImportActions() {
  const { t, language } = useI18n();
  const showNotification = useAppStore((state) => state.showNotification);
  const settings = useAppStore((state) => state.settings);
  const rootFolderPath = useAppStore((state) => state.rootFolderPath);
  const addTab = useAppStore((state) => state.addTab);
  const setCurrentFilePath = useAppStore((state) => state.setCurrentFilePath);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const { createFile, writeFile, refreshFileTree } = useFileSystem();

  const [isOpen, setIsOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [initialQuery, setInitialQuery] = useState("");
  const [preselectedBookIds, setPreselectedBookIds] = useState<string[]>([]);

  const openDialog = useCallback((options?: WeReadImportDialogOptions) => {
    setInitialQuery(options?.initialQuery ?? "");
    setPreselectedBookIds(options?.bookIds ?? []);
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    if (isImporting) return;
    setIsOpen(false);
  }, [isImporting]);

  useEffect(() => {
    setWeReadImportDialogHandler(openDialog);
    return () => setWeReadImportDialogHandler(null);
  }, [openDialog]);

  const ensureReady = useCallback(async (): Promise<boolean> => {
    if (!isTauriEnvironment()) {
      showNotification(t("wereadImport_desktopOnly"), "error");
      return false;
    }
    if (!rootFolderPath) {
      showNotification(t("notifications_noKnowledgeBaseOpened"), "error");
      return false;
    }
    await hydrateSensitiveSettingsSafely();
    const apiKey = useAppStore.getState().settings.wereadApiKey?.trim();
    if (!apiKey) {
      showNotification(t("wereadImport_needApiKey"), "error");
      setSettingsOpen(true);
      return false;
    }
    return true;
  }, [rootFolderPath, setSettingsOpen, showNotification, t]);

  const loadNotebooks = useCallback(
    async (force = false): Promise<WereadNotebook[]> => {
      const ready = await ensureReady();
      if (!ready) return [];
      return fetchAllNotebooksCached(force);
    },
    [ensureReady],
  );

  const searchBooks = useCallback(
    async (keyword: string): Promise<WereadStoreBook[]> => {
      const ready = await ensureReady();
      if (!ready) return [];
      return searchStoreBooks(keyword);
    },
    [ensureReady],
  );

  const importSelected = useCallback(
    async (options: {
      notebooks: WereadNotebook[];
      conflictMode: WereadConflictMode;
      saveCover: boolean;
      includeHotHighlights: boolean;
    }): Promise<WereadImportBookResult[]> => {
      const ready = await ensureReady();
      if (!ready) return [];
      const vaultPath = useAppStore.getState().rootFolderPath;
      if (!vaultPath) return [];

      setIsImporting(true);
      try {
        const results = await importWereadBooks({
          notebooks: options.notebooks,
          conflictMode: options.conflictMode,
          saveCover: options.saveCover,
          includeHotHighlights: options.includeHotHighlights,
          settings: useAppStore.getState().settings,
          rootFolderPath: vaultPath,
          files: useAppStore.getState().files,
          language,
          readFile: async (path: string) => {
            const fs = await getFileSystem();
            return fs.readFile(path);
          },
          writeFile,
          createFile,
        });

        await refreshFileTree();

        const opened = results.find(
          (result) =>
            result.path &&
            (result.status === "created" ||
              result.status === "merged" ||
              result.status === "overwritten"),
        );
        if (opened?.path) {
          addTab(opened.path);
          setCurrentFilePath(opened.path);
        }

        const failed = results.filter((result) => result.status === "failed");
        const skipped = results.filter((result) => result.status === "skipped");
        const imported = results.filter(
          (result) =>
            result.status === "created" ||
            result.status === "merged" ||
            result.status === "overwritten",
        );

        if (failed.length > 0 && imported.length === 0) {
          showNotification(
            localizeKnownError(
              language,
              failed[0]?.error || t("wereadImport_failed"),
            ),
            "error",
          );
        } else {
          showNotification(
            t("wereadImport_done", {
              imported: imported.length,
              skipped: skipped.length,
              failed: failed.length,
            }),
            failed.length > 0 ? "warning" : "success",
          );
        }

        return results;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showNotification(localizeKnownError(language, message), "error");
        return [];
      } finally {
        setIsImporting(false);
      }
    },
    [
      addTab,
      createFile,
      ensureReady,
      language,
      refreshFileTree,
      setCurrentFilePath,
      showNotification,
      t,
      writeFile,
    ],
  );

  return {
    isOpen,
    isImporting,
    initialQuery,
    preselectedBookIds,
    settings,
    openDialog,
    closeDialog,
    loadNotebooks,
    searchBooks,
    importSelected,
    requestWeReadImportDialog,
  };
}
