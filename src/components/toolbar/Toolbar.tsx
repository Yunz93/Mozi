import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getExportInFlight,
  subscribeExportInFlight,
} from "../../hooks/useExportActions";
import { ViewMode, type ThemeMode } from "../../types";
import { ViewModeToggle } from "../toolbar/ViewModeToggle";
import { AIButton } from "../toolbar/AIButton";
import { useI18n } from "../../hooks/useI18n";
import { isTauriEnvironment } from "../../types/filesystem";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ToolbarProps {
  fileName: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAIAnalyze: () => void;
  onAskVault?: () => void;
  isAskVaultOpen?: boolean;
  isAnalyzing: boolean;
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
    viewMode,
    onViewModeChange,
    onAIAnalyze,
    onAskVault,
    isAskVaultOpen = false,
    isAnalyzing,
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
    const isDark = themeMode === "dark";
    const displayFileName = fileName.replace(/\.md$/i, "");
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const exportMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!isExportMenuOpen) return;
      const handlePointerDown = (event: MouseEvent) => {
        if (!exportMenuRef.current?.contains(event.target as Node)) {
          setIsExportMenuOpen(false);
        }
      };
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setIsExportMenuOpen(false);
      };
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handlePointerDown);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [isExportMenuOpen]);

    const isExporting = useSyncExternalStore(
      subscribeExportInFlight,
      getExportInFlight,
      getExportInFlight,
    );
    const exportDisabled = isPreviewOnlyFile || !fileName || isExporting;
    const canShowExport = Boolean(onExportPdf || onExportHtml);

    return (
      <div
        className="ui-scaled sticky top-0 z-20 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-transparent bg-gray-50 dark:bg-black px-4 py-3 md:px-6 md:py-2"
        data-tauri-drag-region
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden md:gap-4"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            const isMac =
              typeof navigator !== "undefined" &&
              /Mac/.test(navigator.platform ?? "");
            if (!isMac || !isTauriEnvironment()) return;
            const target = event.target as HTMLElement | null;
            if (
              target?.closest(
                'button, input, textarea, select, a, [role=\"button\"]',
              )
            )
              return;
            void getCurrentWindow().startDragging();
          }}
        >
          <button
            type="button"
            onClick={onMenuClick}
            data-tauri-drag-region="false"
            className="inline-flex h-8 w-8 items-center justify-center -ml-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors"
            title={
              isSidebarOpen
                ? t("toolbar_hideSidebar")
                : t("toolbar_showSidebar")
            }
            aria-label={
              isSidebarOpen
                ? t("toolbar_hideSidebar")
                : t("toolbar_showSidebar")
            }
            aria-expanded={isSidebarOpen}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line
                x1={isSidebarOpen ? 9 : 6}
                y1="4"
                x2={isSidebarOpen ? 9 : 6}
                y2="20"
              />
            </svg>
          </button>

          <div className="flex flex-col min-w-0">
            {fileName ? (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className="font-semibold text-gray-900 dark:text-gray-100 truncate text-sm md:text-base"
                    title={displayFileName}
                  >
                    {displayFileName}
                  </span>
                  {isSaving && (
                    <span className="flex items-center gap-1 text-[10px] text-gray-400 font-medium animate-pulse">
                      <svg
                        className="w-2.5 h-2.5 animate-spin"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      {t("toolbar_saving")}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span className="text-gray-400 text-sm font-medium">
                {t("toolbar_noFileSelected")}
              </span>
            )}
          </div>
        </div>

        <div
          className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap"
          data-tauri-drag-region="false"
        >
          <button
            onClick={onToggleTheme}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200/70 dark:border-white/10 bg-white/85 dark:bg-white/[0.03] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            title={
              isDark ? t("toolbar_switchToLight") : t("toolbar_switchToDark")
            }
          >
            {isDark ? (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <div className="flex items-center gap-1.5 rounded-2xl border border-gray-200/70 dark:border-white/10 bg-gray-100/80 dark:bg-white/[0.05] px-2 py-1 shadow-sm shadow-black/5">
            <AIButton
              onClick={onAIAnalyze}
              isLoading={isAnalyzing}
              disabled={!fileName || isPreviewOnlyFile}
            />
            {onAskVault ? (
              <button
                type="button"
                onClick={onAskVault}
                disabled={isPreviewOnlyFile}
                aria-pressed={isAskVaultOpen}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${
                  isAskVaultOpen
                    ? "bg-sky-100 text-sky-700 dark:bg-sky-400/20 dark:text-sky-200"
                    : "bg-white/80 dark:bg-white/[0.06] text-sky-600 dark:text-sky-300 hover:bg-white dark:hover:bg-white/10"
                }`}
                title={t("askVault_title")}
                aria-label={t("askVault_title")}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M12 7.5v.01" />
                  <path d="M10.5 11a1.5 1.5 0 1 1 2.2 1.3c-.5.4-.7.7-.7 1.2" />
                </svg>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 rounded-2xl border border-gray-200/70 dark:border-white/10 bg-gray-100/80 dark:bg-white/[0.05] px-2 py-1 shadow-sm shadow-black/5">
            <ViewModeToggle
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              previewOnly={isPreviewOnlyFile}
            />
          </div>

          {(onPublish || canShowExport || onShareLongImage) && (
            <div className="flex items-center gap-1.5 rounded-2xl border border-gray-200/70 dark:border-white/10 bg-gray-100/80 dark:bg-white/[0.05] px-2 py-1 shadow-sm shadow-black/5">
              {onPublish && (
                <button
                  onClick={onPublish}
                  disabled={isPublishing || isPreviewOnlyFile || !fileName}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200/70 dark:border-white/10 bg-white/85 dark:bg-white/[0.03] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
                  title={
                    isPublishing
                      ? t("toolbar_publishing")
                      : t("toolbar_publish")
                  }
                >
                  {isPublishing ? (
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  )}
                </button>
              )}

              {canShowExport && (
                <div className="relative" ref={exportMenuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      if (exportDisabled) return;
                      setIsExportMenuOpen((open) => !open);
                    }}
                    disabled={exportDisabled}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200/70 dark:border-white/10 bg-white/85 dark:bg-white/[0.03] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
                    title={t("toolbar_export")}
                    aria-expanded={isExportMenuOpen}
                    aria-haspopup="menu"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                  {isExportMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-40 mt-1 min-w-[10.5rem] overflow-hidden rounded-xl border border-gray-200/80 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#121923]"
                    >
                      {onExportPdf && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={isExporting}
                          className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
                          onClick={() => {
                            setIsExportMenuOpen(false);
                            onExportPdf();
                          }}
                        >
                          {t("toolbar_exportPdf")}
                        </button>
                      )}
                      {onExportHtml && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={isExporting}
                          className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
                          onClick={() => {
                            setIsExportMenuOpen(false);
                            onExportHtml();
                          }}
                        >
                          {t("toolbar_exportHtml")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {onShareLongImage && (
                <button
                  type="button"
                  onClick={onShareLongImage}
                  disabled={!fileName || isPreviewOnlyFile}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200/70 dark:border-white/10 bg-white/85 dark:bg-white/[0.03] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
                  title={t("toolbar_shareLongImage")}
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);
