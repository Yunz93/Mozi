import { useShallow } from "zustand/react/shallow";
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
  const { viewMode, setViewMode } = useAppStore(
    useShallow((state) => ({
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
    })),
  );

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
    setPreviewOnly,
    isLive: normalized === ViewMode.LIVE,
    isPreviewOnly: normalized === ViewMode.PREVIEW,
  };
}
