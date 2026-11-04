import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LAYOUT,
  clamp,
  getMinimumWorkspaceWidth,
  getMinimumWorkspaceWidthWithOutline,
  getStoredPanelWidth,
} from "../config/layout";
import { throttle } from "../utils/throttle";
import { ViewMode } from "../types";
import type { PaneDensity } from "../components/editor/paneLayout";

interface UseWorkspaceLayoutOptions {
  activeTabId: string | null;
  isSidebarOpen: boolean;
  viewMode: ViewMode;
}

interface UseWorkspaceLayoutResult {
  contentDensity: PaneDensity;
  canShowOutlinePanel: boolean;
  canShowOutlineToggle: boolean;
  isOutlineOpen: boolean;
  isOutlineVisible: boolean;
  mainContentRef: React.RefObject<HTMLElement | null>;
  responsiveOutlineWidth: number;
  responsiveSidebarWidth: number;
  setIsOutlineOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setOutlineWidth: React.Dispatch<React.SetStateAction<number>>;
  setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
}

export function useWorkspaceLayout(
  options: UseWorkspaceLayoutOptions,
): UseWorkspaceLayoutResult {
  const { activeTabId, isSidebarOpen, viewMode } = options;

  const [isOutlineOpen, setIsOutlineOpen] = useState(false);
  const [mainContentWidth, setMainContentWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1440,
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    getStoredPanelWidth(
      LAYOUT.STORAGE_KEYS.SIDEBAR_WIDTH,
      LAYOUT.SIDEBAR.DEFAULT_WIDTH,
      LAYOUT.SIDEBAR.MIN_WIDTH,
      LAYOUT.SIDEBAR.MAX_WIDTH,
    ),
  );
  const [outlineWidth, setOutlineWidth] = useState(() =>
    getStoredPanelWidth(
      LAYOUT.STORAGE_KEYS.OUTLINE_WIDTH,
      LAYOUT.OUTLINE.DEFAULT_WIDTH,
      LAYOUT.OUTLINE.MIN_WIDTH,
      LAYOUT.OUTLINE.MAX_WIDTH,
    ),
  );
  const mainContentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const mainEl = mainContentRef.current;
    if (!mainEl) return;

    const throttledSetMainContentWidth = throttle(setMainContentWidth, 16);
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      throttledSetMainContentWidth(entry.contentRect.width);
    });

    resizeObserver.observe(mainEl);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      LAYOUT.STORAGE_KEYS.SIDEBAR_WIDTH,
      String(sidebarWidth),
    );
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      LAYOUT.STORAGE_KEYS.OUTLINE_WIDTH,
      String(outlineWidth),
    );
  }, [outlineWidth]);

  const minimumWorkspaceWidth = useMemo(
    () => getMinimumWorkspaceWidth(viewMode),
    [viewMode],
  );

  const responsiveOutlineWidth = useMemo(
    () =>
      Math.min(
        outlineWidth,
        Math.max(LAYOUT.OUTLINE.MIN_WIDTH, Math.floor(mainContentWidth * 0.22)),
      ),
    [mainContentWidth, outlineWidth],
  );

  const outlineReservationWidth = useMemo(
    () =>
      activeTabId && isOutlineOpen
        ? responsiveOutlineWidth + LAYOUT.GAP.OUTLINE_PANEL
        : 0,
    [activeTabId, isOutlineOpen, responsiveOutlineWidth],
  );

  const maxSidebarWidthForViewport = useMemo(
    () =>
      Math.max(
        LAYOUT.SIDEBAR.RESPONSIVE_MIN_WIDTH,
        viewportWidth -
          minimumWorkspaceWidth -
          outlineReservationWidth -
          LAYOUT.GAP.SHELL_EDGE,
      ),
    [minimumWorkspaceWidth, outlineReservationWidth, viewportWidth],
  );

  const responsiveSidebarWidth = useMemo(
    () =>
      isSidebarOpen
        ? Math.min(sidebarWidth, maxSidebarWidthForViewport)
        : sidebarWidth,
    [isSidebarOpen, maxSidebarWidthForViewport, sidebarWidth],
  );

  const workspaceWidthWithOutline = useMemo(
    () => mainContentWidth - responsiveOutlineWidth - LAYOUT.GAP.OUTLINE_PANEL,
    [mainContentWidth, responsiveOutlineWidth],
  );

  const minimumWorkspaceWidthWithOutline = useMemo(
    () => getMinimumWorkspaceWidthWithOutline(viewMode),
    [viewMode],
  );

  const canShowOutlinePanel = useMemo(
    () =>
      Boolean(activeTabId) &&
      workspaceWidthWithOutline >= minimumWorkspaceWidthWithOutline,
    [activeTabId, minimumWorkspaceWidthWithOutline, workspaceWidthWithOutline],
  );

  const isOutlineVisible = Boolean(activeTabId) && isOutlineOpen;
  const canShowOutlineToggle = Boolean(activeTabId);

  const contentDensity: PaneDensity = useMemo(
    () =>
      mainContentWidth < 1360 ||
      (isSidebarOpen && mainContentWidth < 1500) ||
      isOutlineVisible
        ? "compact"
        : "comfortable",
    [isOutlineVisible, isSidebarOpen, mainContentWidth],
  );

  const boundedSetSidebarWidth = useCallback(
    (value: number | ((prev: number) => number)) => {
      setSidebarWidth((prev) => {
        const nextValue = typeof value === "function" ? value(prev) : value;
        return clamp(
          nextValue,
          LAYOUT.SIDEBAR.MIN_WIDTH,
          LAYOUT.SIDEBAR.MAX_WIDTH,
        );
      });
    },
    [],
  );

  const boundedSetOutlineWidth = useCallback(
    (value: number | ((prev: number) => number)) => {
      setOutlineWidth((prev) => {
        const nextValue = typeof value === "function" ? value(prev) : value;
        return clamp(
          nextValue,
          LAYOUT.OUTLINE.MIN_WIDTH,
          LAYOUT.OUTLINE.MAX_WIDTH,
        );
      });
    },
    [],
  );

  return {
    contentDensity,
    canShowOutlinePanel,
    canShowOutlineToggle,
    isOutlineOpen,
    isOutlineVisible,
    mainContentRef,
    responsiveOutlineWidth,
    responsiveSidebarWidth,
    setIsOutlineOpen,
    setOutlineWidth: boundedSetOutlineWidth,
    setSidebarWidth: boundedSetSidebarWidth,
  };
}
