import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppStore, selectContent } from "../../store/appStore";
import { useI18n } from "../../hooks/useI18n";
import {
  EXCALIDRAW_SOURCE,
  parseExcalidrawDocument,
  serializeExcalidrawContent,
} from "../../utils/excalidrawDocument";
import { ensureExcalidrawAssetPath } from "../../utils/excalidrawAssetPath";

interface ExcalidrawPaneProps {
  onContentChange?: (content: string) => void;
  onContentChangeForTab?: (tabId: string, content: string) => void;
}

type PendingExcalidrawWrite = {
  tabId: string | null;
  lastSerialized: string;
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");

function resolveUiTheme(themeMode: string): "light" | "dark" {
  return themeMode === "dark" ? "dark" : "light";
}

export const ExcalidrawPane: React.FC<ExcalidrawPaneProps> = ({
  onContentChange,
  onContentChangeForTab,
}) => {
  const { t } = useI18n();
  const content = useAppStore(selectContent);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const hasUnsavedChanges = useAppStore((state) =>
    state.activeTabId ? state.hasUnsavedChanges(state.activeTabId) : false,
  );
  const themeMode = useAppStore((state) => state.settings.themeMode);
  const language = useAppStore((state) => state.settings.language);
  const [excalidrawModule, setExcalidrawModule] =
    useState<ExcalidrawModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sceneKey, setSceneKey] = useState(() => `${activeTabId ?? "none"}:0`);
  const lastSerializedRef = useRef<string>(content);
  const changeTimerRef = useRef<number | null>(null);
  const pendingWriteRef = useRef<PendingExcalidrawWrite | null>(null);
  const excalidrawModuleRef = useRef<ExcalidrawModule | null>(null);
  const previousTabIdRef = useRef(activeTabId);
  const baselineContentRef = useRef(content);
  const sceneContentRef = useRef(content);

  useEffect(() => {
    let cancelled = false;
    ensureExcalidrawAssetPath();
    void import("@excalidraw/excalidraw")
      .then(async (mod) => {
        await import("@excalidraw/excalidraw/index.css");
        if (!cancelled) {
          excalidrawModuleRef.current = mod;
          setExcalidrawModule(mod);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load Excalidraw:", error);
        if (!cancelled) {
          setLoadError(t("excalidraw_loadFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const flushPendingWrite = useCallback(
    (pending: PendingExcalidrawWrite) => {
      const mod = excalidrawModuleRef.current;
      if (!mod) return;

      const serialized = mod.serializeAsJSON(
        pending.elements as never,
        pending.appState as never,
        pending.files as never,
        "local",
      );

      let sceneJson = serialized;
      try {
        const json = JSON.parse(serialized) as Record<string, unknown>;
        if (!json.source) {
          json.source = EXCALIDRAW_SOURCE;
        }
        sceneJson = JSON.stringify(json, null, 2);
      } catch {
        // keep serializeAsJSON output
      }

      const next = serializeExcalidrawContent(
        sceneJson,
        pending.lastSerialized,
      );
      if (next === pending.lastSerialized) return;

      if (previousTabIdRef.current === pending.tabId) {
        lastSerializedRef.current = next;
        baselineContentRef.current = next;
      }

      if (pending.tabId && onContentChangeForTab) {
        onContentChangeForTab(pending.tabId, next);
      } else if (pending.tabId) {
        useAppStore.getState().setContentForFile(pending.tabId, next);
      } else {
        onContentChange?.(next);
      }
    },
    [onContentChange, onContentChangeForTab],
  );

  useEffect(() => {
    if (activeTabId !== previousTabIdRef.current) {
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      if (pendingWriteRef.current) {
        flushPendingWrite(pendingWriteRef.current);
        pendingWriteRef.current = null;
      }
      previousTabIdRef.current = activeTabId;
      baselineContentRef.current = content;
      sceneContentRef.current = content;
      lastSerializedRef.current = content;
      setSceneKey(`${activeTabId ?? "none"}:${Date.now()}`);
      return;
    }

    // External reload (disk watch) while clean — remount with new scene.
    if (!hasUnsavedChanges && content !== baselineContentRef.current) {
      baselineContentRef.current = content;
      sceneContentRef.current = content;
      lastSerializedRef.current = content;
      setSceneKey(`${activeTabId ?? "none"}:${Date.now()}`);
    }
  }, [activeTabId, content, hasUnsavedChanges, flushPendingWrite]);

  useEffect(() => {
    return () => {
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
      }
    };
  }, []);

  const parsedDocument = useMemo(() => {
    return parseExcalidrawDocument(sceneContentRef.current);
  }, [sceneKey]);

  const initialData = useMemo(() => {
    if (!parsedDocument || !excalidrawModule) return null;
    const restored = excalidrawModule.restore(
      {
        elements: parsedDocument.elements as never,
        appState: parsedDocument.appState as never,
        files: parsedDocument.files as never,
      },
      null,
      null,
      { repairBindings: true },
    );
    return {
      type: "excalidraw" as const,
      version: parsedDocument.version,
      source: parsedDocument.source,
      elements: restored.elements,
      appState: {
        ...restored.appState,
        collaborators: undefined,
      },
      files: restored.files,
      scrollToContent: true,
    };
  }, [parsedDocument, excalidrawModule]);

  const parseError = parsedDocument === null;

  const handleChange = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => {
      if (!excalidrawModule || !onContentChange) return;

      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
      }

      pendingWriteRef.current = {
        tabId: activeTabId,
        lastSerialized: lastSerializedRef.current,
        elements,
        appState,
        files,
      };

      changeTimerRef.current = window.setTimeout(() => {
        const pending = pendingWriteRef.current;
        pendingWriteRef.current = null;
        changeTimerRef.current = null;
        if (pending) flushPendingWrite(pending);
      }, 400);
    },
    [excalidrawModule, onContentChange, activeTabId, flushPendingWrite],
  );

  if (loadError) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center px-6 text-sm text-red-600 dark:text-red-400">
        {loadError}
      </div>
    );
  }

  if (!excalidrawModule || parseError) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center px-6 text-sm text-gray-500 dark:text-gray-400">
        {parseError ? t("excalidraw_invalidDocument") : t("excalidraw_loading")}
      </div>
    );
  }

  const { Excalidraw } = excalidrawModule;

  return (
    <div
      className="excalidraw-pane h-full min-h-0 w-full overflow-hidden bg-white dark:bg-[#121212]"
      data-testid="excalidraw-pane"
    >
      <Excalidraw
        key={sceneKey}
        initialData={initialData}
        theme={resolveUiTheme(themeMode)}
        langCode={language === "zh-CN" ? "zh-CN" : "en"}
        showDeprecatedFonts
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
        }}
        onChange={handleChange as never}
      />
    </div>
  );
};
