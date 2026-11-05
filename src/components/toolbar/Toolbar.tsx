import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Download,
  FileText,
  Focus,
  TextCursor,
  Image,
  Lightbulb,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import {
  getExportInFlight,
  subscribeExportInFlight,
} from "../../hooks/useExportActions";
import { ViewMode, type ThemeMode } from "../../types";
import { ViewModeToggle } from "./ViewModeToggle";
import { useI18n } from "../../hooks/useI18n";
import { isTauriEnvironment } from "../../types/filesystem";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AiEnhanceStage } from "../../hooks/useAIAnalyze";
import { useAppStore } from "../../store/appStore";
import { getActiveEditorView } from "../../utils/editorSelectionBridge";

interface ToolbarProps {
  fileName: string;
  folderName?: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAIAnalyze: () => void;
  onAskVault?: () => void;
  isAskVaultOpen?: boolean;
  isAnalyzing: boolean;
  aiEnhanceStage?: AiEnhanceStage | null;
  isSaving: boolean;
  isPublishing?: boolean;
  isSidebarOpen: boolean;
  onMenuClick: () => void;
  onToggleTheme: () => void;
  themeMode: ThemeMode;
  onPublish?: () => void;
  onExportPdf?: () => void;
  onExportHtml?: () => void;
  onShareLongImage?: () => void;
  isPreviewOnlyFile?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = React.memo(
  ({
    fileName,
    folderName,
    viewMode,
    onViewModeChange,
    onAIAnalyze,
    onAskVault,
    isAskVaultOpen = false,
    isAnalyzing,
    aiEnhanceStage = null,
    isSaving,
    isPublishing = false,
    isSidebarOpen,
    onMenuClick,
    onToggleTheme,
    themeMode,
    onPublish,
    onExportPdf,
    onExportHtml,
    onShareLongImage,
    isPreviewOnlyFile = false,
  }) => {
    const { t } = useI18n();
    const focusMode = useAppStore((state) => state.settings.focusMode);
    const typewriterMode = useAppStore(
      (state) => state.settings.typewriterMode,
    );
    const updateSettings = useAppStore((state) => state.updateSettings);
    const toggleWritingMode = (mode: "focusMode" | "typewriterMode") => {
      updateSettings({ [mode]: !useAppStore.getState().settings[mode] });
      getActiveEditorView()?.focus();
    };
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuTriggerRef = useRef<HTMLButtonElement>(null);
    const isExporting = useSyncExternalStore(
      subscribeExportInFlight,
      getExportInFlight,
      getExportInFlight,
    );
    const documentDisabled = isPreviewOnlyFile || !fileName;
    const exportDisabled = documentDisabled || isExporting;
    const displayFileName = fileName.replace(/\.md$/i, "");

    useEffect(() => {
      if (!isMenuOpen) return;
      const getMenuItems = () =>
        Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)',
          ) ?? [],
        );
      getMenuItems()[0]?.focus();
      const handlePointerDown = (event: MouseEvent) => {
        if (!menuRef.current?.contains(event.target as Node))
          setIsMenuOpen(false);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setIsMenuOpen(false);
          menuTriggerRef.current?.focus();
        } else if (event.key === "Tab") {
          menuTriggerRef.current?.focus();
          setIsMenuOpen(false);
        } else if (
          [
            "ArrowDown",
            "ArrowUp",
            "ArrowRight",
            "ArrowLeft",
            "Home",
            "End",
          ].includes(event.key) &&
          menuRef.current?.contains(event.target as Node)
        ) {
          const items = getMenuItems();
          if (!items.length) return;
          event.preventDefault();
          const currentIndex = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const nextIndex =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (currentIndex +
                    (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) +
                    items.length) %
                  items.length;
          items[nextIndex].focus();
        }
      };
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handlePointerDown);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [isMenuOpen]);

    const runMenuAction = (action: () => void) => {
      setIsMenuOpen(false);
      action();
    };

    return (
      <div className="app-toolbar ui-scaled" data-tauri-drag-region>
        <div
          className="app-toolbar-document"
          onMouseDown={(event) => {
            if (
              event.button !== 0 ||
              !/Mac/.test(navigator.platform ?? "") ||
              !isTauriEnvironment()
            )
              return;
            const target = event.target as HTMLElement;
            if (
              target.closest(
                'button, input, textarea, select, a, [role="button"]',
              )
            )
              return;
            void getCurrentWindow().startDragging();
          }}
        >
          <button
            type="button"
            onClick={onMenuClick}
            className="app-toolbar-icon"
            data-tauri-drag-region="false"
            title={t(
              isSidebarOpen ? "toolbar_hideSidebar" : "toolbar_showSidebar",
            )}
            aria-label={t(
              isSidebarOpen ? "toolbar_hideSidebar" : "toolbar_showSidebar",
            )}
            aria-expanded={isSidebarOpen}
          >
            <PanelLeft size={14} aria-hidden />
          </button>
          {folderName && fileName && (
            <span className="app-toolbar-folder" title={folderName}>
              <span className="app-toolbar-folder-name">{folderName}</span>
              <span className="app-toolbar-folder-divider" aria-hidden>
                /
              </span>
            </span>
          )}
          <span className="app-toolbar-title" title={displayFileName}>
            {displayFileName || t("toolbar_noFileSelected")}
          </span>
          {isSaving && (
            <span className="app-toolbar-saving" role="status">
              <LoaderCircle size={12} className="animate-spin" aria-hidden />
              {t("toolbar_saving")}
            </span>
          )}
        </div>
        <div className="app-toolbar-actions" data-tauri-drag-region="false">
          <button
            type="button"
            onClick={onToggleTheme}
            className="app-toolbar-icon"
            title={t(
              themeMode === "dark"
                ? "toolbar_switchToLight"
                : "toolbar_switchToDark",
            )}
            aria-label={t(
              themeMode === "dark"
                ? "toolbar_switchToLight"
                : "toolbar_switchToDark",
            )}
          >
            {themeMode === "dark" ? (
              <Sun size={14} aria-hidden />
            ) : (
              <Moon size={14} aria-hidden />
            )}
          </button>
          {onAskVault && (
            <button
              type="button"
              onClick={onAskVault}
              disabled={isPreviewOnlyFile}
              aria-label={t("askVault_title")}
              aria-pressed={isAskVaultOpen}
              title={t("askVault_title")}
              className={`app-toolbar-assistant ${isAskVaultOpen ? "is-active" : ""}`}
            >
              <Lightbulb size={14} aria-hidden />
            </button>
          )}
          <div className="app-toolbar-ai">
            <button
              type="button"
              className="app-toolbar-icon"
              title={t(isAnalyzing ? "ai_buttonLoading" : "ai_button")}
              aria-label={t(isAnalyzing ? "ai_buttonLoading" : "ai_button")}
              aria-busy={isAnalyzing}
              aria-describedby={
                isAnalyzing && aiEnhanceStage
                  ? "ai-enhance-progress"
                  : undefined
              }
              disabled={documentDisabled || isAnalyzing}
              onClick={onAIAnalyze}
            >
              {isAnalyzing ? (
                <LoaderCircle size={14} className="animate-spin" aria-hidden />
              ) : (
                <Sparkles size={14} aria-hidden />
              )}
            </button>
            {isAnalyzing && aiEnhanceStage && (
              <div
                id="ai-enhance-progress"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="app-toolbar-ai-progress"
              >
                <strong>{t("ai_buttonLoading")}</strong>
                <span>
                  {t(
                    aiEnhanceStage === "preparing"
                      ? "ai_progressPreparing"
                      : aiEnhanceStage === "analyzing"
                        ? "ai_progressAnalyzing"
                        : "ai_progressReviewing",
                  )}
                </span>
                <small>{t("ai_progressHint")}</small>
              </div>
            )}
          </div>
          <ViewModeToggle
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            previewOnly={isPreviewOnlyFile}
          />
          {onPublish && (
            <button
              type="button"
              onClick={onPublish}
              disabled={isPublishing || documentDisabled}
              className="app-toolbar-publish"
              title={t(isPublishing ? "toolbar_publishing" : "toolbar_publish")}
              aria-label={t(
                isPublishing ? "toolbar_publishing" : "toolbar_publish",
              )}
            >
              {isPublishing ? (
                <LoaderCircle size={14} className="animate-spin" aria-hidden />
              ) : (
                <Upload size={14} aria-hidden />
              )}
            </button>
          )}
          <div className="app-toolbar-menu-anchor" ref={menuRef}>
            <button
              ref={menuTriggerRef}
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              className="app-toolbar-icon"
              title={t("toolbar_more")}
              aria-label={t("toolbar_more")}
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={14} aria-hidden />
            </button>
            {isMenuOpen && (
              <div
                role="menu"
                aria-orientation="horizontal"
                aria-label={t("toolbar_more")}
                className="app-toolbar-menu"
              >
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={focusMode === true}
                  title={t("settings_focusMode")}
                  aria-label={t("settings_focusMode")}
                  disabled={documentDisabled || viewMode !== ViewMode.LIVE}
                  onClick={() =>
                    runMenuAction(() => toggleWritingMode("focusMode"))
                  }
                >
                  <Focus size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={typewriterMode === true}
                  title={t("settings_typewriterMode")}
                  aria-label={t("settings_typewriterMode")}
                  disabled={documentDisabled || viewMode !== ViewMode.LIVE}
                  onClick={() =>
                    runMenuAction(() => toggleWritingMode("typewriterMode"))
                  }
                >
                  <TextCursor size={14} aria-hidden />
                </button>
                {onExportPdf && (
                  <button
                    type="button"
                    role="menuitem"
                    title={t("toolbar_exportPdf")}
                    aria-label={t("toolbar_exportPdf")}
                    disabled={exportDisabled}
                    onClick={() => runMenuAction(onExportPdf)}
                  >
                    <Download size={14} aria-hidden />
                  </button>
                )}
                {onExportHtml && (
                  <button
                    type="button"
                    role="menuitem"
                    title={t("toolbar_exportHtml")}
                    aria-label={t("toolbar_exportHtml")}
                    disabled={exportDisabled}
                    onClick={() => runMenuAction(onExportHtml)}
                  >
                    <FileText size={14} aria-hidden />
                  </button>
                )}
                {onShareLongImage && (
                  <button
                    type="button"
                    role="menuitem"
                    title={t("toolbar_shareLongImage")}
                    aria-label={t("toolbar_shareLongImage")}
                    disabled={documentDisabled}
                    onClick={() => runMenuAction(onShareLongImage)}
                  >
                    <Image size={14} aria-hidden />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);
