import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useAppStore, selectContent, defaultSettings } from "./store/appStore";
import { useFileSystem } from "./hooks/useFileSystem";
import { useViewMode } from "./hooks/useViewMode";
import { useSettings } from "./hooks/useSettings";
import { useGlobalKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUiFontSizeKeyboardShortcuts } from "./hooks/useUiFontSizeKeyboardShortcuts";
import { getScaledEditorFontSize } from "./utils/uiFontSize";
import { UiZoomHint } from "./components/ui/UiZoomHint";
import { useAutoSave } from "./hooks/useAutoSave";
import { useOutline } from "./hooks/useOutline";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useStoreHydration } from "./hooks/useStoreHydration";
import { resolvePreviewOnlyViewModeTransition } from "./utils/viewModeSession";
import { useShikiHighlighter } from "./hooks/useShikiHighlighter";
import { useThemeSync } from "./hooks/useThemeSync";
import { useSystemThemeFollow } from "./hooks/useSystemThemeFollow";
import { useAIAnalyze } from "./hooks/useAIAnalyze";
import { useFileOperations } from "./hooks/useFileOperations";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Toolbar } from "./components/toolbar/Toolbar";
import { SplitView } from "./components/editor/SplitView";
import type { CodeMirrorContentChangeMeta } from "./components/editor/hooks/useCodeMirror";
import { RightRail } from "./components/rightRail/RightRail";
import { AskVaultPanel } from "./components/ai/AskVaultPanel";
import { ContentSearch } from "./components/search/ContentSearch";
import { useExportActions } from "./hooks/useExportActions";
import { usePublishActions } from "./hooks/usePublishActions";
import { ViewMode } from "./types";
import { requestEditorRangeFocus } from "./utils/editorSelectionBridge";
import {
  beginHeadingNavigationLock,
  requestPreviewHeadingScroll,
} from "./utils/previewNavigationBridge";
import { getResolvedUiFontFamily } from "./utils/fontSettings";
import { logEnvironment, assertDevReleaseParity } from "./utils/environment";
import { useI18n } from "./hooks/useI18n";
import { getPathBasename, findFileInTree } from "./app/appShellUtils";
import { isExcalidrawFile, isPreviewOnlyFile } from "./utils/fileTypes";
import { getResolvedEditorFontFamily } from "./utils/fontSettings";
import { useAppBootstrap } from "./app/useAppBootstrap";
import { useActiveFileWatch } from "./app/useActiveFileWatch";
import { useKnowledgeBaseWatch } from "./app/useKnowledgeBaseWatch";
import { useVaultIndexLifecycle } from "./hooks/useVaultIndexLifecycle";
import { useAppUpdater } from "./app/useAppUpdater";
import { useWorkspaceLayout } from "./app/useWorkspaceLayout";
import { useAttachmentCleanup } from "./app/useAttachmentCleanup";
import { useExternalFileOpen } from "./app/useExternalFileOpen";
import { getStartupKnowledgeBaseGate } from "./app/startupKnowledgeBaseGate";
import {
  extractWechatDraftDefaults,
  type WechatDraftPublishInput,
} from "./utils/wechatPublish";
import {
  extractSimpleBlogPublishDefaults,
  type SimpleBlogPublishInput,
} from "./utils/simpleBlogPublish";
import { hydrateSensitiveSettingsIntoStore } from "./services/secureSettingsService";
import { isValidBlogRepoUrl, isValidBlogSiteUrl } from "./utils/blogRepo";
import { isTauriEnvironment, getFileSystem } from "./types/filesystem";
import { joinFsPath } from "./utils/pathHelpers";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { KnowledgeBaseOnboarding } from "./components/KnowledgeBaseOnboarding";
import { KnowledgeBaseLoadingScreen } from "./components/KnowledgeBaseLoadingScreen";
import { AppDialogs } from "./components/AppDialogs";
import {
  getCurrentAppWindowLabel,
  isPrimaryAppWindow,
  openNewAppWindow,
  openPathInNewAppWindow,
} from "./utils/appWindow";
import { isStandaloneDocumentSession } from "./utils/standaloneDocumentSession";
import { shouldRestoreVaultOnBoot } from "./utils/bootOpenFile";

// Layout constants moved to src/config/layout.ts
// Using centralized configuration for better maintainability

