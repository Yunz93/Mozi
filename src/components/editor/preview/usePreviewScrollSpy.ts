import { useEffect, type RefObject } from "react";
import { useAppStore } from "../../../store/appStore";
import { isHeadingNavigationLocked } from "../../../utils/previewNavigationBridge";

type CachedHeading = {
  id: string;
  /** Distance from the top of the scroll content (scrollTop + relative viewport top). */
  top: number;
};

/**
 * Scroll-spy for the preview pane: keeps `activeHeadingId` in sync with the
 * heading currently near the top of the viewport, so the outline highlights
 * where you are while reading (not only after clicking an outline entry).
 *
 * Heading geometry is cached and rebuilt on content/resize; scroll frames only
 * binary-search the cache (no per-frame getBoundingClientRect walks).
 */
export function usePreviewScrollSpy(
  containerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) return;

    let rafId: number | null = null;
    let cache: CachedHeading[] = [];

    const rebuildCache = () => {
      const headingElements =
        element.querySelectorAll<HTMLElement>("[data-heading-id]");
      if (headingElements.length === 0) {
        cache = [];
        return;
      }

      const scrollTop = element.scrollTop;
      const containerTop = element.getBoundingClientRect().top;
      const next: CachedHeading[] = [];
      for (const headingElement of headingElements) {
        const id = headingElement.dataset.headingId;
        if (!id) continue;
        next.push({
          id,
          top:
            headingElement.getBoundingClientRect().top -
            containerTop +
            scrollTop,
        });
      }
      cache = next;
    };

    const updateActiveHeading = () => {
      rafId = null;
      // Keep the outline highlight pinned to the clicked chapter while the
      // programmatic jump is still settling through intermediate headings.
      if (isHeadingNavigationLocked()) return;
      if (cache.length === 0) {
        rebuildCache();
        if (cache.length === 0) return;
      }

      const thresholdY = element.scrollTop + element.clientHeight * 0.25;
      let currentId: string | null = cache[0]?.id ?? null;
      // Last heading whose top is at or above the threshold.
      let lo = 0;
      let hi = cache.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cache[mid].top <= thresholdY) {
          currentId = cache[mid].id;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      const store = useAppStore.getState();
      if (store.activeHeadingId !== currentId) {
        store.setActiveHeadingId(currentId);
      }
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(updateActiveHeading);
    };

    const scheduleRebuild = () => {
      rebuildCache();
      handleScroll();
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    const mutationObserver = new MutationObserver(scheduleRebuild);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleRebuild)
        : null;
    resizeObserver?.observe(element);

    // Initialize on mount so the outline is highlighted before any scroll.
    scheduleRebuild();

    return () => {
      element.removeEventListener("scroll", handleScroll);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [containerRef, enabled]);
}
