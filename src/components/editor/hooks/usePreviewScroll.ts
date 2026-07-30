/**
 * Preview Scroll Hook
 *
 * 处理预览面板的滚动同步功能
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

const DEFAULT_SCROLL_THRESHOLD = 1;
const DEFAULT_SCROLL_EMIT_THRESHOLD = 0.001;
const SYNC_SETTLE_THRESHOLD = 0.25;
const SYNC_MIN_DURATION_MS = 16;
const SYNC_MAX_DURATION_MS = 140;
const SYNC_PIXELS_PER_MS = 8;

function getNormalizedScrollPercentage(
  scrollTop: number,
  scrollHeight: number,
): number {
  if (scrollHeight <= 0) return 0;
  return Math.min(Math.max(scrollTop / scrollHeight, 0), 1);
}

export interface UsePreviewScrollOptions {
  onScroll?: (percentage: number) => void;
}

export interface UsePreviewScrollReturn {
  // 滚动处理器
  handleScroll: (element: HTMLElement) => void;
  // 取消同步
  cancelScrollSync: () => void;
  // 同步到百分比
  syncScrollTo: (
    element: HTMLElement,
    percentage: number,
    options?: { immediate?: boolean },
  ) => void;
  // 布局就绪后补应用（例如预览高度曾为零）
  flushPendingScrollSync: (element: HTMLElement) => void;
  // 检查是否正在同步
  isSyncing: () => boolean;
}

export function usePreviewScroll(
  options: UsePreviewScrollOptions,
): UsePreviewScrollReturn {
  const { onScroll } = options;

  const isSyncingScroll = useRef(false);
  const lastScrollPercentage = useRef(0);
  const onScrollRef = useRef(onScroll);
  const syncAnimationFrameRef = useRef<number | null>(null);
  const syncTargetScrollTopRef = useRef<number | null>(null);
  const syncStartScrollTopRef = useRef(0);
  const syncStartTimeRef = useRef(0);
  const syncDurationRef = useRef(SYNC_MIN_DURATION_MS);
  const syncedElementRef = useRef<HTMLElement | null>(null);
  const unlockAnimationFrameRef = useRef<number | null>(null);
  const pendingScrollPercentageRef = useRef<number | null>(null);
  const scrollThresholdRef = useRef(DEFAULT_SCROLL_THRESHOLD);
  const emitThresholdRef = useRef(DEFAULT_SCROLL_EMIT_THRESHOLD);
  const pendingEmitElementRef = useRef<HTMLElement | null>(null);
  const emitRafRef = useRef<number | null>(null);

  useEffect(() => {
    onScrollRef.current = onScroll;
  }, [onScroll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelScrollSync();
    };
  }, []);

  // Cancel synced scroll
  const cancelScrollSync = useCallback(() => {
    if (syncAnimationFrameRef.current !== null) {
      cancelAnimationFrame(syncAnimationFrameRef.current);
      syncAnimationFrameRef.current = null;
    }
    if (unlockAnimationFrameRef.current !== null) {
      cancelAnimationFrame(unlockAnimationFrameRef.current);
      unlockAnimationFrameRef.current = null;
    }
    if (emitRafRef.current !== null) {
      cancelAnimationFrame(emitRafRef.current);
      emitRafRef.current = null;
    }
    pendingEmitElementRef.current = null;
    syncTargetScrollTopRef.current = null;
    syncStartTimeRef.current = 0;
    syncedElementRef.current = null;
    isSyncingScroll.current = false;
    pendingScrollPercentageRef.current = null;
  }, []);

  const scheduleSyncUnlock = useCallback(() => {
    if (unlockAnimationFrameRef.current !== null) {
      cancelAnimationFrame(unlockAnimationFrameRef.current);
    }

    unlockAnimationFrameRef.current = requestAnimationFrame(() => {
      unlockAnimationFrameRef.current = null;
      isSyncingScroll.current = false;
    });
  }, []);

  // Animate synced scroll
  const animateSyncedScroll = useCallback(
    (element: HTMLElement, targetScrollTop: number) => {
      const maxScrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
      const clampedTarget = Math.min(
        Math.max(targetScrollTop, 0),
        maxScrollTop,
      );
      const currentScrollTop = element.scrollTop;

      syncedElementRef.current = element;
      syncTargetScrollTopRef.current = clampedTarget;
      syncStartScrollTopRef.current = currentScrollTop;
      syncStartTimeRef.current = 0;
      syncDurationRef.current = Math.min(
        SYNC_MAX_DURATION_MS,
        Math.max(
          SYNC_MIN_DURATION_MS,
          Math.abs(clampedTarget - currentScrollTop) / SYNC_PIXELS_PER_MS,
        ),
      );
      isSyncingScroll.current = true;

      if (syncAnimationFrameRef.current !== null) return;

      const step = (timestamp: number) => {
        const activeElement = syncedElementRef.current;
        const target = syncTargetScrollTopRef.current;

        if (!activeElement || activeElement !== element || target === null) {
          syncAnimationFrameRef.current = null;
          syncTargetScrollTopRef.current = null;
          syncStartTimeRef.current = 0;
          syncedElementRef.current = null;
          isSyncingScroll.current = false;
          return;
        }

        if (syncStartTimeRef.current === 0) {
          syncStartTimeRef.current = timestamp;
        }

        const start = syncStartScrollTopRef.current;
        const duration = syncDurationRef.current;
        const progress = Math.min(
          1,
          (timestamp - syncStartTimeRef.current) / duration,
        );
        const nextScrollTop = start + (target - start) * progress;

        if (
          Math.abs(target - nextScrollTop) <= SYNC_SETTLE_THRESHOLD ||
          progress >= 1
        ) {
          activeElement.scrollTop = target;
          syncAnimationFrameRef.current = null;
          syncTargetScrollTopRef.current = null;
          syncStartTimeRef.current = 0;
          syncedElementRef.current = null;
          scheduleSyncUnlock();
          return;
        }

        activeElement.scrollTop = nextScrollTop;
        syncAnimationFrameRef.current = requestAnimationFrame(step);
      };

      syncAnimationFrameRef.current = requestAnimationFrame(step);
    },
    [scheduleSyncUnlock],
  );

  // Sync scroll to percentage
  const syncScrollTo = useCallback(
    (
      element: HTMLElement,
      percentage: number,
      options?: { immediate?: boolean },
    ) => {
      const scrollHeight = element.scrollHeight - element.clientHeight;
      if (scrollHeight <= 0) {
        pendingScrollPercentageRef.current = percentage;
        return;
      }

      const targetScroll = scrollHeight * percentage;

      if (
        Math.abs(element.scrollTop - targetScroll) <= scrollThresholdRef.current
      ) {
        pendingScrollPercentageRef.current = null;
        return;
      }
      pendingScrollPercentageRef.current = null;
      if (options?.immediate) {
        cancelScrollSync();
        isSyncingScroll.current = true;
        element.scrollTop = targetScroll;
        const d = element.scrollHeight - element.clientHeight;
        if (d > 0) {
          lastScrollPercentage.current = getNormalizedScrollPercentage(
            element.scrollTop,
            d,
          );
        }
        scheduleSyncUnlock();
        return;
      }
      animateSyncedScroll(element, targetScroll);
    },
    [animateSyncedScroll, cancelScrollSync, scheduleSyncUnlock],
  );

  const flushPendingScrollSync = useCallback(
    (element: HTMLElement) => {
      const pending = pendingScrollPercentageRef.current;
      if (pending === null) return;
      const scrollHeight = element.scrollHeight - element.clientHeight;
      if (scrollHeight <= 0) return;
      syncScrollTo(element, pending, { immediate: true });
    },
    [syncScrollTo],
  );

  // Handle scroll event (RAF-coalesced to match editor path and cut layout thrash)
  const handleScroll = useCallback((element: HTMLElement) => {
    pendingEmitElementRef.current = element;
    if (emitRafRef.current !== null) return;

    emitRafRef.current = requestAnimationFrame(() => {
      emitRafRef.current = null;
      const active = pendingEmitElementRef.current;
      pendingEmitElementRef.current = null;
      if (!active) return;

      const denom = active.scrollHeight - active.clientHeight;
      if (denom <= 0) return;

      const percentage = getNormalizedScrollPercentage(active.scrollTop, denom);

      if (isSyncingScroll.current) {
        lastScrollPercentage.current = percentage;
        return;
      }

      const onScrollCallback = onScrollRef.current;
      if (!onScrollCallback) return;

      if (
        Math.abs(percentage - lastScrollPercentage.current) <=
        emitThresholdRef.current
      ) {
        return;
      }

      lastScrollPercentage.current = percentage;
      onScrollCallback(percentage);
    });
  }, []);

  // Check if currently syncing
  const isSyncing = useCallback(() => isSyncingScroll.current, []);

  return useMemo(
    () => ({
      handleScroll,
      cancelScrollSync,
      syncScrollTo,
      flushPendingScrollSync,
      isSyncing,
    }),
    [
      cancelScrollSync,
      flushPendingScrollSync,
      handleScroll,
      isSyncing,
      syncScrollTo,
    ],
  );
}
