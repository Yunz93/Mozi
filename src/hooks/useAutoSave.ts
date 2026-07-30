import { useEffect, useCallback, useRef } from "react";
import { useAppStore, selectContent } from "../store/appStore";
import { flushActiveEditorPendingChanges } from "../utils/editorSelectionBridge";
import {
  clearDraftBackup,
  readDraftBackup,
  writeDraftBackup,
} from "../utils/draftBackup";
import { getFileSystem } from "../types/filesystem";
import { withErrorHandling, FileSystemError } from "../utils/errorHandler";
import { refreshDocumentUpdateTime } from "../utils/metadataFields";
import { t } from "../utils/i18n";
import { findFileInTree } from "../utils/fileTree";
import {
  formatMarkdownForSave,
  isMarkdownDocumentPath,
} from "../utils/markdownFormat";

interface UseAutoSaveOptions {
  debounceMs?: number;
  enabled?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface SaveState {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  error: string | null;
  retryCount: number;
}

export interface ForceSaveOptions {
  formatBeforeSave?: boolean;
  trigger?: "auto" | "manual" | "system";
}

function triggerPriority(
  trigger: ForceSaveOptions["trigger"] | undefined,
): number {
  switch (trigger) {
    case "system":
      return 3;
    case "manual":
      return 2;
    default:
      return 1;
  }
}

function mergePendingSaveOptions(
  existing: ForceSaveOptions | undefined,
  incoming: ForceSaveOptions | undefined,
): ForceSaveOptions {
  if (!existing) {
    return incoming ?? { trigger: "auto" };
  }
  if (!incoming) {
    return existing;
  }

  const winner =
    triggerPriority(incoming.trigger) >= triggerPriority(existing.trigger)
      ? incoming
      : existing;

  return {
    formatBeforeSave: winner.formatBeforeSave ?? existing.formatBeforeSave,
    trigger: winner.trigger ?? existing.trigger,
  };
}

function isTabContentLoaded(fileId: string | null): boolean {
  if (!fileId) return false;
  return useAppStore.getState().fileContents[fileId] !== undefined;
}

/**
 * Hook for auto-saving content with debounce, change detection, and retry logic
 */
export function useAutoSave(options: UseAutoSaveOptions = {}) {
  const {
    debounceMs,
    enabled = true,
    maxRetries = 3,
    retryDelayMs = 1000,
  } = options;

  const content = useAppStore(selectContent);
  const {
    activeTabId,
    currentFilePath,
    isSaving,
    setSaving,
    updateTabContent,
    markAsSaved,
    showNotification,
    settings,
  } = useAppStore();

  // Use configured auto-save interval or override from options
  const effectiveDebounceMs = debounceMs ?? settings?.autoSaveInterval ?? 60000;

  const contentRef = useRef(content);
  const pathRef = useRef(currentFilePath);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const saveStateRef = useRef<SaveState>({
    status: "idle",
    lastSavedAt: null,
    error: null,
    retryCount: 0,
  });
  const lastSavedContentRef = useRef<string>("");
  const isSavingRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const pendingSaveRef = useRef<ForceSaveOptions | null>(null);
  const saveIdleResolversRef = useRef<Array<() => void>>([]);
  const previousActiveTabIdRef = useRef<string | null>(activeTabId);

  const notifySaveIdle = useCallback(() => {
    const resolvers = saveIdleResolversRef.current;
    saveIdleResolversRef.current = [];
    resolvers.forEach((resolve) => resolve());
  }, []);

  const waitForSaveIdle = useCallback((): Promise<void> => {
    if (!isSavingRef.current) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      saveIdleResolversRef.current.push(resolve);
    });
  }, []);

  const isSaveContextStale = useCallback(
    (generation: number, tabId: string, path: string): boolean => {
      if (generation !== saveGenerationRef.current) {
        return true;
      }

      const state = useAppStore.getState();
      if (!state.openTabs.includes(tabId)) {
        return true;
      }

      if (pathRef.current !== path) {
        return true;
      }

      return false;
    },
    [],
  );

  const scheduleFollowUpSave = useCallback((options?: ForceSaveOptions) => {
    void executeSaveRef.current(0, options ?? { trigger: "auto" });
  }, []);

  const drainPendingSave = useCallback(
    (userEditedDuringSave: boolean) => {
      if (userEditedDuringSave) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        scheduleFollowUpSave(
          pending?.trigger === "manual" || pending?.trigger === "system"
            ? pending
            : { trigger: "auto" },
        );
        return;
      }

      if (!pendingSaveRef.current) {
        return;
      }

      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      scheduleFollowUpSave(pending);
    },
    [scheduleFollowUpSave],
  );

  // Keep refs updated
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    pathRef.current = currentFilePath;
  }, [currentFilePath]);

  const saveOpenTabIfDirty = useCallback(
    async (tabId: string): Promise<boolean> => {
      const state = useAppStore.getState();
      if (!state.hasUnsavedChanges(tabId)) {
        return true;
      }

      const tabContent = state.fileContents[tabId];
      const node = findFileInTree(state.files, tabId);
      if (tabContent === undefined || !node || node.type !== "file") {
        return false;
      }

      if (!isMarkdownDocumentPath(node.path)) {
        return true;
      }

      try {
        const fs = await getFileSystem();
        await fs.writeFile(node.path, tabContent);
        state.markAsSaved(tabId, tabContent);
        clearDraftBackup(tabId);
        void import("../services/vault/linkIndexEvents").then(
          ({ notifyVaultFileSaved }) => {
            notifyVaultFileSaved(node.path, tabContent);
          },
        );
        return true;
      } catch (error) {
        console.error(`Failed to save tab ${tabId}:`, error);
        return false;
      }
    },
    [],
  );

  // Flush the previous tab before resetting save state on tab switch.
  useEffect(() => {
    const previousTabId = previousActiveTabIdRef.current;
    previousActiveTabIdRef.current = activeTabId;

    if (previousTabId && previousTabId !== activeTabId) {
      flushActiveEditorPendingChanges();
      void saveOpenTabIfDirty(previousTabId);
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    saveGenerationRef.current += 1;
    pendingSaveRef.current = null;

    const state = useAppStore.getState();
    const baseline = activeTabId
      ? (state.lastSavedContent[activeTabId] ??
        state.fileContents[activeTabId] ??
        "")
      : "";

    lastSavedContentRef.current = baseline;
    isSavingRef.current = false;
    setSaving(false);
    notifySaveIdle();
    saveStateRef.current = {
      status: "idle",
      lastSavedAt: null,
      error: null,
      retryCount: 0,
    };
  }, [activeTabId, notifySaveIdle, saveOpenTabIfDirty, setSaving]);

  const executeSaveRef = useRef<
    (retryCount?: number, options?: ForceSaveOptions) => Promise<boolean>
  >(async () => false);

  // Execute save operation with retry logic
  const executeSave = useCallback(
    async (retryCount = 0, options?: ForceSaveOptions): Promise<boolean> => {
      const currentContent = contentRef.current;
      const tabId = activeTabId;
      const stateAtStart = useAppStore.getState();
      const resolvedNode = tabId
        ? findFileInTree(stateAtStart.files, tabId)
        : undefined;
      const savePath = resolvedNode?.path ?? pathRef.current;

      if (!savePath || !tabId) return false;
      if (resolvedNode && resolvedNode.id !== tabId) return false;
      if (!isMarkdownDocumentPath(savePath)) return false;
      if (!isTabContentLoaded(tabId)) return false;

      const shouldFormatBeforeSave =
        options?.trigger === "manual" &&
        options.formatBeforeSave === true &&
        isMarkdownDocumentPath(savePath);

      // Prevent concurrent saves; queue a follow-up instead of dropping work
      if (isSavingRef.current) {
        pendingSaveRef.current = mergePendingSaveOptions(
          pendingSaveRef.current ?? undefined,
          options,
        );
        return false;
      }

      const generation = saveGenerationRef.current;
      isSavingRef.current = true;
      setSaving(true);
      saveStateRef.current.status = "saving";

      let contentToSave = currentContent;

      try {
        // Yield one frame before sync format so the saving indicator can paint.
        if (shouldFormatBeforeSave) {
          await new Promise<void>((resolve) => {
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => resolve());
            } else {
              resolve();
            }
          });
          if (isSaveContextStale(generation, tabId, savePath)) {
            isSavingRef.current = false;
            setSaving(false);
            notifySaveIdle();
            drainPendingSave(false);
            return false;
          }
        }

        const preparedContent = shouldFormatBeforeSave
          ? formatMarkdownForSave(currentContent, {
              orderedListMode: settings.orderedListMode,
            })
          : currentContent;

        const shouldRefreshFrontmatter =
          options?.trigger !== "auto" &&
          settings.refreshFrontmatterOnSave !== false;

        contentToSave = shouldRefreshFrontmatter
          ? refreshDocumentUpdateTime(preparedContent)
          : preparedContent;

        // Check if content has changed (compare post-transform payload for manual saves)
        if (contentToSave === lastSavedContentRef.current) {
          isSavingRef.current = false;
          setSaving(false);
          notifySaveIdle();
          return true;
        }

        await withErrorHandling(async () => {
          const fs = await getFileSystem();
          await fs.writeFile(savePath, contentToSave);
        }, "Auto-save failed");

        if (isSaveContextStale(generation, tabId, savePath)) {
          const latestState = useAppStore.getState();
          if (latestState.openTabs.includes(tabId)) {
            markAsSaved(tabId, contentToSave);
            void import("../services/vault/linkIndexEvents").then(
              ({ notifyVaultFileSaved }) => {
                notifyVaultFileSaved(savePath, contentToSave);
              },
            );
          }
          isSavingRef.current = false;
          setSaving(false);
          notifySaveIdle();
          drainPendingSave(false);
          return true;
        }

        const latestContent = contentRef.current;
        const userEditedDuringSave = latestContent !== currentContent;

        // Adopt formatted/timestamp-normalized output when the user did not keep typing.
        if (!userEditedDuringSave && contentToSave !== currentContent) {
          contentRef.current = contentToSave;
          updateTabContent(tabId, contentToSave);
        }

        markAsSaved(tabId, contentToSave);
        lastSavedContentRef.current = contentToSave;
        clearDraftBackup(tabId);
        void import("../services/vault/linkIndexEvents").then(
          ({ notifyVaultFileSaved }) => {
            notifyVaultFileSaved(savePath, contentToSave);
          },
        );
        saveStateRef.current = {
          status: "saved",
          lastSavedAt: new Date(),
          error: null,
          retryCount: 0,
        };
        isSavingRef.current = false;
        setSaving(false);
        notifySaveIdle();
        drainPendingSave(userEditedDuringSave);

        return true;
      } catch (error) {
        console.error(`Auto-save failed (attempt ${retryCount + 1}):`, error);

        if (isSaveContextStale(generation, tabId, savePath)) {
          isSavingRef.current = false;
          setSaving(false);
          notifySaveIdle();
          return false;
        }

        // Check if we should retry
        if (retryCount < maxRetries) {
          saveStateRef.current.retryCount = retryCount + 1;

          // Wait before retry with exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelayMs * Math.pow(2, retryCount)),
          );

          if (isSaveContextStale(generation, tabId, savePath)) {
            isSavingRef.current = false;
            setSaving(false);
            notifySaveIdle();
            return false;
          }

          isSavingRef.current = false;
          return executeSave(retryCount + 1, options);
        }

        // Max retries exceeded
        const errorMessage =
          error instanceof FileSystemError
            ? error.toUserMessage()
            : error instanceof Error
              ? error.message
              : "Save failed";

        saveStateRef.current = {
          status: "error",
          lastSavedAt: saveStateRef.current.lastSavedAt,
          error: errorMessage,
          retryCount: retryCount + 1,
        };
        isSavingRef.current = false;
        setSaving(false);
        notifySaveIdle();

        // Save to local storage as backup
        if (writeDraftBackup(tabId, contentToSave)) {
          showNotification(
            t(settings.language, "notifications_saveBackupCreated"),
            "error",
          );
        } else {
          showNotification(
            t(settings.language, "notifications_saveFailed", {
              message: saveStateRef.current.error || "",
            }),
            "error",
          );
        }

        return false;
      }
    },
    [
      activeTabId,
      drainPendingSave,
      isSaveContextStale,
      notifySaveIdle,
      setSaving,
      updateTabContent,
      markAsSaved,
      showNotification,
      maxRetries,
      retryDelayMs,
      settings.orderedListMode,
      settings.language,
      settings.refreshFrontmatterOnSave,
    ],
  );

  executeSaveRef.current = executeSave;

  // Debounced auto-save effect
  useEffect(() => {
    if (!enabled || !activeTabId || !currentFilePath) return;
    if (!isTabContentLoaded(activeTabId)) return;

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer
    timerRef.current = setTimeout(() => {
      void executeSave(0, { trigger: "auto" });
    }, effectiveDebounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [
    content,
    enabled,
    activeTabId,
    currentFilePath,
    effectiveDebounceMs,
    executeSave,
  ]);

  // Force save function (for manual save)
  const forceSave = useCallback(
    async (
      contentOverride?: string,
      options?: ForceSaveOptions,
    ): Promise<boolean> => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      if (contentOverride !== undefined) {
        contentRef.current = contentOverride;
      } else {
        // Editor keystrokes reach the store on a short debounce; flush them
        // now and read the store directly (contentRef only updates on the
        // next render) so the save never misses trailing keystrokes.
        flushActiveEditorPendingChanges();
        const latestContent = useAppStore.getState().getActiveContent();
        if (latestContent !== undefined) {
          contentRef.current = latestContent;
        }
      }

      const trigger = options?.trigger ?? "manual";
      if (
        isSavingRef.current &&
        (trigger === "system" || trigger === "manual")
      ) {
        await waitForSaveIdle();
      }

      const result = await executeSave(0, options);

      if (
        !result &&
        pendingSaveRef.current &&
        (trigger === "system" || trigger === "manual")
      ) {
        await waitForSaveIdle();
        if (pendingSaveRef.current) {
          const pending = pendingSaveRef.current;
          pendingSaveRef.current = null;
          return executeSave(0, pending);
        }
      }

      return result;
    },
    [executeSave, waitForSaveIdle],
  );

  // Get save state
  const getSaveState = useCallback(
    (): SaveState => ({ ...saveStateRef.current }),
    [],
  );

  return {
    isSaving,
    forceSave,
    saveOpenTabIfDirty,
    getSaveState,
    restoreDraft: readDraftBackup,
    clearDraft: clearDraftBackup,
  };
}
