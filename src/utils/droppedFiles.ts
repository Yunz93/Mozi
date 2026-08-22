import type React from "react";
import { getPathBasename } from "./pathHelpers";

const SKIPPED_DROP_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export function dataTransferTypes(event: React.DragEvent): string[] {
  const types = event.dataTransfer.types;
  if (!types) return [];
  return Array.from(types as ArrayLike<string>);
}

/**
 * OS / Finder / Explorer file drags advertise a `Files` type during dragover,
 * where `dataTransfer.files` is still empty.
 */
export function hasExternalFilePayload(event: React.DragEvent): boolean {
  const types = dataTransferTypes(event);
  return types.includes("Files") || types.includes("application/x-moz-file");
}

export type SidebarDropIntent = "import-files" | "move-node" | null;

/**
 * OS file drags often also advertise `text/plain`. Prefer importing files
 * whenever a `Files` payload is present so Finder/Explorer drops are not
 * mistaken for an in-tree move.
 */
export function resolveSidebarDropIntent(
  event: React.DragEvent,
  hasInternalPayload: boolean,
): SidebarDropIntent {
  if (hasExternalFilePayload(event)) return "import-files";
  if (hasInternalPayload) return "move-node";
  return null;
}

export function extractDroppedFiles(event: React.DragEvent): File[] {
  const listed = event.dataTransfer.files;
  if (listed && listed.length > 0) {
    return Array.from(listed);
  }

  const items = event.dataTransfer.items;
  if (!items?.length) return [];

  return Array.from(items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

export function isSkippedDropName(name: string): boolean {
  const base = getPathBasename(name).trim();
  if (!base || base === "." || base === "..") return true;
  if (base.startsWith("._")) return true;
  return SKIPPED_DROP_NAMES.has(base.toLowerCase());
}

export function sanitizeDroppedFileName(name: string): string | null {
  const cleaned = getPathBasename(name)
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim();

  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  if (isSkippedDropName(cleaned)) return null;
  return cleaned;
}

export function droppedFileRelativePath(file: File): string {
  const relative = (
    file as File & { webkitRelativePath?: string }
  ).webkitRelativePath?.trim();
  if (relative && relative.includes("/")) {
    return relative.replace(/\\/g, "/");
  }
  return file.name;
}

export function sanitizeDroppedRelativePath(
  relativePath: string,
): string[] | null {
  const segments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const sanitized: string[] = [];
  for (const segment of segments) {
    const next = sanitizeDroppedFileName(segment);
    if (!next) return null;
    sanitized.push(next);
  }
  return sanitized;
}

export function nextAvailableFileName(
  desired: string,
  taken: Set<string>,
): string {
  const key = (value: string) => value.toLocaleLowerCase();
  if (!taken.has(key(desired))) {
    return desired;
  }

  const lastDot = desired.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < desired.length - 1;
  const stem = hasExt ? desired.slice(0, lastDot) : desired;
  const ext = hasExt ? desired.slice(lastDot) : "";

  let index = 1;
  let candidate = `${stem} (${index})${ext}`;
  while (taken.has(key(candidate))) {
    index += 1;
    candidate = `${stem} (${index})${ext}`;
  }
  return candidate;
}
