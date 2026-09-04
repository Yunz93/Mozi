import { useCallback } from "react";
import { getFileSystem } from "../types/filesystem";
import { useAppStore } from "../store/appStore";
import { withErrorHandling, FileSystemError } from "../utils/errorHandler";
import type { FileNode } from "../types";
import type { FileWatchEvent, DirectoryWatchEvent } from "../types/filesystem";
import { localizeKnownError, t } from "../utils/i18n";
import {
  DEFAULT_TRASH_FOLDER,
  sanitizeTrashFolder,
} from "../utils/trashFolder";
import { isTauriEnvironment } from "../types/filesystem";
import {
  getPathSeparator,
  joinFsPath,
  normalizeSlashes,
  getPathBasename,
  getPathDirname,
} from "../utils/pathHelpers";
import { openKnowledgeBaseWorkspace } from "../services/filesystem/knowledgeBaseService";
import { flushActiveDocumentIfDirty } from "../services/filesystem/flushActiveDocument";
import { initializeSampleNotesIfSupported } from "../services/filesystem/sampleNotesService";
import {
  moveItemToTrash,
  restoreItemFromTrash,
} from "../services/filesystem/trashService";
import {
  deleteFileAndCleanupTrash,
  moveFilePath,
} from "../services/filesystem/fileMutationService";
import {
  createFileNode,
  createFolderNode,
  openStandaloneFile,
  openStandaloneFileByPath,
  revealFileInExplorer,
} from "../services/filesystem/basicFileService";
import {
  readFileContent,
  saveFileContent,
  writeBinaryFileContent,
  writeFileContent,
} from "../services/filesystem/ioService";
import { findFileInTree, preserveOpenTabNodes } from "../utils/fileTree";

const TRASH_ROOT_MARKER = "__root__";

/** 目标等于自身，或仅大小写不同时不视为同名冲突。 */
export function isSamePathAllowingCaseChange(
  source: string,
  target: string,
): boolean {
  const normalizedSource = normalizeSlashes(source);
  const normalizedTarget = normalizeSlashes(target);
  return (
    normalizedSource === normalizedTarget ||
    normalizedSource.toLowerCase() === normalizedTarget.toLowerCase()
  );
}

/** 目标路径已存在则抛 FILE_EXISTS，避免静默覆盖。 */
export async function assertTargetPathAvailable(
  fs: { fileExists: (path: string) => Promise<boolean> },
  targetPath: string,
  sourcePath?: string,
): Promise<void> {
  if (sourcePath && isSamePathAllowingCaseChange(sourcePath, targetPath)) {
    return;
  }
  if (await fs.fileExists(targetPath)) {
    throw new FileSystemError(
      "A file with this name already exists.",
      "FILE_EXISTS",
      targetPath,
    );
  }
}

function hasOpenedKnowledgeBaseBefore(path: string): boolean {
  const normalizedPath = normalizeSlashes(path);
  const history = useAppStore.getState().settings.knowledgeBases || [];
  return history.some(
    (knowledgeBase) => normalizeSlashes(knowledgeBase.path) === normalizedPath,
  );
}

function joinPathSegments(basePath: string, ...segments: string[]): string {
  return segments
    .filter(Boolean)
    .reduce((acc, segment) => joinFsPath(acc, segment), basePath);
}

async function registerTauriAllowedPath(
  path: string,
  recursive: boolean,
): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { invoke } = await import("@tauri-apps/api/core");

  // Add 3 second timeout to prevent hanging
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(
      () => reject(new Error("register_allowed_path timed out")),
      3000,
    );
  });

  await Promise.race([
    invoke("register_allowed_path", { path, recursive }),
    timeoutPromise,
  ]);
}

async function registerTauriAllowedPathIfExists(
  path: string,
  recursive: boolean,
): Promise<void> {
  try {
    await registerTauriAllowedPath(path, recursive);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("No such file or directory") ||
      message.includes("cannot find the path specified") ||
      message.includes("Failed to resolve path")
    ) {
      return;
    }
    throw error;
  }
}

