import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  nativeDraggedNodeId,
  NATIVE_DRAG_STATE_EVENT,
  subscribeNativeFileDrag,
} from "../nativeFileDrag";
import {
  extractDraggedNodeId as extractDraggedNodeIdFromEvent,
  hasDragPayload,
  setDragPayload,
} from "../dragPayload";
import {
  extractDroppedFiles,
  resolveSidebarDropIntent,
} from "../../../utils/droppedFiles";

export interface UseSidebarDragAndDropReturn {
  isDragging: boolean;
  handleDragCapture: (event: React.DragEvent<HTMLElement>) => void;
  handleDragLeaveCapture: (event: React.DragEvent<HTMLElement>) => void;
  stopAutoScroll: () => void;
  isRootDragOver: boolean;
  setIsRootDragOver: (value: boolean) => void;
  extractDraggedNodeId: (event: React.DragEvent) => string | null;
  handleDragStart: (event: React.DragEvent, nodeId: string) => void;
  handleRootDragOver: (event: React.DragEvent<HTMLElement>) => void;
  handleRootDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  handleRootDrop: (
    event: React.DragEvent<HTMLElement>,
    onMoveToRoot: (nodeId: string) => void,
    onImportDroppedFiles?: (files: File[]) => void,
  ) => void;
}

export function useSidebarDragAndDrop(
  scrollElementRef?: React.RefObject<HTMLDivElement | null>,
): UseSidebarDragAndDropReturn {
  const [isDragging, setIsDragging] = useState(false);
  const nativeHover = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  const scrollSpeed = useRef(0);
  const stopAutoScroll = useCallback(() => {
    if (scrollFrame.current !== null)
      window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    scrollSpeed.current = 0;
  }, []);
  const handleDragCapture = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (
        !resolveSidebarDropIntent(
          event,
          hasDragPayload(event),
          !!nativeDraggedNodeId(event),
        )
      )
        return;
      if (nativeDraggedNodeId(event)) nativeHover.current = true;
      setIsDragging(true);
      const element = scrollElementRef?.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const edge = Math.min(48, rect.height / 3);
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        stopAutoScroll();
        return;
      }
      scrollSpeed.current =
        event.clientY < rect.top + edge
          ? -Math.ceil((14 * (rect.top + edge - event.clientY)) / edge)
          : event.clientY > rect.bottom - edge
            ? Math.ceil((14 * (event.clientY - rect.bottom + edge)) / edge)
            : 0;
      if (!scrollSpeed.current) {
        stopAutoScroll();
        return;
      }
      if (scrollFrame.current !== null) return;
      const scroll = () => {
        if (!scrollElementRef?.current || !scrollSpeed.current) {
          scrollFrame.current = null;
          return;
        }
        scrollElementRef.current.scrollTop += scrollSpeed.current;
        scrollFrame.current = window.requestAnimationFrame(scroll);
      };
      scrollFrame.current = window.requestAnimationFrame(scroll);
    },
    [scrollElementRef, stopAutoScroll],
  );
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeNativeFileDrag()
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(() => {});
    let finishTimer: number | null = null;
    const finish = () => {
      if (finishTimer !== null) window.clearTimeout(finishTimer);
      finishTimer = null;
      nativeHover.current = false;
      stopAutoScroll();
      setIsDragging(false);
      setIsRootDragOver(false);
    };
    const finishAfterDrop = () => {
      stopAutoScroll();
      // 当前 drop 的 React 处理器必须先运行，捕获阶段不能卸载正在接收文件的快捷区。
      if (finishTimer !== null) window.clearTimeout(finishTimer);
      finishTimer = window.setTimeout(finish, 0);
    };
    const finishBrowserDrag = () => {
      if (nativeDraggedNodeId() || nativeHover.current) stopAutoScroll();
      else finish();
    };
    const nativeChange = (event: Event) => {
      if (nativeDraggedNodeId()) {
        if (finishTimer !== null) window.clearTimeout(finishTimer);
        finishTimer = null;
        setIsDragging(true);
      } else {
        stopAutoScroll();
        // 已悬停的根目录目标保持原位，直到 drop；取消或拖出时则立即收起。
        if (
          (event as CustomEvent<{ canceled?: boolean }>).detail?.canceled ||
          !nativeHover.current
        )
          finish();
      }
    };
    window.addEventListener(NATIVE_DRAG_STATE_EVENT, nativeChange);
    window.addEventListener("blur", finish);
    document.addEventListener("dragend", finishBrowserDrag, true);
    document.addEventListener("drop", finishAfterDrop, true);
    return () => {
      disposed = true;
      unsubscribe?.();
      if (finishTimer !== null) window.clearTimeout(finishTimer);
      stopAutoScroll();
      window.removeEventListener(NATIVE_DRAG_STATE_EVENT, nativeChange);
      window.removeEventListener("blur", finish);
      document.removeEventListener("dragend", finishBrowserDrag, true);
      document.removeEventListener("drop", finishAfterDrop, true);
    };
  }, [stopAutoScroll]);
  const [isRootDragOver, setIsRootDragOver] = useState(false);
  const handleDragLeaveCapture = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      )
        return;
      nativeHover.current = false;
      stopAutoScroll();
      setIsDragging(false);
      setIsRootDragOver(false);
    },
    [stopAutoScroll],
  );

  const extractDraggedNodeId = useCallback(
    (event: React.DragEvent): string | null =>
      extractDraggedNodeIdFromEvent(event),
    [],
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent, nodeId: string) => {
      setDragPayload(event, nodeId);
    },
    [],
  );

  const handleRootDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      // During dragover the payload data is not readable (protected mode);
      // only the list of types is, so gate on that instead of getData.
      const intent = resolveSidebarDropIntent(
        event,
        hasDragPayload(event),
        !!nativeDraggedNodeId(event),
      );
      if (!intent) return;
      event.preventDefault();
      if (nativeDraggedNodeId(event)) nativeHover.current = true;
      event.dataTransfer.dropEffect =
        intent === "import-files" || nativeDraggedNodeId(event)
          ? "copy"
          : "move";
      setIsRootDragOver(true);
    },
    [],
  );

  const handleRootDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && event.currentTarget.contains(nextTarget)) return;
      setIsRootDragOver(false);
    },
    [],
  );

  const handleRootDrop = useCallback(
    (
      event: React.DragEvent<HTMLElement>,
      onMoveToRoot: (nodeId: string) => void,
      onImportDroppedFiles?: (files: File[]) => void,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      nativeHover.current = false;
      stopAutoScroll();
      setIsDragging(false);
      setIsRootDragOver(false);

      const intent = resolveSidebarDropIntent(
        event,
        hasDragPayload(event),
        !!nativeDraggedNodeId(event),
      );
      if (intent === "import-files") {
        const files = extractDroppedFiles(event);
        if (files.length > 0) {
          onImportDroppedFiles?.(files);
          return;
        }
      }

      const sourceId = extractDraggedNodeIdFromEvent(event);
      if (!sourceId) return;
      onMoveToRoot(sourceId);
    },
    [stopAutoScroll],
  );

  return {
    isDragging,
    handleDragCapture,
    handleDragLeaveCapture,
    stopAutoScroll,
    isRootDragOver,
    setIsRootDragOver,
    extractDraggedNodeId,
    handleDragStart,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  };
}
