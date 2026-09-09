import React, { useCallback, useEffect, useState } from "react";
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
      settingsFocusTab === "readingNotes"
    ) {
      setActiveTab(settingsFocusTab);
      clearSettingsFocusTab();
    }
  }, [isOpen, settingsFocusTab, clearSettingsFocusTab]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose]);

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
        className="relative flex overflow-hidden rounded-2xl border border-gray-200/50 bg-white/95 shadow-2xl backdrop-blur-xl transition-shadow animate-scale-in dark:border-white/10 dark:bg-gray-900/95"
        style={{
          width,
          height,
          maxWidth: "calc(100vw - 2rem)",
          maxHeight: "calc(100vh - 2rem)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings_title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative flex min-h-0 shrink-0 flex-col border-r border-gray-200/50 bg-gray-50/50 p-3 dark:border-white/5 dark:bg-black/20"
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
                className={`rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white"
                    : "text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5"
                }`}
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

          <div className="flex justify-end border-t border-gray-200/50 p-4 dark:border-white/10">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-xl bg-black px-6 py-2 text-sm font-medium text-white shadow-sm transition-all hover:opacity-90 active:scale-95 dark:bg-white dark:text-black"
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
