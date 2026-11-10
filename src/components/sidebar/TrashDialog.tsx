import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { FileNode } from "../../types";
import { useI18n } from "../../hooks/useI18n";
import { Dialog } from "../ui/Dialog";
import { TrashView } from "./TrashView";
import { getTrashItems } from "./utils";

interface TrashDialogProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileNode[];
  trashFolder: string;
  onRestore: (file: FileNode) => void | Promise<void>;
  onDeleteForever: (file: FileNode) => void | Promise<void>;
  onEmptyTrash: (files: FileNode[]) => void | Promise<void>;
}

type Confirmation =
  | { type: "delete"; file: FileNode }
  | { type: "empty"; files: FileNode[] }
  | null;

export function TrashDialog({
  isOpen,
  onClose,
  files,
  trashFolder,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
}: TrashDialogProps) {
  const { t } = useI18n();
  const items = useMemo(
    () => getTrashItems(files, trashFolder),
    [files, trashFolder],
  );
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const busyRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = contentRef.current?.closest<HTMLElement>(
      ".workspace-trash-dialog",
    );
    if (!dialog || dialog.contains(document.activeElement)) return;
    // 列表按钮在确认或刷新后会卸载，焦点回到当前弹窗，避免落回背景页面。
    const otherDialog = document.activeElement?.closest('[role="dialog"]');
    if (otherDialog && otherDialog !== dialog) return;
    (confirmation ? cancelRef.current : dialog)?.focus({ preventScroll: true });
  }, [isOpen, confirmation, items]);

  useEffect(() => {
    if (isOpen && confirmation)
      cancelRef.current?.focus({ preventScroll: true });
  }, [isOpen, confirmation]);

  useEffect(() => {
    if (!isOpen) {
      setConfirmation(null);
      setError(false);
      return;
    }
    const dialog = contentRef.current?.closest<HTMLElement>(
      ".workspace-trash-dialog",
    );
    if (!dialog) return;
    const containTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest?.('[role="dialog"]') && !dialog.contains(target))
        return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (
        !first ||
        !dialog.contains(document.activeElement) ||
        document.activeElement === dialog ||
        (event.shiftKey
          ? document.activeElement === first
          : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", containTab, true);
    return () => document.removeEventListener("keydown", containTab, true);
  }, [isOpen]);

  const close = () => {
    if (busyRef.current) return;
    if (confirmation) {
      setConfirmation(null);
      setError(false);
    } else onClose();
  };
  const run = async (action: () => void | Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(false);
    try {
      await action();
      setConfirmation(null);
    } catch {
      setError(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={t("toolbar_trash")}
      className="workspace-trash-dialog max-w-2xl"
      contentClassName="flex min-h-0 flex-col gap-4"
      contentScroll={false}
      closable={!busy}
    >
      <div
        ref={contentRef}
        className="flex min-h-0 flex-col gap-4"
        aria-busy={busy}
      >
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("trash_operationFailed")}
          </p>
        )}
        {confirmation ? (
          <>
            <p className="text-sm leading-relaxed">
              {confirmation.type === "delete"
                ? t("sidebar_deleteItemConfirm", {
                    name: confirmation.file.name,
                  })
                : t("sidebar_emptyTrashConfirm", {
                    count: confirmation.files.length,
                  })}
            </p>
            <div className="workspace-trash-actions flex flex-wrap justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                disabled={busy}
                onClick={close}
              >
                {t("common_cancel")}
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    confirmation.type === "delete"
                      ? onDeleteForever(confirmation.file)
                      : onEmptyTrash(confirmation.files),
                  )
                }
              >
                {t(
                  confirmation.type === "delete"
                    ? "context_deleteForever"
                    : "context_emptyTrash",
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="workspace-trash-actions flex flex-wrap items-center justify-between gap-3">
              <span className="workspace-trash-muted text-sm">
                {t("sidebar_trash", { count: items.length })}
              </span>
              <button
                type="button"
                className="is-danger"
                disabled={busy || !items.length}
                onClick={() => {
                  setError(false);
                  setConfirmation({ type: "empty", files: items });
                }}
              >
                <Trash2 size={14} aria-hidden />
                {t("context_emptyTrash")}
              </button>
            </div>
            <div className="min-h-0 max-h-[55vh] overflow-y-auto">
              <TrashView
                trashItems={items}
                disabled={busy}
                onRestore={(file) => void run(() => onRestore(file))}
                onDeleteForever={(file) => {
                  setError(false);
                  setConfirmation({ type: "delete", file });
                }}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
