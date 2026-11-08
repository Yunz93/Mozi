import React, {
  Suspense,
  lazy,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useAppStore, selectContent } from "../../store/appStore";
import { ViewMode } from "../../types";
import {
  normalizeSessionViewMode,
  isEditorVisibleMode,
  isPreviewVisibleMode,
} from "../../utils/viewMode";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";
import { PreviewPane, type PreviewPaneHandle } from "./PreviewPane";
import { WritingStatsDisplay } from "../stats/WritingStatsDisplay";

// Keep Excalidraw out of the boot graph. A static import here previously
// caused Vite to modulepreload the excalidraw vendor chunk, which then
// crashed on init (TDZ) and whitescreened the entire app.
const ExcalidrawPane = lazy(async () => {
  const mod = await import("./ExcalidrawPane");
  return { default: mod.ExcalidrawPane };
});
import type { PaneDensity } from "./paneLayout";
import { useI18n } from "../../hooks/useI18n";
import type { ShikiHighlighter } from "../../hooks/useShikiHighlighter";
import { getMarkdownStyleCssVariables } from "../../utils/markdownStyle";
import type { CodeMirrorContentChangeMeta } from "./hooks/useCodeMirror";
import { ErrorBoundary } from "../ErrorBoundary";
import { isHeadingNavigationLocked } from "../../utils/previewNavigationBridge";
import { findFileInTree } from "../../utils/fileTree";
import { isExcalidrawWorkspaceFile } from "../../utils/fileTypes";

const PANE_TRANSITION_MS = 200;

interface DocumentWorkspaceProps {
  highlighter?: ShikiHighlighter | null;
  onContentChange?: (
    content: string,
    meta?: CodeMirrorContentChangeMeta,
  ) => void;
  onGenerateWikiFromSelection?: (selection: {
    text: string;
    from: number;
    to: number;
  }) => Promise<string | null>;
  isOutlineOpen: boolean;
  canShowOutlineToggle: boolean;
  contentDensity: PaneDensity;
  onToggleOutline: () => void;
}

