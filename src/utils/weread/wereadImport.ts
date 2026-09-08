import type { AppSettings, FileNode } from "../../types";
import { getFileSystem } from "../../types/filesystem";
import { getPathDirname } from "../pathHelpers";
import { FileSystemError } from "../errorHandler";
import { notifyVaultFileSaved } from "../../services/vault/linkIndexEvents";
import {
  downloadWereadCover,
  fetchBestBookmarks,
  fetchBookInfo,
  fetchBookmarkList,
  fetchMyReviews,
} from "./wereadApi";
import {
  buildWereadMarkdown,
  coverMarkdownPath,
  mergeWereadMarkdown,
  readWereadBookId,
} from "./wereadMarkdown";
import {
  resolveWereadCoverPath,
  resolveWereadNotePath,
  sanitizeWereadPathSegment,
} from "./wereadPaths";
import type {
  WereadBookInfo,
  WereadConflictMode,
  WereadNotebook,
} from "./wereadTypes";

export interface WereadExistingNote {
  path: string;
  content: string;
}

export interface WereadImportBookResult {
  bookId: string;
  title: string;
  status: "created" | "merged" | "overwritten" | "skipped" | "failed";
  path?: string;
  error?: string;
}

export interface WereadImportRequest {
  notebooks: WereadNotebook[];
  conflictMode: WereadConflictMode;
  saveCover: boolean;
  includeHotHighlights: boolean;
  settings: AppSettings;
  rootFolderPath: string;
  files: FileNode[];
  language: "zh-CN" | "en";
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  createFile: (
    fileName: string,
    content: string,
    folderPath?: string,
  ) => Promise<FileNode | null>;
  now?: Date;
}

function collectMarkdownFiles(
  nodes: FileNode[],
  acc: FileNode[] = [],
): FileNode[] {
  for (const node of nodes) {
    if (node.isTrash) continue;
    if (node.type === "file" && /\.(md|markdown)$/i.test(node.name)) {
      acc.push(node);
    }
    if (node.children) collectMarkdownFiles(node.children, acc);
  }
  return acc;
}

export async function findExistingWereadNote(options: {
  bookId: string;
  title: string;
  preferredPath: string;
  files: FileNode[];
  readFile: (path: string) => Promise<string>;
}): Promise<WereadExistingNote | null> {
  const preferred = options.files.length
    ? collectMarkdownFiles(options.files)
    : [];
  const preferredNode = preferred.find(
    (file) => file.path === options.preferredPath,
  );
  const ordered = preferredNode
    ? [preferredNode, ...preferred.filter((file) => file !== preferredNode)]
    : preferred;

  const titleNeedle = options.title.trim().toLowerCase();

  const tryRead = async (path: string): Promise<WereadExistingNote | null> => {
    try {
      const content = await options.readFile(path);
      const bookId = readWereadBookId(content);
      if (bookId && bookId === options.bookId) {
        return { path, content };
      }
    } catch {
      return null;
    }
    return null;
  };

  const fromPreferred = await tryRead(options.preferredPath);
  if (fromPreferred) return fromPreferred;

  for (const file of ordered) {
    if (file.path === options.preferredPath) continue;
    const nameMatch =
      titleNeedle && file.name.toLowerCase().includes(titleNeedle);
    if (!nameMatch) continue;
    const matched = await tryRead(file.path);
    if (matched) return matched;
  }

  for (const file of ordered) {
    if (file.path === options.preferredPath) continue;
    if (titleNeedle && file.name.toLowerCase().includes(titleNeedle)) continue;
    try {
      const content = await options.readFile(file.path);
      if (!content.includes("weread") && !content.includes(options.bookId)) {
        continue;
      }
      const bookId = readWereadBookId(content);
      if (bookId && bookId === options.bookId) {
        return { path: file.path, content };
      }
    } catch {
      // skip unreadable files
    }
  }

  return null;
}

function mergeBookInfo(
  notebook: WereadNotebook,
  info: WereadBookInfo | null,
): WereadBookInfo {
  return {
    ...(notebook.book ?? {}),
    ...(info ?? {}),
    bookId: info?.bookId || notebook.bookId,
    title: info?.title || notebook.book?.title || notebook.bookId,
    author: info?.author || notebook.book?.author,
    cover: info?.cover || notebook.book?.cover,
    publisher: info?.publisher || notebook.book?.publisher,
    publishTime: info?.publishTime || notebook.book?.publishTime,
    isbn: info?.isbn || notebook.book?.isbn,
    deepLink: info?.deepLink || notebook.deepLink || notebook.book?.deepLink,
  };
}

async function ensureDirectory(path: string): Promise<void> {
  const fs = await getFileSystem();
  await fs.createDirectory(path);
}

