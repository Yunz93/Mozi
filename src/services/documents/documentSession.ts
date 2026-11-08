import { useAppStore } from "../../store/appStore";
import type { AppLanguage, FileNode } from "../../types";
import { t } from "../../utils/i18n";
import {
  isMarkdownFile,
  isExcalidrawFile,
  isPreviewOnlyFile,
  isHtmlFile,
} from "../../utils/fileTypes";
import { getFileSystem } from "../../types/filesystem";
import { flushActiveEditorPendingChanges } from "../../utils/editorSelectionBridge";
import { readDraftBackup, clearDraftBackup } from "../../utils/draftBackup";
import { flushActiveDocumentIfDirty } from "../filesystem/flushActiveDocument";
import {
  selectDocumentSession,
  captureDocumentSession,
  matchesDocumentSession,
  type DocumentSessionToken,
} from "./sessionSnapshot";

async function notifyIfNonUtf8File(
  path: string,
  language: AppLanguage,
  showNotification: (message: string, type: "success" | "error") => void,
): Promise<void> {
  try {
    const fs = await getFileSystem();
    const isNonUtf8 = (
      fs as { isNonUtf8Path?: (filePath: string) => boolean }
    ).isNonUtf8Path?.(path);
    if (isNonUtf8) {
      showNotification(
        t(language, "notifications_fileEncodingReadOnly"),
        "error",
      );
    }
  } catch {
    // 探测编码状态失败时不打断打开流程。
  }
}

// Shared by every hook caller within this application window.
let fileOpenGeneration = 0;
export async function openDocumentSession(
  file: FileNode,
  options: {
    readFile: (file: FileNode) => Promise<string>;
    language: AppLanguage;
    showNotification: (message: string, type: "success" | "error") => void;
  },
): Promise<void> {
  const { readFile, language, showNotification } = options;
  const settings = { language };
  const {
    addTab,
    closeTab,
    setCurrentFilePath,
    updateTabContent,
    markAsSaved,
  } = useAppStore.getState();
  if (file.type === "folder") return;
  const rootAtStart = useAppStore.getState().rootFolderPath;
  const ownsRoot = () => useAppStore.getState().rootFolderPath === rootAtStart;
  let generation = fileOpenGeneration;
  const ownsOpenRequest = () => generation === fileOpenGeneration && ownsRoot();
  const isCurrentDocument = () => {
    const state = useAppStore.getState();
    return (
      ownsOpenRequest() &&
      state.activeTabId === file.id &&
      state.currentFilePath === file.path
    );
  };

  flushActiveEditorPendingChanges();
  const previousState = useAppStore.getState();
  const previousId = previousState.activeTabId;
  let previousContent = previousId
    ? previousState.fileContents[previousId]
    : undefined;
  let previousSaved = previousId
    ? previousState.lastSavedContent[previousId]
    : undefined;
  const previousPath = previousState.currentFilePath;

  try {
    if (
      !isMarkdownFile(file.name) &&
      !isExcalidrawFile(file.name) &&
      !isPreviewOnlyFile(file.name)
    ) {
      showNotification(
        t(settings.language, "notifications_previewNotSupported", {
          name: file.name,
        }),
        "error",
      );
      return;
    }

    generation = ++fileOpenGeneration;

    if (previousId && previousId !== file.id) {
      const flushed = await flushActiveDocumentIfDirty();
      if (!ownsOpenRequest()) return;
      if (!flushed) {
        showNotification(
          t(settings.language, "tab_closeBlockedUnsaved"),
          "error",
        );
        return;
      }
    }

    if (previousId) {
      const flushedState = useAppStore.getState();
      previousContent = flushedState.fileContents[previousId];
      previousSaved = flushedState.lastSavedContent[previousId];
    }
    addTab(file.id);
    setCurrentFilePath(file.path);
    const readToken = selectDocumentSession(useAppStore.getState())!;
    const applyLoadedContent = (text: string): boolean => {
      if (!isCurrentDocument()) return false;
      // 编辑器可能尚未把防抖输入同步到 store，先刷新再判断是否有新编辑。
      flushActiveEditorPendingChanges();
      if (matchesDocumentSession(useAppStore.getState(), readToken, true)) {
        updateTabContent(file.id, text);
      }
      markAsSaved(file.id, text);
      return true;
    };

    if (isPreviewOnlyFile(file.name)) {
      if (isHtmlFile(file.name)) {
        const text = await readFile(file);
        if (!applyLoadedContent(text)) return;
        await notifyIfNonUtf8File(
          file.path,
          settings.language,
          showNotification,
        );
      } else {
        updateTabContent(file.id, "");
        markAsSaved(file.id);
      }
      // View mode stays sticky; App forces PREVIEW only while this file is active.
      return;
    }

    if (isExcalidrawFile(file.name)) {
      const cachedDrawing =
        previousId === file.id
          ? useAppStore.getState().fileContents[file.id]
          : undefined;
      if (cachedDrawing === undefined) {
        const text = await readFile(file);
        if (!applyLoadedContent(text)) return;
        await notifyIfNonUtf8File(
          file.path,
          settings.language,
          showNotification,
        );
      }
      return;
    }

    const cachedContent =
      previousId === file.id
        ? useAppStore.getState().fileContents[file.id]
        : undefined;

    if (cachedContent === undefined) {
      const text = await readFile(file);
      if (!applyLoadedContent(text)) return;
      await notifyIfNonUtf8File(file.path, settings.language, showNotification);

      if (!isCurrentDocument()) return;

      // A draft backup exists when a previous save failed. Offer to
      // restore it instead of silently keeping the (older) disk content.
      const draft = readDraftBackup(file.id);
      if (draft !== null) {
        if (draft === text) {
          clearDraftBackup(file.id);
        } else {
          useAppStore.getState().setPendingDraftRestore({
            fileId: file.id,
            fileName: file.name,
            source: captureDocumentSession(useAppStore.getState()),
            draftContent: draft,
          });
        }
      }
    }
  } catch (e) {
    if (!isCurrentDocument()) return;
    console.error("Failed to read file:", file.path, e);
    showNotification(
      t(settings.language, "notifications_failedToReadFile", {
        name: file.name,
      }),
      "error",
    );
    closeTab(file.id);
    if (previousId && previousId !== file.id && previousContent !== undefined) {
      addTab(previousId, previousContent);
      if (previousSaved !== undefined) {
        markAsSaved(previousId, previousSaved);
      }
      setCurrentFilePath(previousPath);
    }
  }
}

/** Apply a reviewed external edit only to its original, still-open document. */
export function applyDocumentSessionEdit(input: {
  fileId: string;
  content: string;
  previousContent?: string;
  source?: DocumentSessionToken;
}): boolean {
  flushActiveEditorPendingChanges();
  const state = useAppStore.getState();
  const session = selectDocumentSession(state);
  if (
    !session ||
    session.documentId !== input.fileId ||
    session.content === undefined
  )
    return false;
  if (input.source && !matchesDocumentSession(state, input.source, true))
    return false;
  if (
    input.previousContent !== undefined &&
    session.content !== input.previousContent
  )
    return false;
  state.setContentForFile(input.fileId, input.content);
  return true;
}
