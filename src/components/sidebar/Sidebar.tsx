import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { FileTreeItem } from "./FileTree";
import { TrashView } from "./TrashView";
import { useFileSystem } from "../../hooks/useFileSystem";
import { useAppStore } from "../../store/appStore";

import type { FileNode } from "../../types";

import {
  useSidebarResize,
  useSidebarSearch,
  useSidebarDialogs,
  useSidebarDragAndDrop,
  useSidebarContextMenu,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from "./hooks";

import { ContextMenu } from "./components";
import { ConfirmDialog, PromptDialog } from "../ui/Dialog";

import {
  getTrashItems,
  filterNodesByFileName,
  highlightSearchText,
} from "./utils";
import { useI18n } from "../../hooks/useI18n";
import { isSavableDocumentFile } from "../../utils/fileTypes";
import { applyFixedMenuViewportFit } from "../../utils/fitFixedMenuToViewport";
import { getRenameDialogDefaultValue } from "../../utils/fileTypes";

export interface SidebarProps {
  files: FileNode[];
  activeFileId: string | null;
  onFileSelect: (file: FileNode) => void | Promise<void>;
  onCreateFile: (parentFolder?: FileNode, fileName?: string) => void;
  onCreateDrawing: (parentFolder?: FileNode, fileName?: string) => void;
  onNewFolder: (parentFolder?: FileNode, name?: string) => void;
  onRename: (file: FileNode, newName: string) => void;
  onDelete: (file: FileNode) => void;
  onReveal: (path: string) => void;
  onOpenInNewWindow?: (path: string) => void;
  onMoveToTrash: (file: FileNode) => void;
  onRestoreFromTrash: (file: FileNode) => void;
  onDeleteForever: (file: FileNode) => void;
  onEmptyTrash: (files: FileNode[]) => void;
  onMoveNode: (sourceId: string, targetId: string) => void;
  onMoveToRoot: (sourceId: string) => void;
  onImportDroppedFiles?: (destFolderPath: string, files: File[]) => void;
  currentKnowledgeBaseName?: string;
  currentKnowledgeBasePath?: string;
  onSwitchKnowledgeBase: () => void;
  /** Disable open/switch vault when launched as a standalone OS file open. */
  disableOpenKnowledgeBase?: boolean;
  isOpen: boolean;
  searchFocusRequestKey?: number;
  locateCurrentFileRequestKey?: number;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

function findNodePath(nodes: FileNode[], targetId: string): FileNode[] | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node];
    }

    if (node.children?.length) {
      const childPath = findNodePath(node.children, targetId);
      if (childPath) {
        return [node, ...childPath];
      }
    }
  }

  return null;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function getRelativePathFromKnowledgeBase(
  path: string,
  rootPath: string,
): string {
  const normalizedPath = normalizeSlashes(path);
  const normalizedRoot = normalizeSlashes(rootPath).replace(/\/+$/, "");

  if (normalizedPath === normalizedRoot) {
    return "";
  }

  const rootPrefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(rootPrefix)) {
    return normalizedPath.slice(rootPrefix.length);
  }

  return normalizedPath;
}

async function writeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