// Log environment info on app initialization for debugging
if (typeof window !== "undefined" && import.meta.env.DEV) {
  logEnvironment();
  assertDevReleaseParity();
}

const App: React.FC = () => {
  const { t } = useI18n();
  const {
    files,
    openTabs,
    rootFolderPath,
    activeTabId,
    currentFilePath,
    viewMode,
    viewModeBeforePreviewOnly,
    isSidebarOpen,
    isSettingsOpen,
    isSaving,
    isAnalyzing,
    isPublishing,
    settings,
    fileContents,
    activeHeadingId,
    closeTab,
    setContent,
    setContentForFile,
    setCurrentFilePath,
    setSidebarOpen,
    setSettingsOpen,
    setActiveHeadingId,
    showNotification,
    updateSettings,
  } = useAppStore();

  const content = useAppStore(selectContent);

  const {
    openDirectory,
    openKnowledgeBase,
    openFilePath,
    readFile,
    moveToTrash,
    refreshFileTree,
    watchFile,
    watchDirectory,
  } = useFileSystem();
  const { setViewMode } = useViewMode();
  const setViewModeBeforePreviewOnly = useAppStore(
    (state) => state.setViewModeBeforePreviewOnly,
  );
  const { toggleTheme } = useSettings();
  const settingsHydrated = useStoreHydration();
  const { highlighter } = useShikiHighlighter(content);
  const { handleAIAnalyze, handleGenerateWikiFromSelection } = useAIAnalyze();
  const fileOps = useFileOperations();

  const { headings: outlineHeadings } = useOutline();
  useUndoRedo();

  useSystemThemeFollow();
  useThemeSync(settings.themeMode, settings.themeFollowSystem);
  useLayoutEffect(() => {
    const scaledFontSize = getScaledEditorFontSize(
      settings.fontSize,
      settings.uiFontSize,
    );
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${scaledFontSize}px`,
    );
    document.documentElement.style.setProperty(
      "--editor-font-family",
      getResolvedEditorFontFamily(settings),
    );
  }, [settings.fontSize, settings.uiFontSize, settings.editorFontFamily]);
  useAppBootstrap({
    settings,
    settingsHydrated,
    currentFilePath,
    rootFolderPath,
    updateSettings,
  });
  useAppUpdater({
    language: settings.language,
    settingsHydrated,
    autoCheckForUpdates: settings.autoCheckForUpdates,
    skippedUpdateVersion: settings.skippedUpdateVersion,
    updateSettings,
    showNotification,
    t,
  });

  const { forceSave } = useAutoSave({ enabled: true });
  const { handleExportToPdf, handleExportToHtml, buildLongImageSharePayload } =
    useExportActions(highlighter);
  const { handlePublishSimpleBlog, handlePublishWechatDraft } =
    usePublishActions(forceSave);
  const [sidebarSearchRequestKey, setSidebarSearchRequestKey] = useState(0);
  const [sidebarLocateRequestKey, setSidebarLocateRequestKey] = useState(0);

  const [isSearchBarOpen, setIsSearchBarOpen] = useState(false);
  const [isNewNoteDialogOpen, setIsNewNoteDialogOpen] = useState(false);
  const [isPublishTargetDialogOpen, setIsPublishTargetDialogOpen] =
    useState(false);
  const [isSimpleBlogDialogOpen, setIsSimpleBlogDialogOpen] = useState(false);
  const [isWechatDraftDialogOpen, setIsWechatDraftDialogOpen] = useState(false);
  const [isShareLongImageDialogOpen, setIsShareLongImageDialogOpen] =
    useState(false);
  const [isAskVaultOpen, setIsAskVaultOpen] = useState(false);
  const [isRestoringStartupKnowledgeBase, setIsRestoringStartupKnowledgeBase] =
    useState(false);
  const [hasResolvedStartupKnowledgeBase, setHasResolvedStartupKnowledgeBase] =
    useState(false);

  const openRuntimeExternalPaths = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        try {
          // Primary window with an open vault: OS / second-instance opens go to
          // a new window. Secondary windows always open in-place.
          if (isTauriEnvironment() && rootFolderPath) {
            const label = await getCurrentAppWindowLabel();
            if (isPrimaryAppWindow(label)) {
              await openPathInNewAppWindow(path);
              continue;
            }
          }
          await openFilePath(path, {
            silentSuccess: true,
            suppressErrors: false,
          });
        } catch (error) {
          console.warn("Failed to open runtime external file:", error);
        }
      }
    },
    [openFilePath, rootFolderPath],
  );

  const externalFileOpen = useExternalFileOpen({
    settingsHydrated,
    onRuntimePaths: openRuntimeExternalPaths,
  });

  const openPathInNewWindowFromUi = useCallback(
    async (path: string) => {
      if (!isTauriEnvironment()) {
        showNotification(t("notifications_newWindowDesktopOnly"), "error");
        return;
      }
      try {
        // Keep the vault tree in windows opened from the sidebar.
        await openPathInNewAppWindow(path, { withVault: true });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        showNotification(
          t("notifications_openInNewWindowFailed", { error: detail }),
          "error",
        );
      }
    },
    [showNotification, t],
  );

  const handleOpenNewWindow = useCallback(async () => {
    if (!isTauriEnvironment()) {
      showNotification(t("notifications_newWindowDesktopOnly"), "error");
      return;
    }
    try {
      await openNewAppWindow();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      showNotification(
        t("notifications_openNewWindowFailed", { error: detail }),
        "error",
      );
    }
  }, [showNotification, t]);
  const {
    contentDensity,
    canShowOutlinePanel,
    canShowOutlineToggle,
    isOutlineOpen,
    isOutlineVisible,
    mainContentRef,
    responsiveOutlineWidth,
    responsiveSidebarWidth,
    setIsOutlineOpen,
    setOutlineWidth,
    setSidebarWidth,
  } = useWorkspaceLayout({
    activeTabId,
    isSidebarOpen,
    viewMode,
  });
  useActiveFileWatch({
    activeTabId,
    currentFilePath,
    openTabs,
    files,
    readFile,
    setCurrentFilePath,
    showNotification,
    closeTab,
    refreshFileTree,
    watchFile,
    t,
  });
  useKnowledgeBaseWatch({
    rootFolderPath,
    watchDirectory,
    showNotification,
    t,
  });
  useVaultIndexLifecycle();
  const {
    pendingCleanupAttachments,
    confirmCleanupUnusedAttachments,
    cancelCleanupUnusedAttachments,
  } = useAttachmentCleanup({
    closeTab,
    fileContents,
    files,
    moveToTrash,
    openTabs,
    refreshFileTree,
    rootFolderPath,
    resourceFolder: settings.resourceFolder,
    showNotification,
    t,
  });

  const activeFile = activeTabId
    ? findFileInTree(files, activeTabId)
    : undefined;
  const isPreviewOnlyActiveFile = activeFile
    ? isPreviewOnlyFile(activeFile.name)
    : false;
  const isExcalidrawActiveFile = activeFile
    ? isExcalidrawFile(activeFile.name)
    : false;
  const isNonMarkdownWorkspaceFile =
    isPreviewOnlyActiveFile || isExcalidrawActiveFile;

  // Global keyboard shortcuts
  useUiFontSizeKeyboardShortcuts();
  useGlobalKeyboardShortcuts(
    async () => {
      if (currentFilePath) {
        const saved = await forceSave(undefined, {
          formatBeforeSave: settings.formatMarkdownOnManualSave,
          trigger: "manual",
        });
        if (saved) {
          showNotification(t("app_saved"), "success");
        }
      }
    },
    handleAIAnalyze,
    {
      onSearch: () => setIsSearchBarOpen(true),
      onSidebarSearch: () => {
        setSidebarOpen(true);
        setSidebarSearchRequestKey((prev) => prev + 1);
      },
      onLocateCurrentFile: () => {
        if (!activeTabId) return;
        setSidebarOpen(true);
        setSidebarLocateRequestKey((prev) => prev + 1);
      },
      onOpenSettings: () => setSettingsOpen(true),
      onToggleOutline: () => setIsOutlineOpen((prev) => !prev),
      onToggleSidebar: () => setSidebarOpen(!isSidebarOpen),
      onToggleTheme: toggleTheme,
      onNewNote: () => setIsNewNoteDialogOpen(true),
      onNewFolder: () => {
        void fileOps.handleNewFolder(undefined, t("app_untitledFolder"));
      },
      onNewWindow: () => {
        void handleOpenNewWindow();
      },
      onCloseTab: () => {
        if (!activeTabId) return;

        const tabToClose = activeTabId;
        void (async () => {
          const state = useAppStore.getState();
          if (state.hasUnsavedChanges(tabToClose)) {
            const saved = await forceSave(undefined, { trigger: "system" });
            if (!saved) {
              showNotification(t("tab_closeBlockedUnsaved"), "error");
              return;
            }
          }

          const latestState = useAppStore.getState();
          if (latestState.openTabs.includes(tabToClose)) {
            closeTab(tabToClose);
          }
        })();
      },
      onOpenKnowledgeBase: () => {
        void handleSwitchKnowledgeBase();
      },
      onExportPdf: () => {
        void handleExportToPdf();
      },
      onToggleView: isNonMarkdownWorkspaceFile ? () => {} : undefined,
    },
  );

  const wasPreviewOnlyActiveFileRef = useRef(false);

  useEffect(() => {
    const wasPreviewOnly = wasPreviewOnlyActiveFileRef.current;
    wasPreviewOnlyActiveFileRef.current = isPreviewOnlyActiveFile;

    const transition = resolvePreviewOnlyViewModeTransition({
      wasPreviewOnly,
      isPreviewOnly: isPreviewOnlyActiveFile,
      currentViewMode: viewMode,
      viewModeBeforePreviewOnly,
    });

    if (
      transition.nextViewModeBeforePreviewOnly !== undefined &&
      transition.nextViewModeBeforePreviewOnly !== viewModeBeforePreviewOnly
    ) {
      setViewModeBeforePreviewOnly(transition.nextViewModeBeforePreviewOnly);
    }

    if (
      transition.nextViewMode !== undefined &&
      transition.nextViewMode !== viewMode
    ) {
      setViewMode(transition.nextViewMode, "direct");
    }
  }, [
    isPreviewOnlyActiveFile,
    viewMode,
    viewModeBeforePreviewOnly,
    setViewMode,
    setViewModeBeforePreviewOnly,
  ]);

  const handleHeadingClick = useCallback(
    (id: string, line: number) => {
      setActiveHeadingId(id);
      // Quiet split-pane percentage sync + scroll-spy while both panes jump.
      beginHeadingNavigationLock();

      const lineIndex = Math.max(0, line - 1);
      const lines = content.split("\n");
      const cursorPos = lines
        .slice(0, lineIndex)
        .reduce((sum, l) => sum + l.length + 1, 0);

      if (viewMode !== ViewMode.PREVIEW) {
        requestEditorRangeFocus(activeTabId, cursorPos, cursorPos, {
          alignTopRatio: 0.3,
        });
      }

      // Reading shows the HTML preview pane.
      if (viewMode === ViewMode.PREVIEW) {
        requestPreviewHeadingScroll(activeTabId, id, {
          alignMode: "center",
          behavior: "auto",
        });
      }
    },
    [activeTabId, content, setActiveHeadingId, viewMode],
  );

  const handleContentChange = useCallback(
    (newContent: string, meta?: CodeMirrorContentChangeMeta) => {
      if (!activeTabId) {
        setContent(newContent, meta?.skipHistory);
        return;
      }

      setContentForFile(activeTabId, newContent, meta?.skipHistory);
    },
    [activeTabId, setContent, setContentForFile],
  );

  const handleToolbarViewModeChange = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode, "direct");
    },
    [setViewMode],
  );

  const handleSidebarWidthChange = useCallback((nextWidth: number) => {
    setSidebarWidth(nextWidth);
  }, []);

  const handleSubmitNewNote = useCallback(
    (value: string) => {
      const fileName = value.trim();
      if (!fileName) return;

      void fileOps.handleCreateFile(undefined, fileName);
      setIsNewNoteDialogOpen(false);
    },
    [fileOps],
  );

  const handleCreateMissingWikiNote = useCallback(
    async (targetRaw: string) => {
      const trimmed = targetRaw.trim().split("|")[0]?.split("#")[0]?.trim();
      if (!trimmed || !rootFolderPath) return;

      const segments = trimmed
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
      if (segments.some((part) => part === "..")) {
        showNotification(t("notifications_invalidWikiTarget"), "error");
        return;
      }
      if (segments.length === 0) return;

      const leaf = segments[segments.length - 1]!.replace(
        /\.(md|markdown)$/i,
        "",
      );
      const parentSegments = segments.slice(0, -1);
      try {
        const fs = await getFileSystem();
        const parentFolder =
          parentSegments.length > 0
            ? joinFsPath(rootFolderPath, ...parentSegments)
            : rootFolderPath;
        if (parentSegments.length > 0) {
          await fs.createDirectory(parentFolder);
          await refreshFileTree();
        }
        await fileOps.handleCreateFile(
          parentSegments.length > 0
            ? {
                id: parentFolder,
                name: parentSegments[parentSegments.length - 1]!,
                type: "folder",
                path: parentFolder,
              }
            : undefined,
          leaf,
        );
      } catch (error) {
        showNotification(
          error instanceof Error
            ? error.message
            : t("notifications_wikiCreateFailed"),
          "error",
        );
      }
    },
    [fileOps, refreshFileTree, rootFolderPath, showNotification, t],
  );

  const handleOutlineWidthChange = useCallback((nextWidth: number) => {
    setOutlineWidth(nextWidth);
  }, []);

  const standaloneDocumentSession = isStandaloneDocumentSession(
    rootFolderPath,
    files.length,
  );

  const handleSwitchKnowledgeBase = useCallback(async () => {
    if (isStandaloneDocumentSession(rootFolderPath, files.length)) {
      showNotification(
        t("sidebar_openKnowledgeBaseDisabledStandalone"),
        "error",
      );
      return;
    }
    const state = useAppStore.getState();
    const tabId = state.activeTabId;
    if (tabId && state.hasUnsavedChanges(tabId)) {
      const saved = await forceSave(undefined, { trigger: "system" });
      if (!saved) {
        showNotification(
          t("notifications_switchKnowledgeBaseSaveFailed"),
          "error",
        );
        return;
      }
    }
    await openDirectory();
  }, [
    files.length,
    forceSave,
    openDirectory,
    rootFolderPath,
    showNotification,
    t,
  ]);

  const handleOpenPublishDialog = useCallback(() => {
    if (isNonMarkdownWorkspaceFile) {
      showNotification(t("notifications_exportMarkdownOnly"), "error");
      return;
    }
    setIsPublishTargetDialogOpen(true);
  }, [isNonMarkdownWorkspaceFile, showNotification, t]);

  const handleSelectSimpleBlogPublish = useCallback(() => {
    setIsPublishTargetDialogOpen(false);
    void (async () => {
      const hydratedSettings = await hydrateSensitiveSettingsIntoStore();
      const language = hydratedSettings.language;

      if (!hydratedSettings.blogRepoUrl.trim()) {
        showNotification(t("notifications_setBlogRepoFirst"), "error");
        return;
      }
      if (!isValidBlogRepoUrl(hydratedSettings.blogRepoUrl)) {
        showNotification(t("notifications_setValidBlogRepoFirst"), "error");
        return;
      }
      if (!hydratedSettings.blogSiteUrl.trim()) {
        showNotification(t("notifications_setBlogSiteFirst"), "error");
        return;
      }
      if (!isValidBlogSiteUrl(hydratedSettings.blogSiteUrl)) {
        showNotification(t("notifications_setValidBlogSiteFirst"), "error");
        return;
      }
      if (!hydratedSettings.blogGithubToken?.trim()) {
        showNotification(t("notifications_setGithubTokenFirst"), "error");
        return;
      }

      setIsSimpleBlogDialogOpen(true);
    })();
  }, [showNotification, t]);

  const handleSubmitSimpleBlog = useCallback(
    async (input: SimpleBlogPublishInput) => {
      const published = await handlePublishSimpleBlog(input);
      if (published) {
        setIsSimpleBlogDialogOpen(false);
      }
    },
    [handlePublishSimpleBlog],
  );

  const handleSelectWechatDraftPublish = useCallback(() => {
    setIsPublishTargetDialogOpen(false);
    setIsWechatDraftDialogOpen(true);
  }, []);

  const handleSubmitWechatDraft = useCallback(
    async (input: WechatDraftPublishInput) => {
      const published = await handlePublishWechatDraft(input);
      if (published) {
        setIsWechatDraftDialogOpen(false);
      }
    },
    [handlePublishWechatDraft],
  );

  const wechatDraftDefaults = useMemo(() => {
    if (!activeFile || !content) {
      return null;
    }

    return extractWechatDraftDefaults(content, activeFile.path);
  }, [activeFile, content]);

  const simpleBlogPublishDefaults = useMemo(() => {
    if (!activeFile || !content) {
      return null;
    }

    return extractSimpleBlogPublishDefaults(content, activeFile.path);
  }, [activeFile, content]);
  const notification = useAppStore((state) => state.notification);
  const currentKnowledgeBaseName = useMemo(
    () => getPathBasename(rootFolderPath),
    [rootFolderPath],
  );
  const uiFontFamily = useMemo(
    () => getResolvedUiFontFamily(settings),
    [settings.uiFontFamily],
  );
  const uiScaleStyle = useMemo(
    () =>
      ({
        "--ui-font-size": `${settings.uiFontSize}px`,
        "--ui-font-scale": `${settings.uiFontSize / defaultSettings.uiFontSize}`,
      }) as React.CSSProperties,
    [settings.uiFontSize],
  );

  useEffect(() => {
    if (!settingsHydrated) return;
    if (!externalFileOpen.hasCheckedExternalFiles) return;
    if (hasResolvedStartupKnowledgeBase) return;

    let cancelled = false;

    const openPendingBootFiles = async () => {
      const pending = externalFileOpen.pendingBootPaths;
      if (pending.length === 0) return;
      for (const path of pending) {
        if (cancelled) return;
        await openFilePath(path, {
          silentSuccess: true,
          suppressErrors: false,
        });
      }
      if (!cancelled) {
        externalFileOpen.clearPendingBootPaths();
      }
    };

    void (async () => {
      try {
        if (rootFolderPath) {
          await openPendingBootFiles();
          if (!cancelled) setHasResolvedStartupKnowledgeBase(true);
          return;
        }

        if (!isTauriEnvironment()) {
          await openPendingBootFiles();
          if (!cancelled) setHasResolvedStartupKnowledgeBase(true);
          return;
        }

        const lastKnowledgeBasePath = settings.lastKnowledgeBasePath?.trim();
        const pendingCount = externalFileOpen.pendingBootPaths.length;
        const restoreVault = shouldRestoreVaultOnBoot({
          pendingBootPathCount: pendingCount,
          withVault: externalFileOpen.bootOpenWithVault,
        });

        // OS / system single-file launch: open only that file — do not restore
        // the historical knowledge base (keeps "Open Knowledge Base" disabled).
        if (!lastKnowledgeBasePath || !restoreVault) {
          await openPendingBootFiles();
          if (!cancelled) setHasResolvedStartupKnowledgeBase(true);
          return;
        }

        setIsRestoringStartupKnowledgeBase(true);
        const restoredPath = await openKnowledgeBase(lastKnowledgeBasePath, {
          silentSuccess: true,
          skipSampleNotes: true,
          suppressErrors: true,
          // Prefer the boot openFile target over the previous session file.
          restoreLastOpenedFile: pendingCount === 0,
        });

        if (cancelled) return;

        if (!restoredPath) {
          updateSettings({
            lastKnowledgeBasePath: "",
            lastOpenedFilePath: "",
          });
        }

        await openPendingBootFiles();
      } finally {
        if (!cancelled) {
          setIsRestoringStartupKnowledgeBase(false);
          setHasResolvedStartupKnowledgeBase(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      setIsRestoringStartupKnowledgeBase(false);
    };
  }, [
    externalFileOpen.bootOpenWithVault,
    externalFileOpen.clearPendingBootPaths,
    externalFileOpen.hasCheckedExternalFiles,
    externalFileOpen.pendingBootPaths,
    hasResolvedStartupKnowledgeBase,
    openFilePath,
    openKnowledgeBase,
    rootFolderPath,
    settings.lastKnowledgeBasePath,
    settingsHydrated,
    updateSettings,
  ]);

  const {
    shouldShowKnowledgeBaseLoading,
    shouldShowKnowledgeBaseOnboarding,
    isStandaloneBootOpen,
  } = getStartupKnowledgeBaseGate({
    settingsHydrated,
    rootFolderPath,
    filesLen: files.length,
    isTauri: isTauriEnvironment(),
    lastKnowledgeBasePath: settings.lastKnowledgeBasePath ?? "",
    externalChecked: externalFileOpen.hasCheckedExternalFiles,
    isRestoringStartupKnowledgeBase,
    hasResolvedStartupKnowledgeBase,
    pendingBootPathCount: externalFileOpen.pendingBootPaths.length,
    bootOpenWithVault: externalFileOpen.bootOpenWithVault,
  });

  if (shouldShowKnowledgeBaseLoading) {
    return (
      <KnowledgeBaseLoadingScreen
        uiScaleStyle={uiScaleStyle}
        uiFontFamily={uiFontFamily}
        standaloneDocument={isStandaloneBootOpen}
      />
    );
  }

  if (shouldShowKnowledgeBaseOnboarding) {
    return (
      <KnowledgeBaseOnboarding
        uiScaleStyle={uiScaleStyle}
        uiFontFamily={uiFontFamily}
        onOpen={handleSwitchKnowledgeBase}
      />
    );
  }

  return (
    <ErrorBoundary>
      <div
        className="flex h-screen flex-col overflow-hidden text-sm"
        style={{ ...uiScaleStyle, fontFamily: uiFontFamily }}
      >
        {(() => {
          const isMac =
            typeof navigator !== "undefined" &&
            /Mac/.test(navigator.platform ?? "");
          const shouldInsetForMacOverlayTitlebar =
            isMac && isTauriEnvironment();
          if (!shouldInsetForMacOverlayTitlebar) return null;
          return (
            <div
              className="h-[28px] w-full shrink-0 bg-gray-50 dark:bg-black"
              data-tauri-drag-region
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                void getCurrentWindow().startDragging();
              }}
            />
          );
        })()}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            files={files}
            activeFileId={activeTabId}
            onFileSelect={fileOps.handleFileSelect}
            onCreateFile={(folder, fileName) =>
              fileOps.handleCreateFile(folder, fileName)
            }
            onCreateDrawing={(folder, fileName) =>
              void fileOps.handleCreateDrawing(folder, fileName)
            }
            onNewFolder={(folder, name) =>
              fileOps.handleNewFolder(folder, name)
            }
            onRename={fileOps.handleRename}
            onDelete={fileOps.handleDelete}
            onReveal={fileOps.handleRevealInExplorer}
            onOpenInNewWindow={(path) => {
              void openPathInNewWindowFromUi(path);
            }}
            onMoveToTrash={fileOps.handleMoveToTrash}
            onRestoreFromTrash={fileOps.handleRestoreFromTrash}
            onDeleteForever={fileOps.handleDeleteForever}
            onEmptyTrash={fileOps.handleEmptyTrash}
            onMoveNode={fileOps.handleMoveNode}
            onMoveToRoot={fileOps.handleMoveToRoot}
            currentKnowledgeBaseName={currentKnowledgeBaseName}
            currentKnowledgeBasePath={rootFolderPath ?? undefined}
            onSwitchKnowledgeBase={handleSwitchKnowledgeBase}
            disableOpenKnowledgeBase={standaloneDocumentSession}
            isOpen={isSidebarOpen}
            searchFocusRequestKey={sidebarSearchRequestKey}
            locateCurrentFileRequestKey={sidebarLocateRequestKey}
            width={responsiveSidebarWidth}
            onWidthChange={handleSidebarWidthChange}
            onClose={() => setSidebarOpen(false)}
          />

          <main
            ref={mainContentRef}
            className="flex-1 flex flex-col h-full min-w-0 bg-gray-50 dark:bg-black"
          >
            <Toolbar
              fileName={activeFile?.name || ""}
              viewMode={viewMode}
              onViewModeChange={handleToolbarViewModeChange}
              onAIAnalyze={handleAIAnalyze}
              onAskVault={() => {
                setIsAskVaultOpen((prev) => {
                  const next = !prev;
                  if (next) setIsOutlineOpen(false);
                  return next;
                });
              }}
              isAskVaultOpen={isAskVaultOpen}
              isAnalyzing={isAnalyzing}
              isSaving={isSaving}
              isPublishing={isPublishing}
              isSidebarOpen={isSidebarOpen}
              onMenuClick={() => setSidebarOpen(!isSidebarOpen)}
              onToggleTheme={toggleTheme}
              themeMode={settings.themeMode}
              onPublish={handleOpenPublishDialog}
              onExportPdf={handleExportToPdf}
              onExportHtml={handleExportToHtml}
              onShareLongImage={() => {
                setIsShareLongImageDialogOpen(true);
              }}
              isPreviewOnlyFile={isNonMarkdownWorkspaceFile}
            />

            <div className="flex-1 min-w-0 flex overflow-hidden relative">
              <SplitView
                highlighter={highlighter}
                onContentChange={handleContentChange}
                onGenerateWikiFromSelection={handleGenerateWikiFromSelection}
                isOutlineOpen={isOutlineOpen}
                canShowOutline={canShowOutlinePanel}
                canShowOutlineToggle={canShowOutlineToggle}
                contentDensity={contentDensity}
                onToggleOutline={() => {
                  if (isAskVaultOpen) {
                    setIsAskVaultOpen(false);
                    setIsOutlineOpen(true);
                    return;
                  }
                  setIsOutlineOpen(!isOutlineOpen);
                }}
              />
              {activeTabId ? (
                <RightRail
                  isOpen={isOutlineVisible && !isAskVaultOpen}
                  headings={outlineHeadings}
                  activeHeadingId={activeHeadingId}
                  onHeadingClick={handleHeadingClick}
                  width={responsiveOutlineWidth}
                  onWidthChange={handleOutlineWidthChange}
                  onOpenPath={(path) => {
                    void fileOps.handleFileSelect({
                      id: path,
                      name: path.split(/[/\\]/).pop() || path,
                      type: "file",
                      path,
                    });
                  }}
                  onCreateMissingNote={handleCreateMissingWikiNote}
                />
              ) : null}
              {isAskVaultOpen ? (
                <AskVaultPanel
                  open
                  onClose={() => setIsAskVaultOpen(false)}
                  onOpenFile={fileOps.handleFileSelect}
                  readFile={readFile}
                />
              ) : null}
              {isSearchBarOpen && (
                <ContentSearch onClose={() => setIsSearchBarOpen(false)} />
              )}
            </div>
          </main>
        </div>

        <AppDialogs
          isSettingsOpen={isSettingsOpen}
          isNewNoteDialogOpen={isNewNoteDialogOpen}
          isPublishTargetDialogOpen={isPublishTargetDialogOpen}
          isSimpleBlogDialogOpen={isSimpleBlogDialogOpen}
          isWechatDraftDialogOpen={isWechatDraftDialogOpen}
          isShareLongImageDialogOpen={isShareLongImageDialogOpen}
          isPublishing={isPublishing}
          settings={settings}
          wechatDraftDefaults={wechatDraftDefaults}
          simpleBlogPublishDefaults={simpleBlogPublishDefaults}
          notification={notification}
          attachmentContext={{ files, rootFolderPath }}
          t={t as unknown as (key: string) => string}
          uiScaleStyle={uiScaleStyle}
          buildPayload={buildLongImageSharePayload}
          onCloseSettings={() => setSettingsOpen(false)}
          onUpdateSettings={updateSettings}
          onCloseNewNote={() => setIsNewNoteDialogOpen(false)}
          onSubmitNewNote={handleSubmitNewNote}
          onClosePublishTarget={() => setIsPublishTargetDialogOpen(false)}
          onSelectSimpleBlog={handleSelectSimpleBlogPublish}
          onSelectWechatDraft={handleSelectWechatDraftPublish}
          onCloseSimpleBlog={() => setIsSimpleBlogDialogOpen(false)}
          onSubmitSimpleBlog={(input) => {
            void handleSubmitSimpleBlog(input);
          }}
          onCloseWechatDraft={() => setIsWechatDraftDialogOpen(false)}
          onSubmitWechatDraft={(input) => {
            void handleSubmitWechatDraft(input);
          }}
          onCloseShareLongImage={() => setIsShareLongImageDialogOpen(false)}
          cleanupPendingCount={pendingCleanupAttachments?.length ?? 0}
          onConfirmCleanupAttachments={() => {
            void confirmCleanupUnusedAttachments();
          }}
          onCancelCleanupAttachments={cancelCleanupUnusedAttachments}
        />
        <UiZoomHint />
      </div>
    </ErrorBoundary>
  );
};

export default App;
