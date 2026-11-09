import type React from "react";
import { nativeDraggedNodeId } from "./nativeFileDrag";

/**
 * Shared drag-and-drop payload helpers for the sidebar file tree.
 *
 * All writers and readers must go through this module: the tree items and the
 * sidebar root drop zone previously used different MIME types, which silently
 * broke "drag to root".
 */
export const DRAG_DATA_TYPE = "application/vnd.markdown-press.node-id";

export function setDragPayload(
  event: React.DragEvent,
  nodeId: string,
  nodeType?: string,
): void {
  event.dataTransfer.setData(DRAG_DATA_TYPE, nodeId);
  // Redundant fallbacks for environments that drop custom MIME types.
  event.dataTransfer.setData(
    "application/json",
    JSON.stringify({ id: nodeId, type: nodeType }),
  );
  event.dataTransfer.setData("text/plain", nodeId);
  event.dataTransfer.effectAllowed = "move";
}

/**
 * Whether the drag in progress carries a file-tree node. Usable during
 * dragover, where `getData` returns an empty string in protected mode and
 * only `types` is readable.
 */
export function hasDragPayload(event: React.DragEvent): boolean {
  if (nativeDraggedNodeId()) return true;
  const types = event.dataTransfer.types;
  if (!types) return false;
  return (
    types.includes(DRAG_DATA_TYPE) ||
    types.includes("application/json") ||
    types.includes("text/plain")
  );
}

/** Extract the dragged node id on drop. Tries every payload flavor we write. */
export function extractDraggedNodeId(event: React.DragEvent): string | null {
  const nativeId = nativeDraggedNodeId();
  if (nativeId) return nativeId;
  try {
    const direct = event.dataTransfer.getData(DRAG_DATA_TYPE);
    if (direct) return direct;
  } catch {
    // Some browsers throw when reading dataTransfer outside drop.
  }

  try {
    const rawPayload = event.dataTransfer.getData("application/json");
    if (rawPayload) {
      const parsed = JSON.parse(rawPayload) as { id?: string };
      if (parsed.id) return parsed.id;
    }
  } catch {
    // Fall through to text/plain.
  }

  try {
    return event.dataTransfer.getData("text/plain") || null;
  } catch {
    return null;
  }
}
