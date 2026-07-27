/**
 * Hook for view mode management
 *
 * Toggle cycle: Source → Split → Reading → Source
 */

import { useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { ViewMode } from "../types";
import { getNextViewMode, normalizeSessionViewMode } from "../utils/viewMode";

export function useViewMode() {
  const { viewMode, setViewMode } = useAppStore();

  const toggleViewMode = useCallback(() => {
    setViewMode(getNextViewMode(viewMode), "toggle");
  }, [viewMode, setViewMode]);

  const setEditorOnly = useCallback(() => {
    setViewMode(ViewMode.EDITOR, "direct");
  }, [setViewMode]);

  const setSplit = useCallback(() => {
    setViewMode(ViewMode.SPLIT, "direct");
  }, [setViewMode]);

  const setPreviewOnly = useCallback(() => {
    setViewMode(ViewMode.PREVIEW, "direct");
  }, [setViewMode]);

  const normalized = normalizeSessionViewMode(viewMode);

  return {
    viewMode: normalized,
    setViewMode,
    toggleViewMode,
    setEditorOnly,
    setSplit,
    setPreviewOnly,
    isEditorOnly: normalized === ViewMode.EDITOR,
    isSplit: normalized === ViewMode.SPLIT,
    isPreviewOnly: normalized === ViewMode.PREVIEW,
  };
}
