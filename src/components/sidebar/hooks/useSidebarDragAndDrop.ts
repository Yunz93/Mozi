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
          !!nativeDraggedNodeId(),
        )
      )
        return;
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
    const finish = () => {
      stopAutoScroll();
      setIsDragging(false);
    };
    const nativeChange = () => {
      setIsDragging(!!nativeDraggedNodeId());
      if (!nativeDraggedNodeId()) stopAutoScroll();
    };
    window.addEventListener(NATIVE_DRAG_STATE_EVENT, nativeChange);
    document.addEventListener("dragend", finish, true);
    document.addEventListener("drop", finish, true);
    return () => {
      disposed = true;
      unsubscribe?.();
      stopAutoScroll();
      window.removeEventListener(NATIVE_DRAG_STATE_EVENT, nativeChange);
      document.removeEventListener("dragend", finish, true);
      document.removeEventListener("drop", finish, true);
    };
  }, [stopAutoScroll]);
  const [isRootDragOver, setIsRootDragOver] = useState(false);

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
        !!nativeDraggedNodeId(),
      );
      if (!intent) return;
      event.preventDefault();
      event.dataTransfer.dropEffect =
        intent === "import-files" || nativeDraggedNodeId() ? "copy" : "move";
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
      stopAutoScroll();
      setIsDragging(false);
      setIsRootDragOver(false);

      const intent = resolveSidebarDropIntent(
        event,
        hasDragPayload(event),
        !!nativeDraggedNodeId(),
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
