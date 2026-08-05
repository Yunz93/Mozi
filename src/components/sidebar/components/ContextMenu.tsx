import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FileNode } from '../../../types';
import { useI18n } from '../../../hooks/useI18n';
import { applyFixedMenuViewportFit } from '../../../utils/fitFixedMenuToViewport';

export interface ContextMenuProps {
  x: number;
  y: number;
  node: FileNode;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyRelativePath: () => void;
  onReveal: () => void;
  onCreateFile: () => void;
  onCreateDrawing: () => void;
  onCreateFolder: () => void;
  onMoveToTrash: () => void;
  onRestoreFromTrash: () => void;
  onDeleteForever: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  node,
  onClose,
  onRename,
  onDelete,
  onCopyRelativePath,
  onReveal,
  onCreateFile,
  onCreateDrawing,
  onCreateFolder,
  onMoveToTrash,
  onRestoreFromTrash,
  onDeleteForever,
}) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    applyFixedMenuViewportFit(el, x, y);
  }, [x, y, node.id, node.type, node.isTrash]);

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClick = () => onClose();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-[150] min-w-[180px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200/70 dark:border-white/10 py-1.5 animate-scale-in"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Trash item actions */}
      {node.isTrash && (
        <>
          <button
            onClick={() => {
              onRestoreFromTrash();
              onClose();
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
          >
            <svg
              className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            {t('context_restore')}
          </button>
          <button
            onClick={() => {
              onDeleteForever();
              onClose();
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
          >
            <svg
              className="w-4 h-4 text-red-400 group-hover:text-red-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            {t('context_deleteForever')}
          </button>
        </>
      )}

      {/* Normal file/folder actions */}
      {!node.isTrash && (
        <>
          {node.type === 'folder' && (
            <>
              <button
                onClick={() => {
                  onCreateFile();
                  onClose();
                }}
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
                {t('context_newFile')}
              </button>
              <button
                onClick={() => {
                  onCreateDrawing();
                  onClose();
                }}
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
                {t('context_newDrawing')}
              </button>
              <button
                onClick={() => {
                  onCreateFolder();
                  onClose();
                }}
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
                {t('context_newFolder')}
              </button>
              <div className="h-px bg-gray-100 dark:bg-white/5 my-1 mx-2" />
            </>
          )}

          <button
            onClick={() => {
              onRename();
              onClose();
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
          >
            <svg
              className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            {t('context_rename')}
          </button>

          <button
            onClick={() => {
              onCopyRelativePath();
              onClose();
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
          >
            <svg
              className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {t('context_copyRelativePath')}
          </button>

          <button
            onClick={() => {
              onReveal();
              onClose();
            }}
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
            </svg>
            {t('context_openInFinder')}
          </button>

          <div className="h-px bg-gray-100 dark:bg-white/5 my-1 mx-2" />

          <button
            onClick={() => {
              onMoveToTrash();
              onClose();
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg flex items-center gap-2.5 transition-colors group mx-1.5 w-[calc(100%-12px)]"
          >
            <svg
              className="w-4 h-4 text-red-400 group-hover:text-red-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            {t('context_delete')}
          </button>
        </>
      )}
    </div>
  );

  return createPortal(menu, document.body);
};
