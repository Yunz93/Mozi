import type { WereadImportFolderMode } from "../../types";
import { joinFsPath, sanitizeResourceFolder } from "../pathHelpers";

export function sanitizeWereadPathSegment(
  input: string,
  fallback: string,
): string {
  const sanitized = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return sanitized || fallback;
}

export function extractPublishYear(
  publishTime: string | number | undefined,
): string | null {
  if (typeof publishTime === "number" && Number.isFinite(publishTime)) {
    const millis = publishTime > 1e12 ? publishTime : publishTime * 1000;
    const year = new Date(millis).getUTCFullYear();
    if (year >= 1900 && year <= 2100) return String(year);
  }
  const match = String(publishTime ?? "").match(/(?:19|20)\d{2}/);
  return match?.[0] ?? null;
}

export function wereadNoteFileName(title: string, bookId: string): string {
  const base = sanitizeWereadPathSegment(title, bookId || "untitled");
  return `${base}.md`;
}

export function resolveWereadImportFolderSegments(options: {
  folder: string;
  mode: WereadImportFolderMode;
  author?: string;
  publishTime?: string | number;
}): string[] {
  let base = "读书";
  try {
    const sanitized = sanitizeResourceFolder(options.folder || "读书");
    if (sanitized) base = sanitized;
  } catch {
    base = "读书";
  }

  const segments = base.split("/").filter(Boolean);
  const author = sanitizeWereadPathSegment(options.author ?? "", "未知作者");
  const year = extractPublishYear(options.publishTime) ?? "未知年份";

  if (options.mode === "author" || options.mode === "authorYear") {
    segments.push(author);
  }
  if (options.mode === "year" || options.mode === "authorYear") {
    segments.push(year);
  }
  return segments;
}

export function resolveWereadNotePath(options: {
  rootFolderPath: string;
  folder: string;
  mode: WereadImportFolderMode;
  title: string;
  bookId: string;
  author?: string;
  publishTime?: string | number;
}): { folderPath: string; fileName: string; filePath: string } {
  const segments = resolveWereadImportFolderSegments(options);
  const folderPath = joinFsPath(options.rootFolderPath, ...segments);
  const fileName = wereadNoteFileName(options.title, options.bookId);
  return {
    folderPath,
    fileName,
    filePath: joinFsPath(folderPath, fileName),
  };
}

export function resolveWereadCoverPath(options: {
  rootFolderPath: string;
  resourceFolder: string;
  bookId: string;
}): { folderPath: string; destPath: string } {
  let resource = "resources";
  try {
    const sanitized = sanitizeResourceFolder(
      options.resourceFolder || "resources",
    );
    if (sanitized) resource = sanitized;
  } catch {
    resource = "resources";
  }
  const folderPath = joinFsPath(
    options.rootFolderPath,
    ...resource.split("/").filter(Boolean),
    "weread-covers",
  );
  const destPath = joinFsPath(
    folderPath,
    `${sanitizeWereadPathSegment(options.bookId, "cover")}.jpg`,
  );
  return { folderPath, destPath };
}