const RootContextMenu: React.FC<{
  x: number;
  y: number;
  onClose: () => void;
  onCreateFile: () => void;
  onCreateDrawing: () => void;
  onCreateFolder: () => void;
}> = ({ x, y, onClose, onCreateFile, onCreateDrawing, onCreateFolder }) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    applyFixedMenuViewportFit(el, x, y);
  }, [x, y]);

  React.useEffect(() => {
    const handleClick = () => onClose();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[150] min-w-[180px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200/70 dark:border-white/10 py-1.5 animate-scale-in"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={onCreateFile}
        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
      >
        <svg
          className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        {t("context_newFile")}
      </button>
      <button
        onClick={onCreateDrawing}
        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
      >
        <svg
          className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        {t("context_newDrawing")}
      </button>
      <button
        onClick={onCreateFolder}
        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
      >
        <svg
          className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
        {t("context_newFolder")}
      </button>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = React.memo(
  ({
    files,
    activeFileId,
    onFileSelect,
    onCreateFile,
    onCreateDrawing,
    onNewFolder,
    onRename,
    onDelete: _onDelete,
    onReveal,
    onOpenInNewWindow,
    onMoveToTrash,
    onRestoreFromTrash,
    onDeleteForever,
    onEmptyTrash,
    onMoveNode,
    onMoveToRoot,
    onImportDroppedFiles,
    currentKnowledgeBaseName,
    currentKnowledgeBasePath,
    onSwitchKnowledgeBase,
    disableOpenKnowledgeBase = false,
    isOpen,
    searchFocusRequestKey = 0,
    locateCurrentFileRequestKey = 0,
    width,
    onWidthChange,
    onClose,
  }) => {
    const { t } = useI18n();
    const { readFile } = useFileSystem();
    const fileContents = useAppStore((state) => state.fileContents);
    const themeMode = useAppStore((state) => state.settings.themeMode);
    const trashFolder = useAppStore((state) => state.settings.trashFolder);
    const showNotification = useAppStore((state) => state.showNotification);

    const sidebarRef = useRef<HTMLElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showTrash, setShowTrash] = useState(false);
    const [locatedFileId, setLocatedFileId] = useState<string | null>(null);
    const [rootContextMenu, setRootContextMenu] = useState<{
      x: number;
      y: number;
    } | null>(null);

    const trashItems = useMemo(
      () => getTrashItems(files, trashFolder),
      [files, trashFolder],
    );

    // Hooks
    const { handleResizeStart } = useSidebarResize({ onWidthChange });
    const { contextMenu, openContextMenu, closeContextMenu } =
      useSidebarContextMenu();
    const {
      isRootDragOver,
      setIsRootDragOver,
      handleRootDragOver,
      handleRootDragLeave,
      handleRootDrop,
    } = useSidebarDragAndDrop();

    const searchDeps = useMemo(
      () => ({
        onFileSelect,
        onClose,
      }),
      [onFileSelect, onClose],
    );

    // Stable callback so memoized tree items are not re-rendered on every
    // sidebar render (search input keystrokes, drag state, etc.).
    const handleTreeSelect = useCallback(
      (f: FileNode) => {
        void onFileSelect(f);
        if (window.innerWidth < 768) onClose();
      },
      [onFileSelect, onClose],
    );

    const {
      searchQuery,
      setSearchQuery,
      searchMode,
      setSearchMode,
      searchResults,
      isSearching,
      filteredFiles,
      hasSearchQuery,
      hasVisibleFiles,
      handleSearchResultSelect,
    } = useSidebarSearch(
      {
        files,
        fileContents,
        readFile,
      },
      searchDeps,
    );

    const dialogOptions = useMemo(
      () => ({
        onCreateFile,
        onCreateDrawing,
        onRename,
        onNewFolder,
        // Delete dialog is only opened for permanent trash deletion.
        onDelete: onDeleteForever,
        onEmptyTrash,
      }),
      [
        onCreateFile,
        onCreateDrawing,
        onRename,
        onNewFolder,
        onDeleteForever,
        onEmptyTrash,
      ],
    );

    const {
      dialogState,
      openNewFileDialog,
      openNewDrawingDialog,
      openRenameDialog,
      openNewFolderDialog,
      openDeleteDialog,
      openEmptyTrashDialog,
      closeDialog,
      handleNewFileConfirm,
      handleNewDrawingConfirm,
      handleRenameConfirm,
      handleNewFolderConfirm,
      handleDeleteConfirm,
      handleEmptyTrashConfirm,
    } = useSidebarDialogs(dialogOptions);

    // Focus search input when requested
    useEffect(() => {
      if (searchFocusRequestKey > 0) {
        searchInputRef.current?.focus();
      }
    }, [searchFocusRequestKey]);

    useEffect(() => {
      if (locateCurrentFileRequestKey <= 0 || !activeFileId) return;

      setSearchQuery("");
      setShowTrash(false);
      setLocatedFileId(activeFileId);
    }, [activeFileId, locateCurrentFileRequestKey, setSearchQuery]);

    const locatedPathIds = useMemo(() => {
      if (!locatedFileId) return new Set<string>();

      const path = findNodePath(files, locatedFileId);
      if (!path) return new Set<string>();

      return new Set(
        path.filter((node) => node.type === "folder").map((node) => node.id),
      );
    }, [files, locatedFileId]);

    const sidebarSurfaceStyle = useMemo(
      () =>
        ({
          "--sidebar-width": `${width}px`,
          backgroundColor: themeMode === "dark" ? "#000000" : "#f8fafc",
        }) as React.CSSProperties,
      [themeMode, width],
    );

    const handleCopyRelativePath = useCallback(
      async (node: FileNode) => {
        if (!currentKnowledgeBasePath) {
          showNotification(t("notifications_noKnowledgeBaseOpened"), "error");
          return;
        }

        const relativePath = getRelativePathFromKnowledgeBase(
          node.path,
          currentKnowledgeBasePath,
        );
        if (!relativePath) {
          showNotification(t("notifications_copyRelativePathFailed"), "error");
          return;
        }

        try {
          await writeToClipboard(relativePath);
          showNotification(
            t("notifications_relativePathCopied", { path: relativePath }),
            "success",
          );
        } catch (error) {
          console.error("Failed to copy relative path:", relativePath, error);
          showNotification(t("notifications_copyRelativePathFailed"), "error");
        }
      },
      [currentKnowledgeBasePath, showNotification, t],
    );

    const handleRootContextMenu = useCallback((e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-file-tree-item]")) return;
      e.preventDefault();
      setRootContextMenu({ x: e.clientX, y: e.clientY });
    }, []);

    const closeRootContextMenu = useCallback(() => {
      setRootContextMenu(null);
    }, []);

    return (
      <>
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-20 md:hidden transition-opacity"
            onClick={onClose}
          />
        )}

        <aside
          ref={sidebarRef}
          style={sidebarSurfaceStyle}
          className={`
          sidebar-shell ui-scaled
          fixed md:relative z-30 h-full w-72 md:flex-shrink-0 flex flex-col overflow-hidden
          transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]
          ${
            isOpen
              ? "translate-x-0 md:w-[var(--sidebar-width)] opacity-100"
              : "-translate-x-full md:translate-x-0 md:w-0 md:opacity-0 pointer-events-none"
          }
        `}
        >
          <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
            <div className="flex justify-end items-center px-2 md:hidden">
              <button
                onClick={onClose}
                className="md:hidden p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2.5 md:mt-1">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-gray-200/80 bg-white/70 py-0 pl-3 pr-1 transition-colors focus-within:border-gray-300 focus-within:bg-white/90 dark:border-white/10 dark:bg-[#141a25] dark:focus-within:border-white/20 dark:focus-within:bg-[#181f2c]">
                <span className="pointer-events-none flex shrink-0 items-center text-gray-400 dark:text-gray-500">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("sidebar_search")}
                  className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm font-medium text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-slate-500"
                />
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg px-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-black/[0.04] hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
                  title={`${t("search_mode_label")}: ${
                    searchMode === "keyword"
                      ? t("search_mode_keyword")
                      : searchMode === "semantic"
                        ? t("search_mode_semantic")
                        : t("search_mode_hybrid")
                  } — ${t("search_mode_cycleHint")}`}
                  aria-label={`${t("search_mode_label")}: ${
                    searchMode === "keyword"
                      ? t("search_mode_keyword")
                      : searchMode === "semantic"
                        ? t("search_mode_semantic")
                        : t("search_mode_hybrid")
                  }`}
                  onClick={() => {
                    const order = ["keyword", "semantic", "hybrid"] as const;
                    const next =
                      order[(order.indexOf(searchMode) + 1) % order.length]!;
                    setSearchMode(next);
                  }}
                >
                  <span className="max-w-[3.25rem] truncate">
                    {searchMode === "keyword"
                      ? t("search_mode_keyword")
                      : searchMode === "semantic"
                        ? t("search_mode_semantic")
                        : t("search_mode_hybrid")}
                  </span>
                  <svg
                    className="h-3 w-3 shrink-0 opacity-60"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <polyline points="17 8 12 3 7 8" />
                    <polyline points="7 16 12 21 17 16" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                onClick={() => openNewFileDialog(undefined, t("app_untitled"))}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200/80 dark:border-white/10 bg-white/72 dark:bg-[#141a25] text-gray-700 dark:text-gray-200 shadow-sm transition-colors hover:bg-white dark:hover:bg-[#181f2c] active:scale-95"
                title={t("sidebar_newNote")}
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          <div
            className={`flex-1 overflow-y-auto py-2 scrollbar-hide transition-colors ${
              isRootDragOver
                ? "bg-accent-DEFAULT/10 dark:bg-accent-DEFAULT/10"
                : ""
            }`}
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={(e) =>
              handleRootDrop(e, onMoveToRoot, (droppedFiles) => {
                onImportDroppedFiles?.(
                  currentKnowledgeBasePath ?? "",
                  droppedFiles,
                );
              })
            }
            onDragEnd={() => setIsRootDragOver(false)}
            onContextMenu={handleRootContextMenu}
          >
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-gray-600 px-6 text-center">
                <svg
                  className="w-8 h-8 mb-3 opacity-20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <p className="text-xs mb-3">
                  {t("sidebar_noLocalFilesOpened")}
                </p>
                <p className="text-xs text-gray-400">
                  {currentKnowledgeBasePath
                    ? t("sidebar_dropToAddFiles")
                    : t("sidebar_openKnowledgeBaseHint")}
                </p>
              </div>
            ) : hasSearchQuery ? (
              isSearching ? (
                <div className="flex h-40 items-center justify-center px-6 text-sm text-gray-500 dark:text-gray-400">
                  {t("sidebar_searchingNotes")}
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 px-6 text-center text-gray-400 dark:text-gray-600">
                  <svg
                    className="mb-3 h-8 w-8 opacity-20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("sidebar_noMatchingFiles")}
                  </p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {t("sidebar_tryAnotherKeyword")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 px-3">
                  {searchResults.map(({ file, filenameMatched, snippets }) => (
                    <div
                      key={file.id}
                      className="rounded-2xl border border-gray-200/70 bg-white/72 p-3 shadow-sm transition-colors hover:border-gray-300 hover:bg-white/90 dark:border-white/10 dark:bg-[#121923] dark:hover:border-white/20 dark:hover:bg-[#18212e]"
                    >
                      <button
                        onClick={() => void handleSearchResultSelect(file)}
                        className="flex w-full min-w-0 items-start justify-between gap-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100"
                            title={file.name.replace(/\.md$/i, "")}
                          >
                            {highlightSearchText(
                              file.name.replace(/\.md$/i, ""),
                              searchQuery,
                            )}
                          </div>
                          <div
                            className="truncate text-xs text-gray-500 dark:text-gray-400"
                            title={file.path}
                          >
                            {file.path}
                          </div>
                        </div>
                        {filenameMatched && (
                          <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                            {t("sidebar_filenameMatched")}
                          </span>
                        )}
                      </button>

                      {snippets.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {snippets.map((snippet, index) => (
                            <button
                              key={`${file.id}-${snippet.start}-${index}`}
                              onClick={() =>
                                void handleSearchResultSelect(file, snippet)
                              }
                              className="w-full min-w-0 rounded-xl border border-gray-200/70 bg-white/55 px-3 py-2 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/70 dark:border-white/10 dark:bg-[#0f151f] dark:hover:border-amber-400/40 dark:hover:bg-amber-400/10"
                            >
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                {t("sidebar_paragraphAroundLine", {
                                  line: snippet.line,
                                })}
                              </div>
                              <div className="min-w-0 overflow-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-gray-700 dark:text-gray-200">
                                {highlightSearchText(snippet.text, searchQuery)}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : !hasVisibleFiles ? (
              <div className="flex flex-col items-center justify-center h-40 px-6 text-center text-gray-400 dark:text-gray-600">
                <svg
                  className="mb-3 h-8 w-8 opacity-20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("sidebar_noMatchingFiles")}
                </p>
                {hasSearchQuery && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {t("sidebar_tryAnotherFilenameKeyword")}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredFiles.map((node) => (
                  <FileTreeItem
                    key={node.id}
                    node={node}
                    onSelect={handleTreeSelect}
                    activeId={activeFileId}
                    level={0}
                    onContextMenu={openContextMenu}
                    onMoveNode={onMoveNode}
                    onImportDroppedFiles={onImportDroppedFiles}
                    forceExpanded={hasSearchQuery}
                    expandedPathIds={locatedPathIds}
                    locateRequestKey={locateCurrentFileRequestKey}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="p-3 space-y-2">
            <div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowTrash(!showTrash)}
                  className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-black/[0.04] dark:text-gray-400 dark:hover:bg-white/[0.06]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <svg
                      className="h-4 w-4 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span className="truncate">
                      {t("sidebar_trash", { count: trashItems.length })}
                    </span>
                  </div>
                  {showTrash ? (
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  ) : (
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  )}
                </button>
                {showTrash && trashItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openEmptyTrashDialog()}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-red-600/80 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400/80 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    title={t("context_emptyTrash")}
                  >
                    {t("context_emptyTrash")}
                  </button>
                )}
              </div>

              {showTrash && (
                <TrashView
                  trashItems={trashItems}
                  onRestore={onRestoreFromTrash}
                  onDeleteForever={(node) => openDeleteDialog(node)}
                  onContextMenu={openContextMenu}
                />
              )}
            </div>

            <button
              type="button"
              onClick={onSwitchKnowledgeBase}
              disabled={disableOpenKnowledgeBase}
              aria-disabled={disableOpenKnowledgeBase}
              className={`flex items-center justify-between gap-2 w-full px-3 py-2.5 rounded-xl border border-gray-200/70 dark:border-white/10 transition-colors ${
                disableOpenKnowledgeBase
                  ? "cursor-not-allowed bg-gray-100/70 text-gray-400 dark:bg-[#0f141c] dark:text-gray-600"
                  : "bg-white/60 text-gray-700 hover:bg-white/90 dark:bg-[#121923] dark:text-gray-200 dark:hover:bg-[#18212e]"
              }`}
              title={
                disableOpenKnowledgeBase
                  ? t("sidebar_openKnowledgeBaseDisabledStandalone")
                  : currentKnowledgeBasePath || t("app_openKnowledgeBase")
              }
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <p className="text-sm font-semibold truncate min-w-0">
                  {currentKnowledgeBaseName || t("app_openKnowledgeBase")}
                </p>
              </div>
              <svg
                className="w-4 h-4 shrink-0 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {isOpen && (
            <div
              className="absolute inset-y-0 right-0 hidden w-1 cursor-col-resize md:block opacity-0 hover:opacity-100 transition-opacity"
              onMouseDown={handleResizeStart}
              aria-hidden
            >
              <div className="absolute right-0 top-0 h-full w-px bg-gray-300/50 dark:bg-white/10" />
            </div>
          )}
        </aside>

        {/* Context Menu Portal */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            node={contextMenu.node}
            onClose={closeContextMenu}
            onRename={() =>
              openRenameDialog(
                contextMenu.node,
                getRenameDialogDefaultValue(contextMenu.node.name),
              )
            }
            onDelete={() => openDeleteDialog(contextMenu.node)}
            onCopyRelativePath={() => {
              void handleCopyRelativePath(contextMenu.node);
            }}
            onReveal={() => onReveal(contextMenu.node.path)}
            onOpenInNewWindow={
              onOpenInNewWindow &&
              contextMenu.node.type === "file" &&
              isSavableDocumentFile(contextMenu.node.name)
                ? () => onOpenInNewWindow(contextMenu.node.path)
                : undefined
            }
            onCreateFile={() =>
              openNewFileDialog(
                contextMenu.node.type === "folder"
                  ? contextMenu.node
                  : undefined,
                t("app_untitled"),
              )
            }
            onCreateDrawing={() =>
              openNewDrawingDialog(
                contextMenu.node.type === "folder"
                  ? contextMenu.node
                  : undefined,
                t("app_untitledDrawing"),
              )
            }
            onCreateFolder={() => openNewFolderDialog(contextMenu.node)}
            onMoveToTrash={() => onMoveToTrash(contextMenu.node)}
            onRestoreFromTrash={() => onRestoreFromTrash(contextMenu.node)}
            onDeleteForever={() => openDeleteDialog(contextMenu.node)}
          />
        )}

        {rootContextMenu &&
          createPortal(
            <RootContextMenu
              x={rootContextMenu.x}
              y={rootContextMenu.y}
              onClose={closeRootContextMenu}
              onCreateFile={() => {
                openNewFileDialog(undefined, t("app_untitled"));
                closeRootContextMenu();
              }}
              onCreateDrawing={() => {
                openNewDrawingDialog(undefined, t("app_untitledDrawing"));
                closeRootContextMenu();
              }}
              onCreateFolder={() => {
                openNewFolderDialog(undefined);
                closeRootContextMenu();
              }}
            />,
            document.body,
          )}

        <PromptDialog
          isOpen={dialogState.type === "newFile"}
          title={t("sidebar_newFileTitle")}
          label={t("app_fileName")}
          defaultValue={dialogState.defaultValue || t("app_untitled")}
          onSubmit={(value) =>
            handleNewFileConfirm(
              dialogState.file?.type === "folder"
                ? dialogState.file
                : undefined,
              value,
            )
          }
          onClose={closeDialog}
        />

        <PromptDialog
          isOpen={dialogState.type === "newDrawing"}
          title={t("sidebar_newDrawingTitle")}
          label={t("app_fileName")}
          defaultValue={dialogState.defaultValue || t("app_untitledDrawing")}
          onSubmit={(value) =>
            handleNewDrawingConfirm(
              dialogState.file?.type === "folder"
                ? dialogState.file
                : undefined,
              value,
            )
          }
          onClose={closeDialog}
        />

        <PromptDialog
          isOpen={dialogState.type === "rename"}
          title={t("sidebar_renameTitle")}
          label={t("sidebar_newName")}
          defaultValue={dialogState.defaultValue || ""}
          onSubmit={(value) => handleRenameConfirm(dialogState.file, value)}
          onClose={closeDialog}
        />

        <PromptDialog
          isOpen={dialogState.type === "newFolder"}
          title={t("sidebar_newFolderTitle")}
          label={t("sidebar_folderName")}
          defaultValue=""
          onSubmit={(value) =>
            handleNewFolderConfirm(
              dialogState.file?.type === "folder"
                ? dialogState.file
                : undefined,
              value,
            )
          }
          onClose={closeDialog}
        />

        <ConfirmDialog
          isOpen={dialogState.type === "delete"}
          title={t("sidebar_deleteItemTitle")}
          message={t("sidebar_deleteItemConfirm", {
            name: dialogState.file?.name || "",
          })}
          confirmText={t("common_delete")}
          variant="danger"
          onConfirm={() => handleDeleteConfirm(dialogState.file)}
          onClose={closeDialog}
        />

        <ConfirmDialog
          isOpen={dialogState.type === "emptyTrash"}
          title={t("sidebar_emptyTrashTitle")}
          message={t("sidebar_emptyTrashConfirm", { count: trashItems.length })}
          confirmText={t("context_emptyTrash")}
          variant="danger"
          onConfirm={() => handleEmptyTrashConfirm(trashItems)}
          onClose={closeDialog}
        />
      </>
    );
  },
);
