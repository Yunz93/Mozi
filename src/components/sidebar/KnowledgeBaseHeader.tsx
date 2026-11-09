import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Folder, FolderOpen, Settings } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import type { FileSortMode } from "../../types";
import { isImeComposingEvent } from "../../utils/imeKeyboard";

const sortOptions = [
  ["name", "sidebar_sortName"],
  ["created", "sidebar_sortCreated"],
  ["modified", "sidebar_sortModified"],
  ["type", "sidebar_sortType"],
] as const;

export interface KnowledgeBaseHeaderProps {
  name?: string;
  path?: string;
  disabled?: boolean;
  onSwitch: () => void;
  onOpenSettings: () => void;
  sortMode?: FileSortMode;
  onSortChange?: (mode: FileSortMode) => void;
  sortStatus?: string;
}

export const KnowledgeBaseHeader: React.FC<KnowledgeBaseHeaderProps> = ({
  name,
  path,
  disabled = false,
  onSwitch,
  onOpenSettings,
  sortMode = "name",
  onSortChange,
  sortStatus,
}) => {
  const { t } = useI18n();
  const label = name || t("app_openKnowledgeBase");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isImeComposingEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="workspace-vault-row" ref={root}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="workspace-vault-switch"
        title={
          disabled
            ? t("sidebar_openKnowledgeBaseDisabledStandalone")
            : path || t("app_openKnowledgeBase")
        }
      >
        <Folder size={16} className="shrink-0" aria-hidden />
        <p className="text-sm font-semibold truncate min-w-0">{label}</p>
        <ChevronDown
          size={13}
          className="ml-auto shrink-0 opacity-60"
          aria-hidden
        />
      </button>
      {open && (
        <div
          className="workspace-vault-menu"
          role="menu"
          id={menuId}
          aria-label={label}
          onKeyDown={(event) => {
            const directions = ["ArrowDown", "ArrowUp", "Home", "End"];
            if (!directions.includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button[role^="menuitem"]',
              ),
            ];
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onSwitch();
            }}
          >
            <FolderOpen size={15} aria-hidden />
            {t("sidebar_switchKnowledgeBase")}
          </button>
          {onSortChange && (
            <>
              <div className="workspace-vault-menu-divider" role="separator" />
              <p className="workspace-vault-menu-heading">
                {t("sidebar_sortMode")}
              </p>
              {sortOptions.map(([mode, key]) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sortMode === mode}
                  onClick={() => {
                    onSortChange(mode);
                    close();
                  }}
                >
                  <span className="workspace-vault-menu-check">
                    {sortMode === mode && <Check size={14} aria-hidden />}
                  </span>
                  {t(key)}
                </button>
              ))}
              {sortStatus && (
                <p className="workspace-vault-menu-status" role="status">
                  {sortStatus}
                </p>
              )}
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onOpenSettings}
        className="workspace-settings-button"
        title={t("settings_openSettings")}
        aria-label={t("settings_openSettings")}
      >
        <Settings size={16} aria-hidden />
      </button>
    </div>
  );
};
