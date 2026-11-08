import React, { useCallback, useEffect, useRef, useState } from "react";
import { isImeComposingEvent } from "../../utils/imeKeyboard";
import type { AppSettings } from "../../types";
import { useI18n } from "../../hooks/useI18n";
import type { TranslationKey } from "../../utils/i18n";
import { useAppStore } from "../../store/appStore";
import { InterfaceTab } from "./tabs/InterfaceTab";
import { EditorTab } from "./tabs/EditorTab";
import { AITab } from "./tabs/AITab";
import { MetadataTab } from "./tabs/MetadataTab";
import { ShortcutsTab } from "./tabs/ShortcutsTab";
import { PublishingTab } from "./tabs/PublishingTab";
import { ReadingNotesTab } from "./tabs/ReadingNotesTab";
import { ImageHostingTab } from "./tabs/ImageHostingTab";
import { UpdatesTab } from "./tabs/UpdatesTab";
import { IndexTab } from "./tabs/IndexTab";
import { TasksTab } from "./tabs/TasksTab";
import { useSettingsModalLayout } from "./useSettingsModalLayout";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
  uiScaleStyle?: React.CSSProperties;
}

type SettingsTab =
  | "general"
  | "editor"
  | "metadata"
  | "shortcuts"
  | "ai"
  | "index"
  | "tasks"
  | "interface"
  | "imageHosting"
  | "readingNotes"
  | "about";

interface TabConfig {
  id: SettingsTab;
  label: string;
}

function getTabs(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): TabConfig[] {
  return [
    { id: "interface", label: t("settings_tab_interface") },
    { id: "editor", label: t("settings_tab_editor") },
    { id: "tasks", label: t("tasks_title") },
    { id: "ai", label: t("settings_tab_ai") },
    { id: "index", label: t("settings_tab_index") },
    { id: "metadata", label: t("settings_tab_metadata") },
    { id: "shortcuts", label: t("settings_tab_shortcuts") },
    { id: "imageHosting", label: t("settings_tab_imageHosting") },
    { id: "general", label: t("settings_tab_publishing") },
    { id: "readingNotes", label: t("settings_tab_readingNotes") },
    { id: "about", label: t("settings_tab_about") },
  ];
}

