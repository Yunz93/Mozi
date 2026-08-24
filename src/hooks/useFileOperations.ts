import { useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { useFileSystem } from "./useFileSystem";
import type { FileNode } from "../types";
import { getFileSystem } from "../types/filesystem";
import { clearAttachmentResolverCache } from "../utils/attachmentResolver";
import { t } from "../utils/i18n";
import { findAndRewriteAffectedFiles } from "../utils/linkRewriter";
import { buildFrontmatterFromMetadataTemplate } from "../utils/metadataFields";
import { findFileInTree } from "../utils/fileTree";
import {
  buildTabPathRemapState,
  migrateDraftBackupKeys,
} from "../utils/pathRemap";
import {
  isExcalidrawFile,
  isHtmlFile,
  isMarkdownFile,
  isPreviewOnlyFile,
  resolveRenamedFileName,
} from "../utils/fileTypes";
import {
  createEmptyExcalidrawDocument,
  resolveExcalidrawFileName,
} from "../utils/excalidrawDocument";
import { normalizeSlashes } from "../utils/pathHelpers";
import { clearDraftBackup, readDraftBackup } from "../utils/draftBackup";
import {
  normalizeNewNoteLocation,
  resolveNewNoteFolderPath,
} from "../utils/newNoteLocation";
import { remapPathsInIndex } from "../services/vault/linkIndexService";
import { remapPathsInChunkIndex } from "../services/vault/chunkIndexService";
import { notifyVaultFileSaved } from "../services/vault/linkIndexEvents";
import {
  CHUNK_INDEX_FILE,
  LINK_INDEX_FILE,
  VECTOR_INDEX_FILE,
  writeIndexJson,
} from "../services/vault/indexStorage";
import {
  getActiveVectorStore,
  setActiveChunkIndex,
} from "../services/vault/semanticIndexRuntime";
import { packVectorSnapshot } from "../services/vault/vectorStore";
import { flushActiveDocumentIfDirty } from "../services/filesystem/flushActiveDocument";
import { importDroppedFiles } from "../services/filesystem/importDroppedFiles";

/** Prevent overlapping create calls for the same destination path. */
const createDocumentInFlight = new Set<string>();

function isSameOrChildPath(path: string, parentPath: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedParent = parentPath.replace(/\\/g, "/");
  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`)
  );
}

// Parent directory of a path; returns '' at the root (distinct from
// pathHelpers.getPathDirname which returns '/').
function getParentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "";
  return normalized.slice(0, idx);
}

function buildMovedPathMap(
  sourceNode: FileNode,
  newRootPath: string,
): Record<string, string> {
  const pathMap: Record<string, string> = {};
  const sourceRootPath = sourceNode.path;

  const visit = (node: FileNode) => {
    const suffix = node.path.slice(sourceRootPath.length);
    pathMap[node.path] = `${newRootPath}${suffix}`;
    node.children?.forEach(visit);
  };

  visit(sourceNode);
  return pathMap;
}

function collectAffectedOpenTabIds(
  files: FileNode[],
  openTabs: string[],
  target: FileNode,
): string[] {
  return openTabs.filter((tabId) => {
    const node = findFileInTree(files, tabId);
    return node?.type === "file" && isSameOrChildPath(node.path, target.path);
  });
}

/** Flush dirty open tabs under `target` to disk before path-changing ops. */
async function flushDirtyTabsForTarget(
  files: FileNode[],
  openTabs: string[],
  target: FileNode,
): Promise<boolean> {
  const state = useAppStore.getState();
  const dirtyTabIds = collectAffectedOpenTabIds(files, openTabs, target).filter(
    (tabId) => state.hasUnsavedChanges(tabId),
  );
  if (dirtyTabIds.length === 0) return true;

  try {
    const fs = await getFileSystem();
    for (const tabId of dirtyTabIds) {
      const node = findFileInTree(state.files, tabId);
      const content = state.fileContents[tabId];
      if (!node || node.type !== "file" || content === undefined) {
        continue;
      }
      await fs.writeFile(node.path, content);
      state.markAsSaved(tabId, content);
    }
    return true;
  } catch (e) {
    console.error("Failed to save unsaved changes before path change:", e);
    return false;
  }
}

/**
 * Encapsulates all file CRUD and drag-and-drop operations from App.tsx.
 */
export function useFileOperations() {
  const {
    files,
    rootFolderPath,
    fileContents,
    openTabs,
    settings,
    addTab,
    closeTab,
    updateTabContent,
    markAsSaved,
    setCurrentFilePath,
    showNotification,
  } = useAppStore();

  const {
    readFile,
    createFile,
    createFolder,
    renameFile,
    deleteFile,
    moveToTrash,
    restoreFromTrash,
    moveFile,
    refreshFileTree,
    revealInExplorer,
  } = useFileSystem();

  const handleFileSelect = useCallback(
    async (file: FileNode) => {
      if (file.type === "folder") return;

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

        const previousId = useAppStore.getState().activeTabId;
        if (previousId && previousId !== file.id) {
          const flushed = await flushActiveDocumentIfDirty();
          if (!flushed) {
            showNotification(
              t(settings.language, "tab_closeBlockedUnsaved"),
              "error",
            );
            return;
          }
        }

        addTab(file.id);
        setCurrentFilePath(file.path);

        if (isPreviewOnlyFile(file.name)) {
          if (isHtmlFile(file.name)) {
            const text = await readFile(file);
            updateTabContent(file.id, text);
            markAsSaved(file.id);
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
            updateTabContent(file.id, text);
            markAsSaved(file.id);
          }
          return;
        }

        const cachedContent =
          previousId === file.id
            ? useAppStore.getState().fileContents[file.id]
            : undefined;

        if (cachedContent === undefined) {
          const text = await readFile(file);
          updateTabContent(file.id, text);
          markAsSaved(file.id);

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
                draftContent: draft,
              });
            }
          }
        }
      } catch (e) {
        console.error("Failed to read file:", file.path, e);
        showNotification(
          t(settings.language, "notifications_failedToReadFile", {
            name: file.name,
          }),
          "error",
        );
      }
    },
    [
      readFile,
      addTab,
      setCurrentFilePath,
      updateTabContent,
      markAsSaved,
      showNotification,
      settings.language,
    ],
  );

  const handleCreateFile = useCallback(
    async (parentFolder?: FileNode, fileName?: string) => {
      const timestamp = Date.now();
      const normalizedName = (fileName?.trim() || `note-${timestamp}`).replace(
        /\.md$/i,
        "",
      );
      const finalFileName = `${normalizedName}.md`;
      const documentTitle = normalizedName;
      const frontmatterBlock = buildFrontmatterFromMetadataTemplate(
        settings.metadataFields,
      );
      const initialContent = `${frontmatterBlock}# ${documentTitle}\n\n`;

      const storeState = useAppStore.getState();
      const destinationFolderPath = resolveNewNoteFolderPath({
        location: normalizeNewNoteLocation(settings.newNoteLocation),
        rootFolderPath: storeState.rootFolderPath,
        currentFilePath: storeState.currentFilePath,
        explicitFolderPath: parentFolder?.path,
        newNoteFolder: settings.newNoteFolder,
      });
      const createKey = `${destinationFolderPath ?? storeState.rootFolderPath ?? ""}/${finalFileName}`;
      if (createDocumentInFlight.has(createKey)) {
        return;
      }
      createDocumentInFlight.add(createKey);

      try {
        const flushed = await flushActiveDocumentIfDirty();
        if (!flushed) {
          showNotification(
            t(settings.language, "tab_closeBlockedUnsaved"),
            "error",
          );
          return;
        }

        const newFile = await createFile(
          finalFileName,
          initialContent,
          destinationFolderPath,
        );
        if (newFile) {
          addTab(newFile.id, initialContent);
          setCurrentFilePath(newFile.path);
        }
      } finally {
        createDocumentInFlight.delete(createKey);
      }
    },
    [
      settings.metadataFields,
      settings.newNoteLocation,
      settings.newNoteFolder,
      settings.language,
      createFile,
      addTab,
      setCurrentFilePath,
      showNotification,
    ],
  );

  const handleCreateDrawing = useCallback(
    async (parentFolder?: FileNode, fileName?: string) => {
      const finalFileName = resolveExcalidrawFileName(
        fileName?.trim() || `drawing-${Date.now()}`,
      );
      const initialContent = createEmptyExcalidrawDocument();

      const storeState = useAppStore.getState();
      const destinationFolderPath = resolveNewNoteFolderPath({
        location: normalizeNewNoteLocation(settings.newNoteLocation),
        rootFolderPath: storeState.rootFolderPath,
        currentFilePath: storeState.currentFilePath,
        explicitFolderPath: parentFolder?.path,
        newNoteFolder: settings.newNoteFolder,
      });
      const createKey = `${destinationFolderPath ?? storeState.rootFolderPath ?? ""}/${finalFileName}`;
      if (createDocumentInFlight.has(createKey)) {
        return;
      }
      createDocumentInFlight.add(createKey);

      try {
        const flushed = await flushActiveDocumentIfDirty();
        if (!flushed) {
          showNotification(
            t(settings.language, "tab_closeBlockedUnsaved"),
            "error",
          );
          return;
        }

        const newFile = await createFile(
          finalFileName,
          initialContent,
          destinationFolderPath,
        );
        if (newFile) {
          addTab(newFile.id, initialContent);
          setCurrentFilePath(newFile.path);
        }
      } finally {
        createDocumentInFlight.delete(createKey);
      }
    },
    [
      settings.newNoteLocation,
      settings.newNoteFolder,
      settings.language,
      createFile,
      addTab,
      setCurrentFilePath,
      showNotification,
    ],
  );

  const handleMoveToTrash = useCallback(
    async (file: FileNode) => {
      const affectedTabIds = collectAffectedOpenTabIds(files, openTabs, file);

      // Flush unsaved edits to disk first so the trashed copy keeps the
      // latest content. Abort if the flush fails - otherwise closing the
      // tabs below would silently drop those edits.
      const flushed = await flushDirtyTabsForTarget(files, openTabs, file);
      if (!flushed) {
        showNotification(
          t(settings.language, "notifications_moveToTrashSaveFailed"),
          "error",
        );
        return;
      }

      const movedPath = await moveToTrash(file);
      if (!movedPath) return;

      affectedTabIds.forEach((tabId) => closeTab(tabId));
    },
    [moveToTrash, files, openTabs, closeTab, showNotification, settings],
  );

  const handleRestoreFromTrash = useCallback(
    async (file: FileNode) => {
      await restoreFromTrash(file);
    },
    [restoreFromTrash],
  );

  const handleDeleteForever = useCallback(
    async (file: FileNode) => {
      try {
        const affectedTabIds = collectAffectedOpenTabIds(files, openTabs, file);
        await deleteFile(file);
        affectedTabIds.forEach((tabId) => closeTab(tabId));
        showNotification(
          t(settings.language, "notifications_permanentlyDeleted"),
          "success",
        );
      } catch {
        showNotification(
          t(settings.language, "notifications_failedDeleteFile"),
          "error",
        );
      }
    },
    [files, openTabs, deleteFile, closeTab, showNotification],
  );

  const handleEmptyTrash = useCallback(
    async (trashItems: FileNode[]) => {
      if (trashItems.length === 0) {
        showNotification(
          t(settings.language, "notifications_trashAlreadyEmpty"),
          "success",
        );
        return;
      }

      try {
        const affectedTabIds = new Set<string>();
        trashItems.forEach((item) => {
          collectAffectedOpenTabIds(files, openTabs, item).forEach((tabId) =>
            affectedTabIds.add(tabId),
          );
        });

        for (const item of trashItems) {
          await deleteFile(item, { skipRefresh: true });
        }
        await refreshFileTree();

        affectedTabIds.forEach((tabId) => closeTab(tabId));
        showNotification(
          t(settings.language, "notifications_trashEmptied"),
          "success",
        );
      } catch {
        try {
          await refreshFileTree();
        } catch {
          // best-effort resync after partial delete
        }
        showNotification(
          t(settings.language, "notifications_failedEmptyTrash"),
          "error",
        );
      }
    },
    [files, openTabs, deleteFile, refreshFileTree, closeTab, showNotification],
  );

  const remapPathReferencesAfterMove = useCallback(
    (pathMap: Record<string, string>) => {
      useAppStore.setState((state) => buildTabPathRemapState(state, pathMap));
      migrateDraftBackupKeys(pathMap);

      if (Object.keys(pathMap).length === 0) return;

      const state = useAppStore.getState();
      const linkIndex = state.linkIndex;
      if (linkIndex) {
        const next = remapPathsInIndex(linkIndex, pathMap);
        state.setLinkIndex(next);
        void writeIndexJson(next.vaultRoot, LINK_INDEX_FILE, next);
      }

      const chunkIndex = state.chunkIndex;
      if (chunkIndex) {
        const { snapshot: nextChunks, idMap } = remapPathsInChunkIndex(
          chunkIndex,
          pathMap,
        );
        state.setChunkIndex(nextChunks);
        setActiveChunkIndex(nextChunks);
        void writeIndexJson(nextChunks.vaultRoot, CHUNK_INDEX_FILE, nextChunks);

        const vectorStore = getActiveVectorStore();
        if (vectorStore && Object.keys(idMap).length > 0) {
          vectorStore.remapIds(idMap);
          state.setSemanticStatus(vectorStore.size() > 0, vectorStore.size());
          void writeIndexJson(
            nextChunks.vaultRoot,
            VECTOR_INDEX_FILE,
            packVectorSnapshot(vectorStore.toSnapshot()),
          );
        }
      }
    },
    [],
  );

  const updateLinksAfterMove = useCallback(
    async (pathMap: Record<string, string>) => {
      const state = useAppStore.getState();
      if (!state.rootFolderPath) return;

      try {
        const fs = await getFileSystem();
        const result = await findAndRewriteAffectedFiles({
          movedPathMap: pathMap,
          files: state.files,
          rootFolderPath: state.rootFolderPath,
          fileContentOverrides: state.fileContents,
          readFile: (path) => fs.readFile(path),
        });

        if (result.modifiedFiles.length === 0) return;

        const appliedMods: typeof result.modifiedFiles = [];
        const skippedUnsaved: string[] = [];

        for (const mod of result.modifiedFiles) {
          const stateNow = useAppStore.getState();
          if (stateNow.hasUnsavedChanges(mod.path)) {
            skippedUnsaved.push(mod.path);
            continue;
          }

          await fs.writeFile(mod.path, mod.newContent);
          appliedMods.push(mod);
        }

        if (appliedMods.length === 0) {
          if (skippedUnsaved.length > 0) {
            showNotification(
              t(settings.language, "notifications_linksSkippedUnsaved", {
                count: String(skippedUnsaved.length),
              }),
              "error",
            );
          }
          return;
        }

        useAppStore.setState((s) => {
          const nextContents = { ...s.fileContents };
          const nextSaved = { ...s.lastSavedContent };
          for (const mod of appliedMods) {
            if (s.hasUnsavedChanges(mod.path)) {
              continue;
            }
            if (mod.path in nextContents) {
              nextContents[mod.path] = mod.newContent;
            }
            if (mod.path in nextSaved) {
              nextSaved[mod.path] = mod.newContent;
            }
          }
          return { fileContents: nextContents, lastSavedContent: nextSaved };
        });

        clearAttachmentResolverCache();

        for (const mod of appliedMods) {
          notifyVaultFileSaved(mod.path, mod.newContent);
        }

        showNotification(
          t(settings.language, "notifications_linksUpdated", {
            count: String(appliedMods.length),
          }),
          "success",
        );
      } catch (e) {
        console.error("Failed to update links after move:", e);
        showNotification(
          t(settings.language, "notifications_linkUpdateFailed"),
          "error",
        );
      }
    },
    [showNotification],
  );

  const handleRename = useCallback(
    async (file: FileNode, newName: string) => {
      try {
        const resolvedName =
          file.type === "file"
            ? resolveRenamedFileName(file.name, newName)
            : newName.trim();
        if (!resolvedName || resolvedName === file.name) return;

        const flushed = await flushDirtyTabsForTarget(files, openTabs, file);
        if (!flushed) {
          showNotification(
            t(settings.language, "notifications_renameSaveFailed"),
            "error",
          );
          return;
        }

        const newPath = await renameFile(file, resolvedName);
        if (!newPath || newPath === file.path) return;

        const pathMap = buildMovedPathMap(file, newPath);
        remapPathReferencesAfterMove(pathMap);
        await refreshFileTree();
        await updateLinksAfterMove(pathMap);
      } catch {
        showNotification(
          t(settings.language, "notifications_renameFailed"),
          "error",
        );
      }
    },
    [
      files,
      openTabs,
      renameFile,
      remapPathReferencesAfterMove,
      refreshFileTree,
      updateLinksAfterMove,
      showNotification,
      settings.language,
    ],
  );

  const moveNodeToTargetPath = useCallback(
    async (sourceNode: FileNode, targetPath: string) => {
      const normalizedTargetPath = normalizeSlashes(targetPath);
      const normalizedSourceParent = normalizeSlashes(
        getParentPath(sourceNode.path),
      );

      if (!normalizedTargetPath) {
        showNotification(
          t(settings.language, "notifications_invalidTargetFolder"),
          "error",
        );
        return;
      }

      if (normalizedTargetPath === normalizedSourceParent) {
        return;
      }

      if (
        sourceNode.type === "folder" &&
        isSameOrChildPath(targetPath, sourceNode.path)
      ) {
        showNotification(
          t(settings.language, "notifications_cannotMoveFolderIntoItself"),
          "error",
        );
        return;
      }

      if (sourceNode.isTrash) {
        showNotification(
          t(settings.language, "notifications_cannotMoveTrashItemsFromHere"),
          "error",
        );
        return;
      }

      try {
        const flushed = await flushDirtyTabsForTarget(
          files,
          openTabs,
          sourceNode,
        );
        if (!flushed) {
          showNotification(
            t(settings.language, "notifications_moveSaveFailed"),
            "error",
          );
          return;
        }

        const newPath = await moveFile(sourceNode, targetPath);
        if (!newPath) return;

        const pathMap = buildMovedPathMap(sourceNode, newPath);
        remapPathReferencesAfterMove(pathMap);
        await refreshFileTree();
        await updateLinksAfterMove(pathMap);
        showNotification(
          t(
            settings.language,
            sourceNode.type === "folder"
              ? "notifications_folderMoved"
              : "notifications_fileMoved",
          ),
          "success",
        );
      } catch (e) {
        console.error("Failed to move item:", e);
        showNotification(
          t(
            settings.language,
            sourceNode.type === "folder"
              ? "notifications_failedMoveFolder"
              : "notifications_failedMoveFile",
          ),
          "error",
        );
      }
    },
    [
      moveFile,
      files,
      openTabs,
      refreshFileTree,
      remapPathReferencesAfterMove,
      updateLinksAfterMove,
      showNotification,
      settings.language,
    ],
  );

  const handleMoveNode = useCallback(
    async (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      const sourceNode = findFileInTree(files, sourceId);
      const targetNode = findFileInTree(files, targetId);

      if (!sourceNode || !targetNode) {
        showNotification(
          t(settings.language, "notifications_moveTargetNotFound"),
          "error",
        );
        return;
      }

      if (targetNode.isTrash) {
        showNotification(
          t(settings.language, "notifications_cannotMoveIntoTrashDirectly"),
          "error",
        );
        return;
      }

      const targetPath =
        targetNode.type === "folder"
          ? targetNode.path
          : getParentPath(targetNode.path) || rootFolderPath;

      if (!targetPath) {
        showNotification(
          t(settings.language, "notifications_targetFolderNotFound"),
          "error",
        );
        return;
      }

      await moveNodeToTargetPath(sourceNode, targetPath);
    },
    [files, moveNodeToTargetPath, rootFolderPath, showNotification],
  );

  const handleMoveToRoot = useCallback(
    async (sourceId: string) => {
      if (!rootFolderPath) {
        showNotification(
          t(settings.language, "notifications_noKnowledgeBaseOpened"),
          "error",
        );
        return;
      }

      const sourceNode = findFileInTree(files, sourceId);
      if (!sourceNode) {
        showNotification(
          t(settings.language, "notifications_itemNotFound"),
          "error",
        );
        return;
      }

      await moveNodeToTargetPath(sourceNode, rootFolderPath);
    },
    [files, rootFolderPath, moveNodeToTargetPath, showNotification],
  );

  const handleImportDroppedFiles = useCallback(
    async (targetFolderPath: string, dropped: File[]) => {
      if (!rootFolderPath) {
        showNotification(
          t(settings.language, "notifications_noKnowledgeBaseOpened"),
          "error",
        );
        return;
      }

      const dest = targetFolderPath.trim() || rootFolderPath;
      if (!isSameOrChildPath(dest, rootFolderPath)) {
        showNotification(
          t(settings.language, "notifications_invalidTargetFolder"),
          "error",
        );
        return;
      }

      if (dropped.length === 0) {
        showNotification(
          t(settings.language, "notifications_noFilesDropped"),
          "info",
        );
        return;
      }

      try {
        const fs = await getFileSystem();
        const result = await importDroppedFiles({
          files: dropped,
          targetFolderPath: dest,
          fs,
        });

        if (result.imported.length > 0) {
          await refreshFileTree();
        }

        if (result.imported.length === 1) {
          showNotification(
            t(settings.language, "notifications_fileAdded", {
              name: result.imported[0]!.name,
            }),
            "success",
          );
        } else if (result.imported.length > 1) {
          showNotification(
            t(settings.language, "notifications_filesAdded", {
              count: result.imported.length,
            }),
            "success",
          );
        } else if (result.failed.length === 0) {
          showNotification(
            t(settings.language, "notifications_noFilesDropped"),
            "info",
          );
        }

        if (result.failed.length > 0) {
          const first = result.failed[0]!;
          showNotification(
            t(settings.language, "notifications_addFilesFailed", {
              error: first.error,
            }),
            "error",
          );
        }

        const openable = result.imported.filter(
          (file) =>
            isMarkdownFile(file.name) ||
            isExcalidrawFile(file.name) ||
            isPreviewOnlyFile(file.name),
        );
        if (openable.length !== 1) return;

        const node = findFileInTree(
          useAppStore.getState().files,
          openable[0]!.path,
        );
        if (node) {
          await handleFileSelect(node);
        }
      } catch (error) {
        showNotification(
          t(settings.language, "notifications_addFilesFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
          "error",
        );
      }
    },
    [
      handleFileSelect,
      refreshFileTree,
      rootFolderPath,
      settings.language,
      showNotification,
    ],
  );

  const handleNewFolder = useCallback(
    async (parentFolder?: FileNode, name?: string) => {
      if (!name || !name.trim()) return;
      const newNode = await createFolder(name, parentFolder?.path);
      if (newNode) {
        showNotification(
          t(settings.language, "notifications_folderCreated"),
          "success",
        );
      }
    },
    [createFolder, showNotification],
  );

  const handleRevealInExplorer = useCallback(
    async (path: string) => {
      try {
        await revealInExplorer(path);
      } catch (e) {
        console.error("Failed to reveal in explorer:", e);
        showNotification(
          t(settings.language, "notifications_failedRevealInExplorer"),
          "error",
        );
      }
    },
    [revealInExplorer, showNotification],
  );

  const handleOpenInFileExplorer = useCallback(
    async (file: FileNode) => {
      try {
        await revealInExplorer(file.path);
        showNotification(
          t(settings.language, "notifications_openedFileLocationInExplorer"),
          "success",
        );
      } catch (error) {
        console.error("Failed to open in file explorer:", error);
        showNotification(
          t(settings.language, "notifications_failedOpenInFileExplorer"),
          "error",
        );
      }
    },
    [revealInExplorer, showNotification],
  );

  const handleDelete = useCallback(
    async (file: FileNode) => {
      try {
        const affectedTabIds = collectAffectedOpenTabIds(files, openTabs, file);
        await deleteFile(file);
        affectedTabIds.forEach((tabId) => closeTab(tabId));
        showNotification(
          t(settings.language, "notifications_deleted"),
          "success",
        );
      } catch {
        showNotification(
          t(settings.language, "notifications_failedDeleteFile"),
          "error",
        );
      }
    },
    [files, openTabs, deleteFile, closeTab, showNotification],
  );

  return {
    handleFileSelect,
    handleCreateFile,
    handleCreateDrawing,
    handleRename,
    handleMoveToTrash,
    handleRestoreFromTrash,
    handleDeleteForever,
    handleEmptyTrash,
    handleDelete,
    handleMoveNode,
    handleMoveToRoot,
    handleImportDroppedFiles,
    handleNewFolder,
    handleRevealInExplorer,
    handleOpenInFileExplorer,
  };
}