export const DocumentWorkspace: React.FC<DocumentWorkspaceProps> = ({
  highlighter,
  onContentChange,
  onGenerateWikiFromSelection,
  isOutlineOpen,
  canShowOutlineToggle,
  contentDensity,
  onToggleOutline,
}) => {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const viewMode = useAppStore((state) => state.viewMode);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const files = useAppStore((state) => state.files);
  const content = useAppStore(selectContent);
  const activeFile = activeTabId
    ? findFileInTree(files, activeTabId)
    : undefined;
  const isExcalidrawActive = Boolean(
    activeFile && isExcalidrawWorkspaceFile(activeFile.name, content),
  );
  const editorPaneRef = useRef<EditorPaneHandle | null>(null);
  const previewPaneRef = useRef<PreviewPaneHandle | null>(null);
  const previousViewModeRef = useRef(viewMode);
  const visualMode = normalizeSessionViewMode(viewMode);
  const editorScrollPercentageRef = useRef(0);
  const previewScrollPercentageRef = useRef(0);
  const transitionResyncTimerRef = useRef<number | null>(null);
  const transitionCleanupRef = useRef<(() => void) | null>(null);
  const scrollPositionsRef = useRef<
    Record<
      string,
      {
        editor: number;
        preview: number;
        lastViewMode: ViewMode;
      }
    >
  >({});

  const handleEditorScroll = useCallback((percentage: number) => {
    editorScrollPercentageRef.current = percentage;
    if (isHeadingNavigationLocked()) return;
    if (isEditorVisibleMode(useAppStore.getState().viewMode)) {
      previewScrollPercentageRef.current = percentage;
    }
  }, []);

  const handlePreviewScroll = useCallback((percentage: number) => {
    previewScrollPercentageRef.current = percentage;
    if (isHeadingNavigationLocked()) return;
    if (isPreviewVisibleMode(useAppStore.getState().viewMode)) {
      editorScrollPercentageRef.current = percentage;
    }
  }, []);

  const cleanupTransition = useCallback(() => {
    if (transitionCleanupRef.current) {
      transitionCleanupRef.current();
      transitionCleanupRef.current = null;
    }
    if (transitionResyncTimerRef.current !== null) {
      window.clearTimeout(transitionResyncTimerRef.current);
      transitionResyncTimerRef.current = null;
    }
  }, []);

  const syncVisiblePanesToAnchor = useCallback(
    (anchorPercentage: number) => {
      cleanupTransition();

      if (isEditorVisibleMode(viewMode)) {
        editorPaneRef.current?.syncScrollTo(anchorPercentage, {
          immediate: true,
        });
      }

      if (isPreviewVisibleMode(viewMode)) {
        previewPaneRef.current?.syncScrollTo(anchorPercentage, {
          immediate: true,
        });
      }

      const resyncAfterTransition = () => {
        transitionCleanupRef.current = null;
        // 新的标题定位优先，旧视图的延迟恢复不能把正文拉回原位置。
        if (isHeadingNavigationLocked()) return;
        // 用户在过渡期间滚动后，新的阅读位置优先于旧模式留下的校正任务。
        if (
          (isEditorVisibleMode(viewMode) &&
            Math.abs(editorScrollPercentageRef.current - anchorPercentage) >
              0.001) ||
          (isPreviewVisibleMode(viewMode) &&
            Math.abs(previewScrollPercentageRef.current - anchorPercentage) >
              0.001)
        )
          return;
        if (isEditorVisibleMode(viewMode)) {
          editorPaneRef.current?.syncScrollTo(anchorPercentage, {
            immediate: true,
          });
        }
        if (isPreviewVisibleMode(viewMode)) {
          previewPaneRef.current?.syncScrollTo(anchorPercentage, {
            immediate: true,
          });
        }
      };

      transitionResyncTimerRef.current = window.setTimeout(() => {
        transitionResyncTimerRef.current = null;
        cleanupTransition();
        resyncAfterTransition();
      }, PANE_TRANSITION_MS + 50);
    },
    [viewMode, cleanupTransition],
  );

  const saveActiveTabScrollState = useCallback(
    (tabId: string | null) => {
      if (!tabId) return;
      scrollPositionsRef.current[tabId] = {
        editor: editorScrollPercentageRef.current,
        preview: previewScrollPercentageRef.current,
        lastViewMode: viewMode,
      };
    },
    [viewMode],
  );

  useEffect(() => {
    return () => {
      cleanupTransition();
      if (transitionResyncTimerRef.current !== null) {
        window.clearTimeout(transitionResyncTimerRef.current);
      }
      saveActiveTabScrollState(activeTabId);
    };
  }, [activeTabId, saveActiveTabScrollState, cleanupTransition]);

  useEffect(() => {
    if (!activeTabId) return;

    const savedState = scrollPositionsRef.current[activeTabId] ?? {
      editor: 0,
      preview: 0,
      lastViewMode: ViewMode.LIVE,
    };
    const anchorPercentage =
      savedState.lastViewMode === ViewMode.PREVIEW
        ? savedState.preview
        : savedState.editor;

    editorScrollPercentageRef.current = anchorPercentage;
    previewScrollPercentageRef.current = anchorPercentage;

    const frameId = window.requestAnimationFrame(() => {
      syncVisiblePanesToAnchor(anchorPercentage);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTabId, syncVisiblePanesToAnchor]);

  // Handle view mode changes — keep the user where they were reading.
  // Leaving preview-only mode anchors on the preview position; otherwise the editor position.
  useEffect(() => {
    const previousViewMode = previousViewModeRef.current;
    previousViewModeRef.current = viewMode;

    if (previousViewMode === viewMode) return;

    const anchorPercentage =
      previousViewMode === ViewMode.PREVIEW
        ? previewScrollPercentageRef.current
        : editorScrollPercentageRef.current;

    editorScrollPercentageRef.current = anchorPercentage;
    previewScrollPercentageRef.current = anchorPercentage;
    syncVisiblePanesToAnchor(anchorPercentage);
  }, [syncVisiblePanesToAnchor, viewMode]);

  const editorActive = visualMode === ViewMode.LIVE;
  const previewActive = visualMode === ViewMode.PREVIEW;
  const previewRenderActive = isPreviewVisibleMode(viewMode) || previewActive;
  const activePaneKey = activeTabId ?? "no-active-tab";
  const markdownStyleVariables = useMemo(
    () =>
      getMarkdownStyleCssVariables(
        settings.markdownStylePreset,
        settings.themeMode,
      ),
    [settings.markdownStylePreset, settings.themeMode],
  );

  // Keep both surfaces mounted at stable full width to preserve editor state.
  const paneStyle = (active: boolean): React.CSSProperties => ({
    width: "100%",
    position: "absolute",
    inset: 0,
    visibility: active ? "visible" : "hidden",
    opacity: active ? 1 : 0,
    pointerEvents: active ? "auto" : "none",
    transition: "opacity 120ms ease",
    willChange: "opacity",
  });

  if (isExcalidrawActive) {
    return (
      <ErrorBoundary>
        <div className="workspace-surface flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                  {t("excalidraw_loading")}
                </div>
              }
            >
              <ExcalidrawPane
                onContentChange={(next) => onContentChange?.(next)}
              />
            </Suspense>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div
        className="workspace-surface flex-1 min-h-0 min-w-0 flex flex-col"
        data-markdown-style={settings.markdownStylePreset}
        style={markdownStyleVariables as React.CSSProperties}
      >
        <div className="flex-1 overflow-hidden relative flex flex-row">
          <div
            aria-hidden={!editorActive}
            className="h-full min-w-0 overflow-hidden flex flex-col relative"
            style={paneStyle(editorActive)}
          >
            <EditorPane
              ref={editorPaneRef}
              highlighter={highlighter}
              density={contentDensity}
              onContentChange={onContentChange}
              onScroll={handleEditorScroll}
              onGenerateWikiFromSelection={onGenerateWikiFromSelection}
            />
          </div>

          <div
            aria-hidden={!previewActive}
            className="h-full min-w-0 overflow-hidden"
            style={paneStyle(previewActive)}
          >
            <PreviewPane
              key={`preview-${activePaneKey}`}
              ref={previewPaneRef}
              highlighter={highlighter}
              density={contentDensity}
              onScroll={handlePreviewScroll}
              previewLayoutActive={previewActive}
              previewRenderActive={previewRenderActive}
            />
          </div>
        </div>

        {activeTabId && (
          <div className="workspace-document-footer shrink-0 border-t">
            <div className="mx-auto flex w-full max-w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 md:px-5">
              <WritingStatsDisplay
                className="min-w-0 flex-1 border-t-0 px-0 py-0"
                showBorder={false}
              />
              {canShowOutlineToggle && (
                <div className="ml-auto shrink-0">
                  <button
                    onClick={onToggleOutline}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-200/50 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-white/20 transition-colors"
                    title={t("split_toggleOutline")}
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="8" y1="6" x2="21" y2="6" />
                      <line x1="8" y1="12" x2="21" y2="12" />
                      <line x1="8" y1="18" x2="21" y2="18" />
                      <circle cx="4" cy="6" r="2" fill="currentColor" />
                      <circle cx="4" cy="12" r="2" fill="currentColor" />
                      <circle cx="4" cy="18" r="2" fill="currentColor" />
                    </svg>
                    <span className="hidden sm:inline">
                      {isOutlineOpen
                        ? t("split_hideOutline")
                        : t("split_showOutline")}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};
