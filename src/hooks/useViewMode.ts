/**
 * Hook for view mode management
 *
 * Toggle cycle: Live → Reading → Live
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

  const setLive = useCallback(() => {
    setViewMode(ViewMode.LIVE, "direct");
  }, [setViewMode]);

  const setPreviewOnly = useCallback(() => {
    setViewMode(ViewMode.PREVIEW, "direct");
  }, [setViewMode]);

  const normalized = normalizeSessionViewMode(viewMode);

  return {
    viewMode: normalized,
    setViewMode,
    toggleViewMode,
    setLive,
    /** @deprecated Use setLive — EDITOR mode is normalized to LIVE. */
    setEditorOnly: setLive,
    /** @deprecated Split mode removed; maps to Live. */
    setSplit: setLive,
    setPreviewOnly,
    isLive: normalized === ViewMode.LIVE,
    isEditorOnly: normalized === ViewMode.LIVE,
    isSplit: false,
    isPreviewOnly: normalized === ViewMode.PREVIEW,
  };
}