function beginPointerDrag(
  event: React.MouseEvent,
  cursor: string,
  onMove: (deltaX: number, deltaY: number) => void,
) {
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;

  const handlePointerMove = (moveEvent: MouseEvent) => {
    onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
  };

  const handlePointerUp = () => {
    document.removeEventListener("mousemove", handlePointerMove);
    document.removeEventListener("mouseup", handlePointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", handlePointerMove);
  document.addEventListener("mouseup", handlePointerUp);
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  uiScaleStyle,
}) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const settingsFocusTab = useAppStore((s) => s.settingsFocusTab);
  const clearSettingsFocusTab = useAppStore((s) => s.clearSettingsFocusTab);
  const [activeTab, setActiveTab] = useState<SettingsTab>("editor");
  const tabs = getTabs(t);
  const {
    width,
    height,
    navWidth,
    metadataKeyWidth,
    metadataValueWidth,
    updateSize,
    updateNavWidth,
    updateMetadataKeyWidth,
    updateMetadataValueWidth,
  } = useSettingsModalLayout();

  useEffect(() => {
    if (!isOpen) return;
    if (
      settingsFocusTab === "ai" ||
      settingsFocusTab === "index" ||
      settingsFocusTab === "editor" ||
      settingsFocusTab === "tasks" ||
      settingsFocusTab === "readingNotes"
    ) {
      setActiveTab(settingsFocusTab);
      clearSettingsFocusTab();
    }
  }, [isOpen, settingsFocusTab, clearSettingsFocusTab]);

  useEffect(() => {
    if (!isOpen) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const focusRoots = () => {
      const dialog = dialogRef.current;
      if (!dialog) return [];
      // 下拉选项通过 Portal 挂到 body，用控件关联的菜单 ID 确认归属。
      const menuIds = new Set(
        Array.from(
          dialog.querySelectorAll<HTMLElement>(
            '[aria-haspopup="listbox"][aria-controls]',
          ),
        )
          .filter((trigger) => trigger.closest('[role="dialog"]') === dialog)
          .map((trigger) => trigger.getAttribute("aria-controls")),
      );
      const menus = Array.from(
        document.querySelectorAll<HTMLElement>(".app-select-menu"),
      ).filter((menu) => menuIds.has(menu.id));
      return [dialog, ...menus];
    };
    const containsFocus = (element: Node | null) =>
      focusRoots().some((root) => root.contains(element));
    const focusable = () =>
      focusRoots()
        .flatMap((root) =>
          Array.from(
            root.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
            ),
          ),
        )
        .filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() =>
      (focusable()[0] ?? dialogRef.current)?.focus({ preventScroll: true }),
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isImeComposingEvent(event)) return;
      if (event.key === "Tab") {
        // 仅处理当前设置窗口及其菜单，其他弹窗保留自己的键盘行为。
        const target = event.target as HTMLElement;
        if (
          !containsFocus(target) &&
          target.closest?.('.app-select-menu, [role="dialog"]')
        )
          return;
        const controls = focusable();
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (
          !first ||
          !containsFocus(document.activeElement) ||
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      const activeDialog = (event.target as HTMLElement).closest?.(
        '[role="dialog"]',
      );
      if (activeDialog && activeDialog !== dialogRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const handleModalResizeStart = useCallback(
    (event: React.MouseEvent) => {
      const startWidth = width;
      const startHeight = height;
      beginPointerDrag(event, "nwse-resize", (deltaX, deltaY) => {
        updateSize(startWidth + deltaX, startHeight + deltaY);
      });
    },
    [height, updateSize, width],
  );

  const handleNavResizeStart = useCallback(
    (event: React.MouseEvent) => {
      const startWidth = navWidth;
      beginPointerDrag(event, "col-resize", (deltaX) => {
        updateNavWidth(startWidth + deltaX);
      });
    },
    [navWidth, updateNavWidth],
  );

  if (!isOpen) return null;

  const renderActiveTab = () => {
    switch (activeTab) {
      case "interface":
        return (
          <InterfaceTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            isOpen={isOpen}
          />
        );
      case "editor":
        return (
          <EditorTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            isOpen={isOpen}
          />
        );
      case "ai":
        return (
          <AITab settings={settings} onUpdateSettings={onUpdateSettings} />
        );
      case "index":
        return (
          <IndexTab settings={settings} onUpdateSettings={onUpdateSettings} />
        );
      case "tasks":
        return <TasksTab settings={settings} />;
      case "metadata":
        return (
          <MetadataTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            keyColumnWidth={metadataKeyWidth}
            valueColumnWidth={metadataValueWidth}
            onKeyColumnWidthChange={updateMetadataKeyWidth}
            onValueColumnWidthChange={updateMetadataValueWidth}
          />
        );
      case "shortcuts":
        return (
          <ShortcutsTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
        );
      case "imageHosting":
        return (
          <ImageHostingTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
        );
      case "general":
        return (
          <PublishingTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
        );
      case "readingNotes":
        return (
          <ReadingNotesTab
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
        );
      case "about":
        return (
          <UpdatesTab settings={settings} onUpdateSettings={onUpdateSettings} />
        );
    }
  };

  return (
    <div
      className="ui-scaled fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-fade-in-02s"
      style={uiScaleStyle}
    >
      <div
        className="workspace-dialog workspace-settings relative flex overflow-hidden rounded-2xl border shadow-2xl animate-scale-in"
        style={{
          width,
          height,
          maxWidth: "calc(100vw - 2rem)",
          maxHeight: "calc(100vh - 2rem)",
        }}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings_title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="workspace-settings-nav relative flex min-h-0 shrink-0 flex-col border-r p-3"
          style={{ width: navWidth }}
        >
          <div className="mb-2 shrink-0 px-3 py-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {t("settings_title")}
            </h2>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5 scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`workspace-settings-nav-button px-3 py-2.5 text-left text-sm font-medium ${activeTab === tab.id ? "is-active" : ""}`}
                aria-current={activeTab === tab.id ? "page" : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("settings_resizeNav")}
            title={t("settings_resizeNav")}
            className="absolute inset-y-0 right-0 z-10 hidden w-1 cursor-col-resize md:block"
            onMouseDown={handleNavResizeStart}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col bg-transparent">
          <div className="settings-panel flex-1 overflow-y-auto p-8 scrollbar-hide">
            {renderActiveTab()}
          </div>

          <div className="workspace-settings-footer flex justify-end border-t p-4">
            <button
              onClick={onClose}
              className="workspace-settings-done inline-flex items-center gap-1.5 px-5 text-sm font-medium"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("common_done")}
            </button>
          </div>
        </div>

        <button
          type="button"
          aria-label={t("settings_resizeModal")}
          title={t("settings_resizeModal")}
          className="absolute bottom-1.5 right-1.5 z-20 hidden h-4 w-4 cursor-nwse-resize rounded-sm border border-gray-300/80 bg-white/90 shadow-sm md:block dark:border-white/20 dark:bg-gray-800/90"
          onMouseDown={handleModalResizeStart}
        >
          <span className="pointer-events-none absolute inset-[3px] border-b border-r border-gray-400/80 dark:border-gray-300/50" />
        </button>
      </div>
    </div>
  );
};
