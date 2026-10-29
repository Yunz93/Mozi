import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";
import { hydrateSensitiveSettingsSafely } from "../app/hydrateSensitiveSettingsSafely";
import { useFileSystem } from "./useFileSystem";
import { useFileOperations } from "./useFileOperations";
import { flushActiveDocumentIfDirty } from "../services/filesystem/flushActiveDocument";
import { acquireDocumentWrite } from "../services/filesystem/documentWriteQueue";
import { flushActiveEditorPendingChanges } from "../utils/editorSelectionBridge";
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
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const { createFile, writeFile, refreshFileTree } = useFileSystem();
  const { handleFileSelect } = useFileOperations();
  const importGenerationRef = useRef(0);
  const importInFlightRef = useRef(false);
  useEffect(() => {
    importGenerationRef.current += 1;
    return () => {
      importGenerationRef.current += 1;
    };
  }, [rootFolderPath]);

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
      setSettingsOpen(true, "readingNotes");
      return false;
    }
    return true;
  }, [rootFolderPath, setSettingsOpen, showNotification, t]);

  const loadNotebooks = useCallback(
    async (force = false): Promise<WereadNotebook[]> => {
      const ready = await ensureReady();
      if (!ready) return [];
      return fetchAllNotebooksCached(
        force,
        useAppStore.getState().settings.wereadApiKey?.trim() ?? "",
      );
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
      if (importInFlightRef.current) return [];
      const ready = await ensureReady();
      if (!ready) return [];
      const vaultPath = useAppStore.getState().rootFolderPath;
      if (!vaultPath) return [];
      if (importInFlightRef.current) return [];
      const generation = ++importGenerationRef.current;
      const originTabId = useAppStore.getState().activeTabId;
      const isCurrent = () =>
        importGenerationRef.current === generation &&
        useAppStore.getState().rootFolderPath === vaultPath;
      const assertCurrent = () => {
        if (!isCurrent())
          throw new Error("Knowledge base changed during import");
      };

      importInFlightRef.current = true;
      setIsImporting(true);
      try {
        if (!(await flushActiveDocumentIfDirty())) {
          showNotification(t("tab_closeBlockedUnsaved"), "error");
          return [];
        }
        assertCurrent();
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
            assertCurrent();
            const fs = await getFileSystem();
            return fs.readFile(path);
          },
          writeFile: async (path, content) => {
            assertCurrent();
            await writeFile(path, content);
          },
          createFile: async (...args) => {
            assertCurrent();
            return createFile(...args);
          },
          updateFile: async (path, update) => {
            const release = await acquireDocumentWrite(path);
            try {
              while (true) {
                assertCurrent();
                flushActiveEditorPendingChanges();
                const state = useAppStore.getState();
                const active =
                  state.currentFilePath === path ? state.activeTabId : null;
                const buffered = active
                  ? state.fileContents[active]
                  : undefined;
                const fs = await getFileSystem();
                const source = buffered ?? (await fs.readFile(path));
                const content = update(source);
                assertCurrent();
                await writeFile(path, content);
                flushActiveEditorPendingChanges();
                const latest = useAppStore.getState();
                if (
                  isCurrent() &&
                  active &&
                  latest.activeTabId === active &&
                  latest.currentFilePath === path
                ) {
                  // 慢写盘期间若又输入，重新合并最新缓冲，不能用导入快照覆盖用户补充。
                  if (latest.fileContents[active] !== buffered) continue;
                  latest.updateTabContent(active, content);
                  latest.markAsSaved(active, content);
                }
                return content;
              }
            } finally {
              release();
            }
          },
        });

        if (!isCurrent()) return results;
        await refreshFileTree();
        if (!isCurrent()) return results;

        const opened = results.find(
          (result) =>
            result.path &&
            (result.status === "created" ||
              result.status === "merged" ||
              result.status === "overwritten"),
        );
        if (
          opened?.path &&
          useAppStore.getState().activeTabId === originTabId
        ) {
          await handleFileSelect({
            id: opened.path,
            path: opened.path,
            name: opened.path.split(/[\\/]/).pop()!,
            type: "file",
          });
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
        if (!isCurrent()) return [];
        const message = error instanceof Error ? error.message : String(error);
        showNotification(localizeKnownError(language, message), "error");
        return [];
      } finally {
        importInFlightRef.current = false;
        setIsImporting(false);
      }
    },
    [
      createFile,
      ensureReady,
      language,
      refreshFileTree,
      handleFileSelect,
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
