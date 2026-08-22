import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { FileTypeIcon } from "../FileTypeIcon";
import type { FileNode } from "../../types";
import { isOpenableFile } from "../../utils/fileTypes";
import { getFileTypeBadge } from "../../utils/fileIconKind";
import { useI18n } from "../../hooks/useI18n";
import {
  extractDraggedNodeId as extractDraggedNodeIdFromEvent,
  hasDragPayload,
  setDragPayload,
} from "./dragPayload";
import {
  extractDroppedFiles,
  resolveSidebarDropIntent,
} from "../../utils/droppedFiles";

const AUTO_EXPAND_ON_DRAG_MS = 420;

/** Folder that should receive files dropped onto this tree node. */
export function resolveTreeDropFolderPath(node: FileNode): string {
  if (node.type === "folder") return node.path;
  const normalized = node.path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "";
  return normalized.slice(0, idx);
}

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  activeId: string | null;
  onSelect: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onMoveNode: (sourceId: string, targetId: string) => void;
  onImportDroppedFiles?: (destFolderPath: string, files: File[]) => void;
  forceExpanded?: boolean;
  expandedPathIds?: Set<string>;
  locateRequestKey?: number;
}

export const FileTreeItem: React.FC<FileTreeItemProps> = React.memo(
  function FileTreeItem({
    node,
    level,
    activeId,
    onSelect,
    onContextMenu,
    onMoveNode,
    onImportDroppedFiles,
    forceExpanded = false,
    expandedPathIds,
    locateRequestKey = 0,
  }) {
    const { t } = useI18n();
    const [expanded, setExpanded] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const autoExpandTimerRef = useRef<number | null>(null);
    const itemRef = useRef<HTMLDivElement>(null);

    const isFolder = node.type === "folder";
    const canOpen = isFolder || isOpenableFile(node);
    const typeBadge = !isFolder ? getFileTypeBadge(node.name) : null;
    const isDropTarget = !node.isTrash;

    const extractDraggedNodeId = useCallback(
      (event: React.DragEvent): string | null =>
        extractDraggedNodeIdFromEvent(event),
      [],
    );

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isFolder) {
          setExpanded((prev) => !prev);
          return;
        }
        if (!canOpen) return;
        onSelect(node);
      },
      [canOpen, isFolder, onSelect, node],
    );

    const handleRightClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, node);
      },
      [onContextMenu, node],
    );

    const handleDragStart = useCallback(
      (e: React.DragEvent) => {
        e.stopPropagation();
        setDragPayload(e, node.id, node.type);
        setIsDragging(true);
      },
      [node.id, node.type],
    );

    const clearAutoExpandTimer = useCallback(() => {
      if (autoExpandTimerRef.current !== null) {
        window.clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
      }
    }, []);

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        if (!isDropTarget) return;
        const intent = resolveSidebarDropIntent(e, hasDragPayload(e));
        if (!intent) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = intent === "import-files" ? "copy" : "move";
        setIsDragOver(true);
        if (isFolder && !expanded && autoExpandTimerRef.current === null) {
          autoExpandTimerRef.current = window.setTimeout(() => {
            setExpanded(true);
            autoExpandTimerRef.current = null;
          }, AUTO_EXPAND_ON_DRAG_MS);
        }
      },
      [expanded, isDropTarget, isFolder],
    );

    const handleDragLeave = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        clearAutoExpandTimer();
      },
      [clearAutoExpandTimer],
    );

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        if (!isDropTarget) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        clearAutoExpandTimer();

        const intent = resolveSidebarDropIntent(e, hasDragPayload(e));
        if (intent === "import-files") {
          const dropped = extractDroppedFiles(e);
          if (dropped.length > 0) {
            onImportDroppedFiles?.(resolveTreeDropFolderPath(node), dropped);
          }
          return;
        }

        const sourceId = extractDraggedNodeId(e);
        if (!sourceId) return;

        if (sourceId !== node.id) {
          onMoveNode(sourceId, node.id);
        }
      },
      [
        clearAutoExpandTimer,
        extractDraggedNodeId,
        isDropTarget,
        onImportDroppedFiles,
        onMoveNode,
        node,
      ],
    );

    const handleDragEnd = useCallback(() => {
      setIsDragging(false);
      setIsDragOver(false);
      clearAutoExpandTimer();
    }, [clearAutoExpandTimer]);

    const isActive = node.id === activeId;
    const isInLocatedPath = Boolean(expandedPathIds?.has(node.id));
    const displayName =
      node.type === "file" ? node.name.replace(/\.md$/i, "") : node.name;
    const itemTitle = !canOpen
      ? `${displayName} · ${t("sidebar_fileTypeNotSupported")}`
      : displayName;

    useEffect(() => {
      if (locateRequestKey <= 0 || !isFolder || !isInLocatedPath) return;
      setExpanded(true);
    }, [isFolder, isInLocatedPath, locateRequestKey]);

    useEffect(() => {
      if (locateRequestKey <= 0 || !isActive) return;

      itemRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, [isActive, locateRequestKey]);

    const showChildren =
      isFolder && (expanded || forceExpanded) && node.children;

    // Sorting a large folder on every render is wasteful; only recompute when
    // the children array actually changes.
    const sortedChildren = useMemo(
      () =>
        (node.children ?? [])
          .filter((child) => !child.isTrash)
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
          ),
      [node.children],
    );

    return (
      <div className="select-none" data-file-tree-item>
        <div
          ref={itemRef}
          className={`
          group relative flex items-center py-2 px-3 transition-all duration-200 mx-2 rounded-lg text-sm border border-transparent
          ${canOpen ? "cursor-pointer" : "cursor-not-allowed"}
          ${
            isActive
              ? "bg-accent-DEFAULT/14 text-gray-900 font-semibold shadow-sm ring-1 ring-inset ring-accent-DEFAULT/35 dark:bg-accent-DEFAULT/22 dark:text-white dark:ring-accent-DEFAULT/45"
              : canOpen
                ? "font-medium text-gray-600 hover:bg-black/[0.04] hover:text-black dark:text-slate-400 dark:hover:bg-[#121923] dark:hover:text-white"
                : "font-medium text-gray-400/80 opacity-55 dark:text-slate-500 dark:opacity-50"
          }
          ${isDragOver ? "bg-accent-DEFAULT/20 border-accent-DEFAULT dark:bg-accent-DEFAULT/20 dark:border-accent-DEFAULT" : ""}
          ${isDragging ? "opacity-60" : ""}
        `}
          style={{ paddingLeft: `${level * 8 + 12}px` }}
          aria-selected={isActive}
          aria-disabled={!canOpen}
          draggable={!node.isTrash}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onClick={handleClick}
          onContextMenu={handleRightClick}
          title={itemTitle}
        >
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent-DEFAULT"
            />
          )}
          <span
            className={`mr-2.5 shrink-0 transition-colors ${
              isActive
                ? "text-accent-DEFAULT"
                : canOpen
                  ? "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                  : "text-gray-300 dark:text-slate-600"
            }`}
          >
            {isFolder ? (
              expanded ? (
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3.74999 9.77602C3.86203 9.7589 3.97698 9.75 4.09426 9.75H19.9057C20.023 9.75 20.138 9.7589 20.25 9.77602M3.74999 9.77602C2.55399 9.9588 1.68982 11.0788 1.86688 12.3182L2.72402 18.3182C2.88237 19.4267 3.83169 20.25 4.95141 20.25H19.0486C20.1683 20.25 21.1176 19.4267 21.276 18.3182L22.1331 12.3182C22.3102 11.0788 21.446 9.9588 20.25 9.77602M3.74999 9.77602V6C3.74999 4.75736 4.75735 3.75 5.99999 3.75H9.87867C10.2765 3.75 10.658 3.90804 10.9393 4.18934L13.0607 6.31066C13.342 6.59197 13.7235 6.75 14.1213 6.75H18C19.2426 6.75 20.25 7.75736 20.25 9V9.77602" />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              )
            ) : (
              <FileTypeIcon
                fileName={node.name}
                className="w-4 h-4"
                size={16}
              />
            )}
          </span>
          <span className="truncate min-w-0 flex-1">{displayName}</span>
          {typeBadge && (
            <span
              className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide leading-none ${
                canOpen
                  ? "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400"
                  : "bg-gray-100/70 text-gray-400 dark:bg-white/5 dark:text-slate-600"
              }`}
              aria-hidden
            >
              {typeBadge}
            </span>
          )}
          {isFolder && (
            <span className="ml-auto opacity-30 group-hover:opacity-100 transition-opacity">
              {expanded ? (
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              ) : (
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </span>
          )}
        </div>

        {showChildren && (
          <div className="ml-0 mt-0.5 space-y-0.5">
            {sortedChildren.map((child) => (
              <FileTreeItem
                key={child.id}
                node={child}
                onSelect={onSelect}
                activeId={activeId}
                level={level + 1}
                onContextMenu={onContextMenu}
                onMoveNode={onMoveNode}
                onImportDroppedFiles={onImportDroppedFiles}
                forceExpanded={forceExpanded}
                expandedPathIds={expandedPathIds}
                locateRequestKey={locateRequestKey}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);
