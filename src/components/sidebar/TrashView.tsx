import React from "react";
import { Folder, RotateCcw, Trash2 } from "lucide-react";
import { FileTypeIcon } from "../FileTypeIcon";
import type { FileNode } from "../../types";
import { useI18n } from "../../hooks/useI18n";
import { getFileTypeBadge } from "../../utils/fileIconKind";

export interface TrashViewProps {
  trashItems: FileNode[];
  onRestore: (file: FileNode) => void;
  onDeleteForever: (file: FileNode) => void;
  disabled?: boolean;
}

export const TrashView: React.FC<TrashViewProps> = ({
  trashItems,
  onRestore,
  onDeleteForever,
  disabled = false,
}) => {
  const { t } = useI18n();
  if (!trashItems.length)
    return (
      <div className="workspace-trash-muted flex min-h-40 flex-col items-center justify-center gap-3 text-sm">
        <Trash2 size={28} strokeWidth={1.5} aria-hidden />
        <p>{t("trash_empty")}</p>
      </div>
    );
  return (
    <ul className="workspace-trash-list m-0 list-none p-0">
      {trashItems.map((node) => {
        const typeBadge =
          node.type === "file" ? getFileTypeBadge(node.name) : null;
        return (
          <li
            key={node.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="workspace-trash-muted shrink-0">
                {node.type === "folder" ? (
                  <Folder size={18} aria-hidden />
                ) : (
                  <FileTypeIcon fileName={node.name} size={18} />
                )}
              </span>
              <span className="min-w-0 truncate text-sm" title={node.name}>
                {node.name}
              </span>
              {typeBadge && (
                <span
                  className="workspace-trash-badge shrink-0 text-[10px] font-semibold"
                  aria-hidden
                >
                  {typeBadge}
                </span>
              )}
            </div>
            <div className="workspace-trash-actions ml-auto flex shrink-0 gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRestore(node)}
                aria-label={`${t("context_restore")} ${node.name}`}
              >
                <RotateCcw size={14} aria-hidden />
                {t("context_restore")}
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={disabled}
                onClick={() => onDeleteForever(node)}
                aria-label={`${t("context_deleteForever")} ${node.name}`}
              >
                <Trash2 size={14} aria-hidden />
                {t("context_deleteForever")}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