function getRelativePathFromRoot(path: string, rootPath: string): string {
  const normalizedPath = normalizeSlashes(path);
  const normalizedRoot = normalizeSlashes(rootPath);
  if (normalizedPath === normalizedRoot) return "";
  const withSlash = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(withSlash)) {
    return normalizedPath.slice(withSlash.length);
  }
  return normalizedPath;
}

function getParentRelativePath(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function isPathInTrash(
  path: string,
  rootPath: string,
  trashFolder: string,
): boolean {
  const normalizedPath = normalizeSlashes(path);
  const normalizedRoot = normalizeSlashes(rootPath);
  const trashDirName = sanitizeTrashFolder(trashFolder);
  return (
    normalizedPath === `${normalizedRoot}/${trashDirName}` ||
    normalizedPath.startsWith(`${normalizedRoot}/${trashDirName}/`)
  );
}

function createTrashContainerName(parentRelativePath: string): string {
  const encodedParent = encodeURIComponent(
    parentRelativePath || TRASH_ROOT_MARKER,
  );
  return `${Date.now()}__${encodedParent}`;
}

function parseTrashPathInfo(
  path: string,
  rootPath: string,
  trashFolder: string,
): {
  trashDirName: string;
  containerName: string;
  originalRelativePath: string;
} | null {
  const normalizedPath = normalizeSlashes(path);
  const normalizedRoot = normalizeSlashes(rootPath);
  const trashDirName = sanitizeTrashFolder(trashFolder);
  const trashPrefix = `${normalizedRoot}/${trashDirName}/`;
  if (!normalizedPath.startsWith(trashPrefix)) return null;

  const remainder = normalizedPath.slice(trashPrefix.length);
  const parts = remainder.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const [containerName, ...itemParts] = parts;
  const match = containerName.match(/^\d+__(.+)$/);
  const encodedParent = match?.[1];
  let parentRelativePath = "";
  if (encodedParent) {
    try {
      const decoded = decodeURIComponent(encodedParent);
      parentRelativePath = decoded === TRASH_ROOT_MARKER ? "" : decoded;
    } catch {
      parentRelativePath = "";
    }
  }

  const originalRelativePath = [
    ...parentRelativePath.split("/").filter(Boolean),
    ...itemParts,
  ].join("/");

  return {
    trashDirName,
    containerName,
    originalRelativePath,
  };
}

async function ensureTrashRootDirectory(
  fs: Awaited<ReturnType<typeof getFileSystem>>,
  rootPath: string,
  trashFolder: string,
): Promise<{
  trashDirName: string;
  trashRootPath: string;
}> {
  const trashDirName = sanitizeTrashFolder(trashFolder || DEFAULT_TRASH_FOLDER);
  const trashRootPath = joinFsPath(rootPath, trashDirName);
  await registerTauriAllowedPath(trashRootPath, true);
  await fs.createDirectory(trashRootPath);
  return {
    trashDirName,
    trashRootPath,
  };
}

/**
 * Hook for file system operations
 * Automatically selects the appropriate file system implementation based on environment
 */
export function useFileSystem() {
  const {
    files,
    setFiles,
    setCurrentFilePath,
    setRootFolderPath,
    clearAllCache,
    showNotification,
    addTab,
    activateTab,
    settings,
  } = useAppStore();

  const updateKnowledgeBaseMetadata = useCallback((path: string) => {
    const name = getPathBasename(path);
    const now = new Date().toISOString();

    useAppStore.getState().updateSettings((state) => {
      const existing = state.settings.knowledgeBases || [];
      const next = [
        { path, name, lastOpenedAt: now },
        ...existing.filter((kb) => kb.path !== path),
      ].slice(0, 20);

      return {
        knowledgeBases: next,
        lastKnowledgeBasePath: path,
      };
    });
  }, []);

  const refreshFileTree = useCallback(async (): Promise<void> => {
    const rootPath = useAppStore.getState().rootFolderPath;
    if (!rootPath) return;

    const fs = await getFileSystem();
    const fileNodes = await withErrorHandling(
      () => fs.readDirectory(rootPath),
      "Failed to refresh knowledge base",
    );
    const state = useAppStore.getState();
    setFiles(preserveOpenTabNodes(fileNodes, state.openTabs, state.files));
  }, [setFiles]);

  /**
   * Handle file system errors with user-friendly notifications
   */
  const handleFileSystemError = useCallback(
    (error: unknown, context: string) => {
      if (error instanceof FileSystemError) {
        showNotification(
          localizeKnownError(settings.language, error.toUserMessage()),
          "error",
        );
      } else {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        showNotification(`${context}: ${message}`, "error");
      }
    },
    [settings.language, showNotification],
  );

  /**
   * Open a single file
   */
  const openFile = useCallback(async () => {
    try {
      const flushed = await flushActiveDocumentIfDirty();
      if (!flushed) {
        showNotification(
          t(settings.language, "tab_closeBlockedUnsaved"),
          "error",
        );
        return;
      }

      const fs = await getFileSystem();
      const result = await openStandaloneFile(
        fs,
        getPathBasename,
        withErrorHandling,
      );
      if (result) {
        setFiles([result.file]);
        addTab(result.file.id, result.content);
        setCurrentFilePath(result.file.path);
        showNotification(
          t(settings.language, "notifications_fileOpenedSuccessfully"),
          "success",
        );
      }
    } catch (error) {
      handleFileSystemError(error, "Failed to open file");
    }
  }, [
    setFiles,
    addTab,
    setCurrentFilePath,
    showNotification,
    handleFileSystemError,
    settings.language,
  ]);

  const openFilePath = useCallback(
    async (
      path: string,
      options?: { silentSuccess?: boolean; suppressErrors?: boolean },
    ): Promise<string | null> => {
      try {
        const existingState = useAppStore.getState();
        if (existingState.activeTabId === path) {
          activateTab(path, path);
          return path;
        }

        const flushed = await flushActiveDocumentIfDirty();
        if (!flushed) {
          if (!options?.suppressErrors) {
            showNotification(
              t(settings.language, "tab_closeBlockedUnsaved"),
              "error",
            );
          }
          return null;
        }

        const fs = await getFileSystem();
        const result = await openStandaloneFileByPath(
          fs,
          path,
          getPathBasename,
          withErrorHandling,
        );
        const state = useAppStore.getState();
        const fileExistsInTree = Boolean(
          findFileInTree(state.files, result.file.id),
        );

        if (!fileExistsInTree) {
          setFiles([...state.files, result.file]);
        }

        addTab(result.file.id, result.content);
        setCurrentFilePath(result.file.path);

        if (!options?.silentSuccess) {
          showNotification(
            t(settings.language, "notifications_fileOpenedSuccessfully"),
            "success",
          );
        }

        return result.file.path;
      } catch (error) {
        if (!options?.suppressErrors) {
          handleFileSystemError(error, "Failed to open file");
        } else {
          console.warn("Failed to open external file:", error);
        }
        return null;
      }
    },
    [
      activateTab,
      setFiles,
      addTab,
      setCurrentFilePath,
      showNotification,
      handleFileSystemError,
      settings.language,
    ],
  );

  /**
   * Initialize sample notes for first-time users
   * With timeout to prevent hanging if the backend command fails
   */
  const initializeSampleNotes = useCallback(
    async (targetDir: string): Promise<boolean> => {
      try {
        const fs = await getFileSystem();
        const updated = await initializeSampleNotesIfSupported(fs, targetDir);

        if (updated) {
          showNotification(
            t(settings.language, "notifications_sampleNotesSynced"),
            "success",
          );
        }
        return updated;
      } catch (error) {
        console.error("Failed to initialize sample notes:", error);
        // Don't show error notification - this is not critical
        return false;
      }
    },
    [showNotification],
  );

  /**
   * Open a knowledge base directory.
   * If path is provided, opens directly; otherwise prompts user to select.
   */
  const openKnowledgeBase = useCallback(
    async (
      path?: string,
      options?: {
        silentSuccess?: boolean;
        skipSampleNotes?: boolean;
        suppressErrors?: boolean;
        restoreLastOpenedFile?: boolean;
      },
    ): Promise<string | null> => {
      try {
        const fs = await getFileSystem();
        const result = await openKnowledgeBaseWorkspace({
          addTab,
          clearAllCache,
          findPreferredFile: findFileInTree,
          fs,
          hasOpenedKnowledgeBaseBefore,
          handleInitialFileError: (error) => {
            if (!options?.suppressErrors) {
              handleFileSystemError(error, "Failed to open initial file");
            } else {
              console.warn(
                "Failed to open initial file during silent knowledge base restore:",
                error,
              );
            }
          },
          initializeSampleNotes,
          lastOpenedFilePath:
            useAppStore.getState().settings.lastOpenedFilePath ?? null,
          options: {
            path,
            silentSuccess: options?.silentSuccess,
            skipSampleNotes: options?.skipSampleNotes,
            restoreLastOpenedFile: options?.restoreLastOpenedFile,
          },
          registerAllowedPath: registerTauriAllowedPath,
          registerAllowedPathIfExists: registerTauriAllowedPathIfExists,
          setCurrentFilePath,
          setFiles,
          setRootFolderPath,
          trashFolder: settings.trashFolder,
          withErrorHandling,
        });
        if (!result) return null;

        updateKnowledgeBaseMetadata(result.dirPath);
        if (!options?.silentSuccess) {
          const obsidianMarker = joinFsPath(result.dirPath, ".obsidian");
          const looksLikeObsidian =
            (await fs.fileExists?.(obsidianMarker)) === true;
          showNotification(
            t(
              settings.language,
              looksLikeObsidian
                ? "notifications_obsidianVaultDetected"
                : "notifications_knowledgeBaseOpenedSuccessfully",
            ),
            looksLikeObsidian ? "info" : "success",
          );
        }
        return result.dirPath;
      } catch (error) {
        if (!options?.suppressErrors) {
          handleFileSystemError(error, "Failed to open knowledge base");
        } else {
          console.warn("Failed to restore knowledge base silently:", error);
        }
        return null;
      }
    },
    [
      clearAllCache,
      addTab,
      setCurrentFilePath,
      setFiles,
      setRootFolderPath,
      showNotification,
      handleFileSystemError,
      updateKnowledgeBaseMetadata,
      initializeSampleNotes,
      settings.trashFolder,
    ],
  );

  /**
   * Backward-compatible alias used by existing UI call sites.
   */
  const openDirectory = useCallback(async () => {
    await openKnowledgeBase();
  }, [openKnowledgeBase]);

  /**
   * Read a file
   */
  const readFile = useCallback(async (file: FileNode): Promise<string> => {
    const fs = await getFileSystem();
    return readFileContent(fs, file.path, file.name, withErrorHandling);
  }, []);

  /**
   * Write a file
   */
  const writeFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      const fs = await getFileSystem();
      await writeFileContent(fs, path, content, withErrorHandling);
    },
    [],
  );

  const writeBinaryFile = useCallback(
    async (path: string, content: Uint8Array): Promise<void> => {
      const fs = await getFileSystem();
      await writeBinaryFileContent(fs, path, content, withErrorHandling);
    },
    [],
  );

  /**
   * Save current file
   */
  const saveFile = useCallback(
    async (path: string | null, content: string): Promise<string | null> => {
      try {
        const fs = await getFileSystem();
        const savedPath = await saveFileContent(
          fs,
          path,
          content,
          withErrorHandling,
        );
        if (savedPath && path !== savedPath) {
          setCurrentFilePath(savedPath);
        }
        return savedPath;
      } catch (error) {
        handleFileSystemError(error, "Failed to save file");
        return null;
      }
    },
    [setCurrentFilePath, handleFileSystemError],
  );

  /**
   * Create a new file
   */
  const createFile = useCallback(
    async (
      fileName: string,
      content: string = "",
      folderPath?: string,
    ): Promise<FileNode | null> => {
      try {
        const fs = await getFileSystem();
        const basePath = folderPath || useAppStore.getState().rootFolderPath;
        if (!basePath) {
          showNotification(
            t(settings.language, "notifications_noKnowledgeBaseOpened"),
            "error",
          );
          return null;
        }

        const fullPath = joinFsPath(basePath, fileName);
        await assertTargetPathAvailable(fs, fullPath);
        const newFile = await createFileNode(
          fs,
          fullPath,
          fileName,
          content,
          withErrorHandling,
        );

        // Add to store recursively
        useAppStore.getState().addFile(newFile);

        return newFile;
      } catch (error) {
        if (error instanceof FileSystemError && error.code === "FILE_EXISTS") {
          throw error;
        }
        handleFileSystemError(error, "Failed to create file");
        return null;
      }
    },
    [showNotification, handleFileSystemError],
  );

  /**
   * Create a new folder
   */
  const createFolder = useCallback(
    async (
      folderName: string,
      parentPath?: string,
    ): Promise<FileNode | null> => {
      try {
        const fs = await getFileSystem();
        const basePath = parentPath || useAppStore.getState().rootFolderPath;
        if (!basePath) {
          showNotification(
            t(settings.language, "notifications_noKnowledgeBaseOpened"),
            "error",
          );
          return null;
        }

        const fullPath = joinFsPath(basePath, folderName);
        await assertTargetPathAvailable(fs, fullPath);
        const newNode = await createFolderNode(
          fs,
          fullPath,
          folderName,
          withErrorHandling,
        );

        useAppStore.getState().addFile(newNode);
        return newNode;
      } catch (error) {
        if (error instanceof FileSystemError && error.code === "FILE_EXISTS") {
          throw error;
        }
        handleFileSystemError(error, "Failed to create folder");
        return null;
      }
    },
    [showNotification, handleFileSystemError],
  );

  /**
   * Reveal in explorer
   */
  const revealInExplorer = useCallback(
    async (path: string) => {
      try {
        const fs = await getFileSystem();
        const result = await revealFileInExplorer(fs, path, withErrorHandling);
        if (result === "unsupported") {
          showNotification(
            t(settings.language, "notifications_revealInExplorerUnsupported"),
            "error",
          );
        }
      } catch (error) {
        handleFileSystemError(error, "Failed to reveal in explorer");
      }
    },
    [showNotification, handleFileSystemError],
  );

  /**
   * Rename a file
   */
  const renameFile = useCallback(
    async (file: FileNode, newName: string): Promise<string | null> => {
      try {
        const fs = await getFileSystem();
        const targetPath = joinFsPath(getPathDirname(file.path), newName);
        await assertTargetPathAvailable(fs, targetPath, file.path);
        const newPath = await withErrorHandling(
          () =>
            fs.renameEntry
              ? fs.renameEntry(file.path, newName, file.type === "folder")
              : fs.renameFile(file.path, newName),
          `Failed to rename ${file.type}`,
        );
        if (newPath) {
          const normalizedName =
            file.type === "file"
              ? newName.trim() || file.name
              : newName.trim() || file.name;
          useAppStore
            .getState()
            .updateFileName(file.id, normalizedName, newPath);
        }
        return newPath;
      } catch (error) {
        if (error instanceof FileSystemError && error.code === "FILE_EXISTS") {
          throw error;
        }
        handleFileSystemError(error, `Failed to rename ${file.type}`);
        return null;
      }
    },
    [handleFileSystemError],
  );

  /**
   * Delete a file. Pass `skipRefresh: true` when batching deletes under the same root so the caller can call `refreshFileTree()` once at the end.
   */
  const deleteFile = useCallback(
    async (
      file: FileNode,
      options?: { skipRefresh?: boolean },
    ): Promise<void> => {
      try {
        const rootPath = useAppStore.getState().rootFolderPath;
        const trashFolder = sanitizeTrashFolder(
          useAppStore.getState().settings.trashFolder,
        );
        const fs = await getFileSystem();
        const cleanedTrashContainer = await deleteFileAndCleanupTrash({
          file,
          fs,
          joinFsPath,
          parseTrashPathInfo,
          rootPath,
          trashFolder,
          withErrorHandling,
        });

        if (cleanedTrashContainer) {
          if (!options?.skipRefresh) {
            await refreshFileTree();
          }
        } else {
          useAppStore.getState().removeFile(file.id);
        }
      } catch (error) {
        handleFileSystemError(error, "Failed to delete file");
        throw error; // Re-throw to let caller handle it
      }
    },
    [refreshFileTree, handleFileSystemError],
  );

  /**
   * Move a file/folder to trash (soft delete)
   */
  const moveToTrash = useCallback(
    async (
      file: FileNode,
      options?: { silent?: boolean; skipRefresh?: boolean },
    ): Promise<string | null> => {
      try {
        const rootPath = useAppStore.getState().rootFolderPath;
        const trashFolder = sanitizeTrashFolder(
          useAppStore.getState().settings.trashFolder,
        );
        const fs = await getFileSystem();
        const result = await moveItemToTrash({
          file,
          fs,
          getParentRelativePath,
          getRelativePathFromRoot,
          isPathInTrash,
          joinFsPath,
          createTrashContainerName,
          registerAllowedPath: registerTauriAllowedPath,
          rootPath,
          trashFolder,
          ensureTrashRootDirectory: (
            serviceFs,
            serviceRootPath,
            serviceTrashFolder,
          ) =>
            ensureTrashRootDirectory(
              serviceFs as Awaited<ReturnType<typeof getFileSystem>>,
              serviceRootPath,
              serviceTrashFolder,
            ),
          withErrorHandling,
        });

        if (result.kind === "no_root") {
          if (!options?.silent) {
            showNotification(
              t(settings.language, "notifications_noKnowledgeBaseOpened"),
              "error",
            );
          }
          return null;
        }

        if (result.kind === "already_in_trash") {
          if (!options?.silent) {
            showNotification(
              t(settings.language, "notifications_itemAlreadyInTrash"),
              "error",
            );
          }
          return null;
        }

        if (result.kind === "unsupported") {
          if (!options?.silent) {
            showNotification(
              t(settings.language, "notifications_moveToTrashUnsupported"),
              "error",
            );
          }
          return null;
        }
        if (result.kind !== "success") {
          return null;
        }

        if (!options?.skipRefresh) {
          await refreshFileTree();
        }
        if (!options?.silent) {
          showNotification(
            t(settings.language, "notifications_movedToTrash"),
            "success",
          );
        }
        return result.movedPath;
      } catch (error) {
        if (!options?.silent) {
          handleFileSystemError(error, "Failed to move item to trash");
        }
        return null;
      }
    },
    [showNotification, refreshFileTree, handleFileSystemError],
  );

  /**
   * Restore a file/folder from trash to original location
   */
  const restoreFromTrash = useCallback(
    async (file: FileNode): Promise<string | null> => {
      try {
        const rootPath = useAppStore.getState().rootFolderPath;
        const trashFolder = sanitizeTrashFolder(
          useAppStore.getState().settings.trashFolder,
        );
        const fs = await getFileSystem();
        const result = await restoreItemFromTrash({
          file,
          fs,
          getParentRelativePath,
          getPathBasename,
          joinFsPath,
          joinPathSegments,
          parseTrashPathInfo,
          rootPath,
          trashFolder,
          withErrorHandling,
        });

        if (result.kind === "no_root") {
          showNotification(
            t(settings.language, "notifications_noKnowledgeBaseOpened"),
            "error",
          );
          return null;
        }

        if (result.kind === "invalid_path") {
          showNotification(
            t(settings.language, "notifications_invalidTrashItemPath"),
            "error",
          );
          return null;
        }

        if (result.kind === "unsupported") {
          showNotification(
            t(settings.language, "notifications_restoreFromTrashUnsupported"),
            "error",
          );
          return null;
        }

        if (result.kind === "target_exists") {
          showNotification(
            t(settings.language, "notifications_restoreTargetExists"),
            "error",
          );
          return null;
        }
        if (result.kind !== "success") {
          return null;
        }

        await refreshFileTree();
        showNotification(
          t(settings.language, "notifications_restoredFromTrash"),
          "success",
        );
        return result.restoredPath;
      } catch (error) {
        handleFileSystemError(error, "Failed to restore item from trash");
        return null;
      }
    },
    [showNotification, refreshFileTree, handleFileSystemError],
  );

  /**
   * Move a file to a new folder
   */
  const moveFile = useCallback(
    async (
      sourceFile: FileNode,
      targetFolderPath: string,
    ): Promise<string | null> => {
      try {
        const fs = await getFileSystem();
        const targetPath = joinFsPath(
          targetFolderPath,
          getPathBasename(sourceFile.path),
        );
        await assertTargetPathAvailable(fs, targetPath, sourceFile.path);
        const newPath = await moveFilePath(
          fs,
          sourceFile.path,
          targetFolderPath,
          withErrorHandling,
        );
        return newPath;
      } catch (error) {
        if (error instanceof FileSystemError && error.code === "FILE_EXISTS") {
          throw error;
        }
        handleFileSystemError(error, "Failed to move file");
        return null;
      }
    },
    [handleFileSystemError],
  );

  /**
   * Check if file has unsaved changes
   */
  const hasUnsavedChanges = useCallback((fileId: string): boolean => {
    const state = useAppStore.getState();
    const content = state.fileContents[fileId];
    if (content === undefined) return false;
    return state.hasUnsavedChanges(fileId);
  }, []);

  /**
   * Watch file for changes (Tauri only)
   */
  const watchFile = useCallback(
    async (
      path: string,
      callback: (event: FileWatchEvent | null) => void,
    ): Promise<(() => void) | null> => {
      try {
        const fs = await getFileSystem();
        if (typeof fs.watchFile === "function") {
          return await fs.watchFile(path, callback);
        }
        return null;
      } catch (error) {
        console.error("Failed to watch file:", error);
        return null;
      }
    },
    [],
  );

  const watchDirectory = useCallback(
    async (
      dirPath: string,
      callback: (event: DirectoryWatchEvent) => void,
    ): Promise<(() => void) | null> => {
      try {
        const fs = await getFileSystem();
        if (typeof fs.watchDirectory === "function") {
          return await fs.watchDirectory(dirPath, callback);
        }
        return null;
      } catch (error) {
        console.error("Failed to watch directory:", error);
        return null;
      }
    },
    [],
  );

  return {
    files,
    refreshFileTree,
    openFile,
    openFilePath,
    openDirectory,
    openKnowledgeBase,
    initializeSampleNotes,
    readFile,
    writeFile,
    writeBinaryFile,
    saveFile,
    createFile,
    createFolder,
    renameFile,
    deleteFile,
    moveToTrash,
    restoreFromTrash,
    moveFile,
    revealInExplorer,
    hasUnsavedChanges,
    watchFile,
    watchDirectory,
  };
}