async function saveCoverIfNeeded(options: {
  enabled: boolean;
  coverUrl?: string;
  bookId: string;
  notePath: string;
  settings: AppSettings;
  rootFolderPath: string;
}): Promise<string | null> {
  if (!options.enabled) return null;
  const coverUrl = options.coverUrl?.trim();
  if (!coverUrl) return null;
  const { destPath } = resolveWereadCoverPath({
    rootFolderPath: options.rootFolderPath,
    resourceFolder: options.settings.resourceFolder,
    bookId: options.bookId,
  });
  try {
    const savedPath = await downloadWereadCover(coverUrl, destPath);
    return coverMarkdownPath(options.notePath, savedPath);
  } catch (error) {
    console.warn("Failed to download WeRead cover:", error);
    return null;
  }
}

export async function importWereadBook(
  notebook: WereadNotebook,
  request: WereadImportRequest,
): Promise<WereadImportBookResult> {
  const title = notebook.book?.title?.trim() || notebook.bookId;
  const preferred = resolveWereadNotePath({
    rootFolderPath: request.rootFolderPath,
    folder: request.settings.wereadImportFolder,
    mode: request.settings.wereadImportFolderMode,
    title,
    bookId: notebook.bookId,
    author: notebook.book?.author,
    publishTime: notebook.book?.publishTime,
  });

  try {
    const existing = await findExistingWereadNote({
      bookId: notebook.bookId,
      title,
      preferredPath: preferred.filePath,
      files: request.files,
      readFile: request.readFile,
    });

    if (existing && request.conflictMode === "skip") {
      return {
        bookId: notebook.bookId,
        title,
        status: "skipped",
        path: existing.path,
      };
    }

    const [bookmarks, reviews, info] = await Promise.all([
      fetchBookmarkList(notebook.bookId),
      fetchMyReviews(notebook.bookId),
      fetchBookInfo(notebook.bookId).catch(() => null),
    ]);
    const book = mergeBookInfo(notebook, info);
    const hotHighlights = request.includeHotHighlights
      ? await fetchBestBookmarks(notebook.bookId).catch(() => null)
      : null;

    const targetPath = existing?.path ?? preferred.filePath;
    const targetFolder = existing
      ? getPathDirname(existing.path)
      : preferred.folderPath;
    const targetName = existing
      ? existing.path.split(/[\\/]/).pop() || preferred.fileName
      : preferred.fileName;

    if (!existing) {
      await ensureDirectory(preferred.folderPath);
    }

    const coverRelativePath = await saveCoverIfNeeded({
      enabled: request.saveCover,
      coverUrl: book.cover,
      bookId: notebook.bookId,
      notePath: targetPath,
      settings: request.settings,
      rootFolderPath: request.rootFolderPath,
    });

    const generated = {
      bookId: notebook.bookId,
      book,
      bookmarks,
      reviews,
      hotHighlights,
      importedAt: (request.now ?? new Date()).toISOString(),
      coverRelativePath,
      language: request.language,
    };

    let content: string;
    let status: WereadImportBookResult["status"];
    if (existing && request.conflictMode === "merge") {
      content = mergeWereadMarkdown(existing.content, generated);
      await request.writeFile(existing.path, content);
      status = "merged";
    } else if (existing && request.conflictMode === "overwrite") {
      content = buildWereadMarkdown(generated);
      await request.writeFile(existing.path, content);
      status = "overwritten";
    } else {
      content = buildWereadMarkdown(generated);
      try {
        const created = await request.createFile(
          targetName,
          content,
          targetFolder || preferred.folderPath,
        );
        if (!created) {
          await ensureDirectory(preferred.folderPath);
          const fs = await getFileSystem();
          await fs.writeFile(preferred.filePath, content);
        }
      } catch (error) {
        if (error instanceof FileSystemError && error.code === "FILE_EXISTS") {
          const uniqueName = `${sanitizeUniqueName(title, notebook.bookId)}.md`;
          const created = await request.createFile(
            uniqueName,
            content,
            preferred.folderPath,
          );
          if (created?.path) {
            notifyVaultFileSaved(created.path, content);
            return {
              bookId: notebook.bookId,
              title,
              status: "created",
              path: created.path,
            };
          }
        }
        throw error;
      }
      status = "created";
    }

    const writtenPath = existing?.path ?? preferred.filePath;
    notifyVaultFileSaved(writtenPath, content);
    return {
      bookId: notebook.bookId,
      title,
      status,
      path: writtenPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      bookId: notebook.bookId,
      title,
      status: "failed",
      error: message,
    };
  }
}

export async function importWereadBooks(
  request: WereadImportRequest,
): Promise<WereadImportBookResult[]> {
  const results: WereadImportBookResult[] = [];
  for (const notebook of request.notebooks) {
    results.push(await importWereadBook(notebook, request));
  }
  return results;
}

function sanitizeUniqueName(title: string, bookId: string): string {
  return `${sanitizeWereadPathSegment(title, bookId)}-${sanitizeWereadPathSegment(bookId, "id").slice(0, 8)}`;
}
