import type { FileNode } from "../types";
import {
  isExcalidrawFileName,
  isExcalidrawWorkspaceFile,
} from "./excalidrawDocument";

export { isExcalidrawWorkspaceFile };

/**
 * Shared file-type predicates keyed off a file name (or path).
 * Consolidated from previously duplicated copies in App.tsx,
 * useFileOperations, useFileSystem, and knowledgeBaseService.
 */

export function isImageFile(name: string): boolean {
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(name);
}

export function isPdfFile(name: string): boolean {
  return /\.pdf$/i.test(name);
}

export function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

export function isMarkdownFile(name: string): boolean {
  // Obsidian drawings use `.excalidraw.md` — treat as Excalidraw, not notes.
  if (isExcalidrawFileName(name)) return false;
  return /\.(md|markdown)$/i.test(name);
}

export function isExcalidrawFile(name: string): boolean {
  return isExcalidrawFileName(name);
}

/**
 * Text documents persisted via the shared autosave / flush pipeline.
 */
export function isSavableDocumentFile(name: string): boolean {
  return isMarkdownFile(name) || isExcalidrawFile(name);
}

/**
 * Files that can be displayed but not edited as markdown.
 */
export function isPreviewOnlyFile(name: string): boolean {
  return isImageFile(name) || isPdfFile(name) || isHtmlFile(name);
}

/**
 * A tree node that can be opened in a tab (markdown, drawing, or preview-only).
 */
export function isOpenableFile(node: FileNode): boolean {
  return (
    node.type === "file" &&
    (isMarkdownFile(node.name) ||
      isExcalidrawFile(node.name) ||
      isPreviewOnlyFile(node.name))
  );
}

/**
 * Whether initial file content should be read eagerly when opening a workspace.
 */
export function shouldReadInitialFileContent(name: string): boolean {
  return isMarkdownFile(name) || isHtmlFile(name) || isExcalidrawFile(name);
}

/**
 * Display name for the rename dialog: strip markdown extensions so users edit
 * the stem, but keep the full name (including extension) for other file types.
 */
export function getRenameDialogDefaultValue(fileName: string): string {
  if (isExcalidrawFile(fileName)) {
    return fileName.replace(/\.excalidraw(?:\.json|\.md)?$/i, "");
  }
  if (/\.(md|markdown)$/i.test(fileName)) {
    return fileName.replace(/\.(md|markdown)$/i, "");
  }
  return fileName;
}

/**
 * Resolve the on-disk file name after a rename dialog submit.
 * Markdown notes keep/restore their `.md` / `.markdown` extension; other files
 * keep their original extension when the user only edits the stem.
 */
export function resolveRenamedFileName(
  oldName: string,
  inputName: string,
): string {
  const trimmed = inputName.trim();
  if (!trimmed) return oldName;

  if (isMarkdownFile(oldName)) {
    if (/\.(md|markdown)$/i.test(trimmed)) return trimmed;
    const oldExt = oldName.match(/\.(md|markdown)$/i)?.[0] ?? ".md";
    return `${trimmed}${oldExt}`;
  }

  if (isExcalidrawFile(oldName)) {
    if (/\.excalidraw(?:\.json|\.md)?$/i.test(trimmed)) return trimmed;
    const oldExt =
      oldName.match(/\.excalidraw(?:\.json|\.md)?$/i)?.[0] ?? ".excalidraw";
    return `${trimmed}${oldExt}`;
  }

  // Non-markdown: if the user typed a stem without a dot, preserve old ext.
  if (!trimmed.includes(".")) {
    const lastDot = oldName.lastIndexOf(".");
    if (lastDot > 0) {
      return `${trimmed}${oldName.slice(lastDot)}`;
    }
  }

  return trimmed;
}
