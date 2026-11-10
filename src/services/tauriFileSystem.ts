import {
  nativeWatchEnabled,
  startNativeWatch,
  withinWatchPath,
  watchPath,
} from "./filesystem/nativeWatchClient";
import { reconcileWatchTree } from "./filesystem/reconcileWatchTree";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  readFile as readBinaryFile,
  writeTextFile,
  writeFile,
  exists,
  mkdir,
  readDir,
  rename,
  remove,
} from "@tauri-apps/plugin-fs";
import { basename, dirname, join, sep } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode } from "../types";
import type {
  FileWatchEvent,
  DirectoryWatchEvent,
  IFileSystem,
  FileEntryMetadata,
} from "../types/filesystem";
import { useAppStore } from "../store/appStore";
import { sanitizeTrashFolder } from "../utils/trashFolder";
import { buildFileTreeSignature } from "../utils/fileTree";
import { isFileNotFoundError } from "./filesystem/fileWatchErrors";
import { FILE_IMPORT_CHUNK_BYTES } from "../utils/droppedFiles";
import {
  createEncodingUnsupportedError,
  decodeTextFileBytes,
} from "./filesystem/textFileEncoding";

/**
 * Supported file extensions
 */
const MARKDOWN_EXTENSIONS = [".md", ".markdown"];
const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
];
const DOCUMENT_EXTENSIONS = [".pdf"];
const HTML_EXTENSIONS = [".html", ".htm"];
const CONFIG_EXTENSIONS = [".json", ".yaml", ".yml", ".toml"];
const IMPORT_TEMP_FILE_PATTERN =
  /^mozi-import-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;
type LineEnding = "\n" | "\r\n";

interface FileFormatState {
  lineEnding: LineEnding;
  hasBom: boolean;
  lastContent: string;
  lastWrite?: { content: string };
}

interface CopySampleNotesResult {
  updated: boolean;
  copiedFiles: string[];
  skippedFiles: string[];
}

/**
 * Pure Tauri FileSystem implementation
 * Uses native Tauri FS and Dialog plugins for all file operations
 */
export class TauriFileSystem implements IFileSystem {
  async fileMetadata(
    paths: string[],
  ): Promise<Record<string, FileEntryMetadata>> {
    return invoke("sidebar_file_metadata", { paths });
  }
  private static instance: TauriFileSystem;
  private showHiddenFiles: boolean = false;
  private showImages: boolean = true;
  private showConfigFiles: boolean = false;
  private fileFormatStates: Map<string, FileFormatState> = new Map();
  private objectUrls: Map<string, string> = new Map();
  private nonUtf8Paths: Set<string> = new Set();

  private getMimeType(path: string): string {
    const normalized = path.toLowerCase();
    if (normalized.endsWith(".png")) return "image/png";
    if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg"))
      return "image/jpeg";
    if (normalized.endsWith(".gif")) return "image/gif";
    if (normalized.endsWith(".webp")) return "image/webp";
    if (normalized.endsWith(".svg")) return "image/svg+xml";
    if (normalized.endsWith(".bmp")) return "image/bmp";
    if (normalized.endsWith(".avif")) return "image/avif";
    if (normalized.endsWith(".pdf")) return "application/pdf";
    return "application/octet-stream";
  }

  private invalidateObjectUrl(path: string): void {
    const cached = this.objectUrls.get(path);
    if (cached) {
      URL.revokeObjectURL(cached);
      this.objectUrls.delete(path);
    }
    void import("../utils/previewImageCache")
      .then(({ invalidateCachedPreviewImageSrc }) => {
        invalidateCachedPreviewImageSrc(path);
      })
      .catch(() => {
        // Preview cache module may be unavailable in non-UI contexts.
      });
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      await readDir(path);
      return true;
    } catch {
      return false;
    }
  }

  async registerAllowedPath(path: string, recursive: boolean): Promise<void> {
    await invoke("register_allowed_path", { path, recursive });
  }

  static getInstance(): TauriFileSystem {
    if (!TauriFileSystem.instance) {
      TauriFileSystem.instance = new TauriFileSystem();
      if (typeof window !== "undefined") {
        window.addEventListener("beforeunload", () => {
          TauriFileSystem.instance.revokeAllObjectUrls();
        });
      }
    }
    return TauriFileSystem.instance;
  }

  private revokeAllObjectUrls(): void {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }

  /**
   * Configure which files to show
   */
  setDisplayOptions(options: {
    showHidden?: boolean;
    showImages?: boolean;
    showConfigFiles?: boolean;
  }): void {
    if (options.showHidden !== undefined)
      this.showHiddenFiles = options.showHidden;
    if (options.showImages !== undefined) this.showImages = options.showImages;
    if (options.showConfigFiles !== undefined)
      this.showConfigFiles = options.showConfigFiles;
  }

  private captureFileFormat(
    path: string,
    raw: string,
    written = false,
  ): string {
    const hasBom = raw.startsWith("\uFEFF");
    const content = hasBom ? raw.slice(1) : raw;
    const lineEnding: LineEnding = content.includes("\r\n") ? "\r\n" : "\n";

    this.fileFormatStates.set(path, {
      lineEnding,
      hasBom,
      lastContent: content,
      lastWrite: written
        ? { content }
        : this.fileFormatStates.get(path)?.lastWrite,
    });

    return content;
  }

  private prepareContentForWrite(path: string, content: string): string {
    const format = this.fileFormatStates.get(path);
    const defaultLineEnding: LineEnding =
      typeof navigator !== "undefined" &&
      navigator.platform.toLowerCase().includes("win")
        ? "\r\n"
        : content.includes("\r\n")
          ? "\r\n"
          : "\n";
    const targetLineEnding = format?.lineEnding ?? defaultLineEnding;
    let normalized = content;

    if (targetLineEnding === "\r\n") {
      // Skip full-doc rewrite when there are no bare LFs left to convert.
      if (/(?<!\r)\n/.test(normalized)) {
        normalized = normalized.replace(/\r?\n/g, "\r\n");
      }
    } else if (normalized.includes("\r\n")) {
      normalized = normalized.replace(/\r\n/g, "\n");
    }

    if (format?.hasBom) {
      if (!normalized.startsWith("\uFEFF")) {
        normalized = `\uFEFF${normalized}`;
      }
    } else if (normalized.startsWith("\uFEFF")) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }

  /**
   * Open a single markdown file
   */
  async openFile(): Promise<string | null> {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      const path = (selected as string) || null;
      if (path) {
        await this.registerAllowedPath(path, false);
      }
      return path;
    } catch (error) {
      console.error("Failed to open file:", error);
      return null;
    }
  }

  /**
   * Open a directory and return the path
   */
  async openDirectory(): Promise<string | null> {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        recursive: true,
      });
      const path = (selected as string) || null;
      if (path) {
        await this.registerAllowedPath(path, true);
      }
      return path;
    } catch (error) {
      console.error("Failed to open directory:", error);
      return null;
    }
  }

  isNonUtf8Path(path: string): boolean {
    return this.nonUtf8Paths.has(path);
  }

  private rememberDecodedText(path: string, bytes: Uint8Array): string {
    const { text, isUtf8 } = decodeTextFileBytes(bytes);
    if (isUtf8) {
      this.nonUtf8Paths.delete(path);
    } else {
      this.nonUtf8Paths.add(path);
    }
    return this.captureFileFormat(path, text);
  }

  /**
   * Read a text file
   */
  async readFile(path: string): Promise<string> {
    try {
      const bytes = await readBinaryFile(path);
      return this.rememberDecodedText(path, bytes);
    } catch (error) {
      console.error(`Failed to read file ${path}:`, error);
      throw error;
    }
  }

  async readFileUncached(path: string): Promise<string> {
    const { text } = decodeTextFileBytes(await readBinaryFile(path));
    return text.replace(/^\uFEFF/, "");
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    try {
      return await readBinaryFile(path);
    } catch (error) {
      console.error(`Failed to read binary file ${path}:`, error);
      throw error;
    }
  }

  /**
   * Write content to a file
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (this.nonUtf8Paths.has(path)) {
      throw createEncodingUnsupportedError(path);
    }
    const prepared = this.prepareContentForWrite(path, content);
    await invoke("write_text_file_atomic", { path, content: prepared });
    this.captureFileFormat(path, prepared, true);
    this.invalidateObjectUrl(path);
  }

  async writeFileIfUnchanged(
    path: string,
    content: string,
    expectedContent: string,
  ): Promise<boolean> {
    if (this.nonUtf8Paths.has(path)) {
      throw createEncodingUnsupportedError(path);
    }
    const prepared = this.prepareContentForWrite(path, content);
    const written = await invoke<boolean>("write_text_file_atomic", {
      path,
      content: prepared,
      expectedContent,
    });
    if (written) {
      this.captureFileFormat(path, prepared, true);
      this.invalidateObjectUrl(path);
    }
    return written;
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    try {
      await writeFile(path, content);
      this.invalidateObjectUrl(path);
    } catch (error) {
      console.error(`Failed to write binary file ${path}:`, error);
      throw error;
    }
  }

  async writeBlobFile(path: string, content: Blob): Promise<void> {
    // 复用已授权的目标目录，避免隐藏文件的额外权限随导入次数累积。
    const temporary = await join(
      await dirname(path),
      `mozi-import-${crypto.randomUUID()}.tmp`,
    );
    // 临时文件不进入侧边栏和 Markdown 索引，完整写入后才发布到目标位置。
    let created = false;
    try {
      await writeFile(temporary, new Uint8Array(), {
        create: true,
        createNew: true,
      });
      created = true;
      for (
        let offset = 0;
        offset < content.size;
        offset += FILE_IMPORT_CHUNK_BYTES
      ) {
        const bytes = new Uint8Array(
          await content
            .slice(offset, offset + FILE_IMPORT_CHUNK_BYTES)
            .arrayBuffer(),
        );
        await writeFile(temporary, bytes, { append: true, create: false });
      }
      if (await exists(path))
        throw new Error("Import destination already exists.");
      await rename(temporary, path);
      created = false;
      this.invalidateObjectUrl(path);
    } finally {
      if (created)
        await remove(temporary).catch((error) =>
          console.warn("清理未完成的导入文件失败：", error),
        );
    }
  }

  /**
   * Save file - shows save dialog if path is null
   */
  async saveFile(path: string | null, content: string): Promise<string | null> {
    try {
      if (path && this.nonUtf8Paths.has(path)) {
        throw createEncodingUnsupportedError(path);
      }
      if (!path) {
        const savePath = await save({
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (savePath) {
          const prepared = this.prepareContentForWrite(savePath, content);
          await writeTextFile(savePath, prepared);
          this.captureFileFormat(savePath, prepared, true);
          this.invalidateObjectUrl(savePath);
          await this.registerAllowedPath(savePath, false);
          return savePath;
        }
        return null;
      }
      const prepared = this.prepareContentForWrite(path, content);
      await writeTextFile(path, prepared);
      this.captureFileFormat(path, prepared, true);
      this.invalidateObjectUrl(path);
      return path;
    } catch (error) {
      console.error("Failed to save file:", error);
      throw error;
    }
  }

  /**
   * Rename a file
   */
  async renameFile(oldPath: string, newName: string): Promise<string> {
    try {
      const dir = await dirname(oldPath);
      // Callers pass the final basename (including the correct extension).
      // Do not force `.md` here — that breaks HTML/PDF/image renames.
      const baseName = newName.trim() || (await basename(oldPath));
      const newPath = await join(dir, baseName);
      await rename(oldPath, newPath);
      const format = this.fileFormatStates.get(oldPath);
      if (format) {
        this.fileFormatStates.set(newPath, format);
        this.fileFormatStates.delete(oldPath);
      }
      if (this.nonUtf8Paths.has(oldPath)) {
        this.nonUtf8Paths.add(newPath);
        this.nonUtf8Paths.delete(oldPath);
      }
      this.invalidateObjectUrl(oldPath);
      this.invalidateObjectUrl(newPath);
      return newPath;
    } catch (error) {
      console.error("Failed to rename file:", error);
      throw error;
    }
  }

  async renameEntry(
    oldPath: string,
    newName: string,
    isDirectory: boolean,
  ): Promise<string> {
    try {
      if (!isDirectory) {
        return await this.renameFile(oldPath, newName);
      }

      const dir = await dirname(oldPath);
      const newPath = await join(dir, newName);
      await rename(oldPath, newPath);
      return newPath;
    } catch (error) {
      console.error("Failed to rename entry:", error);
      throw error;
    }
  }

  /**
   * Move a file to a new location
   */
  async moveFile(sourcePath: string, targetPath: string): Promise<string> {
    try {
      const fileName = await basename(sourcePath);
      const destPath = await join(targetPath, fileName);
      await rename(sourcePath, destPath);
      const format = this.fileFormatStates.get(sourcePath);
      if (format) {
        this.fileFormatStates.set(destPath, format);
        this.fileFormatStates.delete(sourcePath);
      }
      if (this.nonUtf8Paths.has(sourcePath)) {
        this.nonUtf8Paths.add(destPath);
        this.nonUtf8Paths.delete(sourcePath);
      }
      this.invalidateObjectUrl(sourcePath);
      this.invalidateObjectUrl(destPath);
      return destPath;
    } catch (error) {
      console.error("Failed to move file:", error);
      throw error;
    }
  }

  /**
   * Delete a file or directory
   */
  async deleteFile(path: string): Promise<void> {
    try {
      await invoke("delete_path_recursively", { path });
      this.fileFormatStates.delete(path);
      this.nonUtf8Paths.delete(path);
      this.invalidateObjectUrl(path);
    } catch (error) {
      console.error("Failed to delete file:", error);
      throw error;
    }
  }

  /**
   * Reveal file in system explorer
   */
  async revealInExplorer(path: string): Promise<void> {
    try {
      await invoke("reveal_in_explorer", { path });
    } catch (error) {
      console.error("Failed to reveal in explorer:", error);
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      return await exists(path);
    } catch (error) {
      console.error(`Failed to check if file exists ${path}:`, error);
      return false;
    }
  }

  async getFileObjectUrl(path: string): Promise<string> {
    const cached = this.objectUrls.get(path);
    if (cached) {
      return cached;
    }

    const bytes = await readBinaryFile(path);
    const objectUrl = URL.createObjectURL(
      new Blob([bytes], { type: this.getMimeType(path) }),
    );
    this.objectUrls.set(path, objectUrl);
    return objectUrl;
  }

  async refreshFileObjectUrl(path: string): Promise<string> {
    this.invalidateObjectUrl(path);
    return this.getFileObjectUrl(path);
  }

  /**
   * Recursively read directory and return file nodes
   */
  async readDirectory(
    dirPath: string,
    rootPath: string = dirPath,
    inTrash: boolean = false,
    reuseChildren?: FileNode[],
    strict: boolean = false,
  ): Promise<FileNode[]> {
    try {
      const entries = await readDir(dirPath);
      // Normalize once through the native path API; entry names are native leaf
      // names from readDir, so appending them needs no per-file IPC. In
      // particular, a backslash in a POSIX filename must remain a literal.
      const separator = sep();
      const base = await join(dirPath);
      const prefix = base.endsWith(separator) ? base : `${base}${separator}`;
      const reusableFolders = new Map(
        reuseChildren
          ?.filter((node) => node.type === "folder")
          .map((node) => [watchPath(node.path), node]),
      );
      const nodes: FileNode[] = [];
      const normalizedDirPath = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
      const normalizedRootPath = rootPath
        .replace(/\\/g, "/")
        .replace(/\/+$/, "");
      const isAtRoot = normalizedDirPath === normalizedRootPath;
      const trashFolder = sanitizeTrashFolder(
        useAppStore.getState().settings.trashFolder,
      );

      for (const entry of entries) {
        if (!entry.name || entry.isSymlink) continue;
        // 保留普通附件，仅隐藏本软件导入流程的随机临时文件。
        if (!entry.isDirectory && IMPORT_TEMP_FILE_PATTERN.test(entry.name))
          continue;
        const isTrashDirectory =
          entry.isDirectory && isAtRoot && entry.name === trashFolder;
        const nodeInTrash = inTrash || isTrashDirectory;
        if (
          !this.showHiddenFiles &&
          entry.name.startsWith(".") &&
          !isTrashDirectory &&
          !inTrash
        )
          continue;

        const fullPath = `${prefix}${entry.name}`;
        const ext = entry.name.toLowerCase();

        if (entry.isDirectory) {
          const existing = reusableFolders.get(watchPath(fullPath));
          const children =
            existing?.children ??
            (await this.readDirectory(
              fullPath,
              rootPath,
              nodeInTrash,
              undefined,
              strict,
            ));
          nodes.push({
            id: fullPath,
            name: entry.name,
            type: "folder",
            path: fullPath,
            children,
            isTrash: nodeInTrash,
          });
        } else {
          const isKnownVisibleFile =
            MARKDOWN_EXTENSIONS.some((e) => ext.endsWith(e)) ||
            (this.showImages &&
              IMAGE_EXTENSIONS.some((e) => ext.endsWith(e))) ||
            DOCUMENT_EXTENSIONS.some((e) => ext.endsWith(e)) ||
            HTML_EXTENSIONS.some((e) => ext.endsWith(e)) ||
            (this.showConfigFiles &&
              CONFIG_EXTENSIONS.some((e) => ext.endsWith(e)));
          const isGenericAttachment = !entry.name.startsWith(".");
          const shouldIncludeFile =
            nodeInTrash || isKnownVisibleFile || isGenericAttachment;

          if (!shouldIncludeFile) continue;
          nodes.push({
            id: fullPath,
            name: entry.name,
            type: "file",
            path: fullPath,
            isTrash: nodeInTrash,
          });
        }
      }
      return nodes;
    } catch (error) {
      console.error(`Failed to read directory ${dirPath}:`, error);
      const normalizedDir = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
      const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
      if (strict || normalizedDir === normalizedRoot) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Create a new file
   */
  async createFile(path: string, content: string = ""): Promise<string> {
    try {
      const prepared = this.prepareContentForWrite(path, content);
      await writeTextFile(path, prepared, { createNew: true });
      this.captureFileFormat(path, prepared, true);
      return path;
    } catch (error) {
      console.error("Failed to create file:", error);
      throw error;
    }
  }

  /**
   * Create a new directory
   */
  async createDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true });
    } catch (error) {
      if ((await exists(path)) && (await this.isDirectory(path))) {
        return;
      }
      console.error("Failed to create directory:", error);
      throw error;
    }
  }

  /**
   * Copy sample notes from bundled resources to target directory
   */
  async copySampleNotes(targetDir: string): Promise<boolean> {
    try {
      const result = await invoke<CopySampleNotesResult>("copy_sample_notes", {
        targetDir,
      });

      if (result.skippedFiles.length > 0) {
        console.info(
          "Skipped sample notes with local edits:",
          result.skippedFiles,
        );
      }

      return result.updated;
    } catch (error) {
      console.error("Failed to copy sample notes:", error);
      throw error;
    }
  }

  /**
   * Listen to file system events
   */
  private createWatchContentReader(path: string) {
    let previous = this.fileFormatStates.get(path)?.lastContent;
    let knownWrite = this.fileFormatStates.get(path)?.lastWrite;
    return async (active: () => boolean): Promise<boolean> => {
      const writeBefore = this.fileFormatStates.get(path)?.lastWrite;
      const bytes = await readBinaryFile(path);
      if (!active()) return false;
      const writeAfter = this.fileFormatStates.get(path)?.lastWrite;
      if (writeAfter !== writeBefore) {
        // The read may predate a concurrent save. Its native event/next poll
        // will reconcile the current disk state without applying stale bytes.
        previous = writeAfter?.content ?? previous;
        knownWrite = writeAfter;
        return false;
      }
      if (writeAfter !== knownWrite && writeAfter)
        previous = writeAfter.content;
      knownWrite = writeAfter;
      const current = this.rememberDecodedText(path, bytes);
      const changed = previous !== undefined && current !== previous;
      previous = current;
      return changed;
    };
  }

  async watchFile(
    path: string,
    callback: (event: FileWatchEvent | null) => void,
  ): Promise<() => void> {
    if (!(await nativeWatchEnabled()))
      return this.watchFilePolling(path, callback);
    const root = useAppStore.getState().rootFolderPath;
    const directory = !!root && withinWatchPath(path, root);
    const readContent = this.createWatchContentReader(path);
    const check = async ({ active }: { active: () => boolean }) => {
      try {
        if (await readContent(active)) callback({ path, type: "modified" });
      } catch (error) {
        if (!active()) return;
        if (isFileNotFoundError(error)) {
          callback({ path, type: "deleted" });
          return false;
        }
        // Sharing violations and interrupted reads enter the retrying legacy
        // watcher, so a one-shot native event cannot leave stale content forever.
        throw error;
      }
    };
    return startNativeWatch({
      path: directory ? root! : path,
      directory,
      snapshot: check,
      batch: async (changes, context) => {
        if (
          changes.some(
            (change) =>
              watchPath(change.path) === watchPath(path) ||
              (change.kind !== "modified" &&
                withinWatchPath(path, change.path)) ||
              (change.oldPath && withinWatchPath(path, change.oldPath)),
          )
        )
          return check(context);
      },
      fallback: () => this.watchFilePolling(path, callback),
    });
  }

  async watchDirectory(
    dirPath: string,
    callback: (event: DirectoryWatchEvent) => void,
  ): Promise<() => void> {
    if (!(await nativeWatchEnabled()))
      return this.watchDirectoryPolling(dirPath, callback);
    let tree: FileNode[] = [];
    let initialized = false;
    return startNativeWatch({
      path: dirPath,
      directory: true,
      snapshot: async ({ active }) => {
        const next = await this.readDirectory(
          dirPath,
          dirPath,
          false,
          undefined,
          true,
        );
        if (!active()) return;
        tree = next;
        callback({ type: "changed", tree, rescan: initialized });
        initialized = true;
      },
      batch: async (changes, { active }) => {
        const trash = sanitizeTrashFolder(
          useAppStore.getState().settings.trashFolder,
        );
        const visible = (path: string, isDirectory: boolean) => {
          const parts = watchPath(path)
            .slice(watchPath(dirPath).length)
            .split("/")
            .filter(Boolean);
          // 分块写入的临时文件不触发结构重扫，发布后的最终路径仍正常处理。
          if (!isDirectory && IMPORT_TEMP_FILE_PATTERN.test(parts.at(-1) ?? ""))
            return false;
          if (this.showHiddenFiles) return true;
          return (
            parts[0] === trash || !parts.some((part) => part.startsWith("."))
          );
        };
        const result = await reconcileWatchTree(
          tree,
          dirPath,
          changes.filter(
            (change) =>
              visible(change.path, change.isDirectory) ||
              (change.oldPath && visible(change.oldPath, change.isDirectory)),
          ),
          (parent, previous) => {
            const trash = sanitizeTrashFolder(
              useAppStore.getState().settings.trashFolder,
            );
            const inTrash = withinWatchPath(
              parent,
              `${watchPath(dirPath)}/${trash}`,
            );
            return this.readDirectory(parent, dirPath, inTrash, previous, true);
          },
        );
        if (!active()) return;
        tree = result.tree;
        if (result.structural) callback({ type: "changed", tree });
        if (result.modified.length)
          callback({ type: "modified", paths: result.modified });
      },
      fallback: () => this.watchDirectoryPolling(dirPath, callback, true),
    });
  }

  private async watchFilePolling(
    path: string,
    callback: (event: FileWatchEvent | null) => void,
  ): Promise<() => void> {
    try {
      // Chain polls with setTimeout so a slow read of a large file can never
      // overlap the next poll.
      const POLL_INTERVAL_MS = 1500;
      let disposed = false;
      let timer: number | null = null;
      const readContent = this.createWatchContentReader(path);
      try {
        if (await readContent(() => !disposed))
          callback({ path, type: "modified" });
      } catch {
        // The retry loop below handles missing or temporarily locked files.
      }

      const scheduleNext = () => {
        if (disposed) return;
        timer = window.setTimeout(runPoll, POLL_INTERVAL_MS);
      };

      const runPoll = async () => {
        if (disposed) return;
        try {
          if (await readContent(() => !disposed))
            callback({ path, type: "modified" });
        } catch (error) {
          if (disposed) return;
          const message =
            error instanceof Error
              ? error.message.toLowerCase()
              : String(error).toLowerCase();
          if (isFileNotFoundError(error)) {
            callback({ path, type: "deleted" });
            disposed = true;
            return;
          }
          // Windows often returns transient sharing/access errors while the file is being deleted or replaced; skip one poll instead of surfacing "watch failed".
          const isTransientRead =
            message.includes("access") ||
            message.includes("denied") ||
            message.includes("busy") ||
            message.includes("sharing") ||
            message.includes("being used") ||
            message.includes("resource temporarily unavailable") ||
            message.includes("interrupted") ||
            message.includes("os error 32");
          if (!isTransientRead) {
            callback({ path, type: "error", error });
          }
        } finally {
          scheduleNext();
        }
      };

      scheduleNext();

      return () => {
        disposed = true;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      };
    } catch (error) {
      console.error("Failed to watch file:", error);
      return () => {};
    }
  }

  /**
   * Poll the knowledge base directory and emit when the visible tree changes.
   *
   * Scans are chained with setTimeout instead of setInterval so a slow scan
   * of a large tree can never overlap the next one, and the polling interval
   * backs off proportionally to how long the scan actually took.
   */
  private async watchDirectoryPolling(
    dirPath: string,
    callback: (event: DirectoryWatchEvent) => void,
    reconcileInitial = false,
  ): Promise<() => void> {
    const BASE_INTERVAL_MS = 2000;
    // Never spend more than ~1/4 of wall-clock time scanning large trees.
    const SCAN_BACKOFF_FACTOR = 4;

    try {
      let previousSignature = "";
      let pendingSnapshot = reconcileInitial;
      let disposed = false;
      let timer: number | null = null;

      try {
        const initialTree = await this.readDirectory(
          dirPath,
          dirPath,
          false,
          undefined,
          reconcileInitial,
        );
        previousSignature = buildFileTreeSignature(initialTree);
        if (pendingSnapshot) {
          pendingSnapshot = false;
          callback({ type: "changed", tree: initialTree, rescan: true });
        }
      } catch {
        previousSignature = "";
      }

      const scheduleNext = (delayMs: number) => {
        if (disposed) return;
        timer = window.setTimeout(runScan, delayMs);
      };

      const runScan = async () => {
        if (disposed) return;
        const startedAt = Date.now();
        try {
          const currentTree = await this.readDirectory(
            dirPath,
            dirPath,
            false,
            undefined,
            reconcileInitial,
          );
          if (disposed) return;

          const signature = buildFileTreeSignature(currentTree);
          if (pendingSnapshot || signature !== previousSignature) {
            previousSignature = signature;
            const rescan = pendingSnapshot;
            pendingSnapshot = false;
            callback({
              type: "changed",
              tree: currentTree,
              ...(rescan ? { rescan: true } : {}),
            });
          }
        } catch (error) {
          if (!disposed) {
            callback({ type: "error", error });
          }
        } finally {
          const scanDuration = Date.now() - startedAt;
          scheduleNext(
            Math.max(BASE_INTERVAL_MS, scanDuration * SCAN_BACKOFF_FACTOR),
          );
        }
      };

      scheduleNext(BASE_INTERVAL_MS);

      return () => {
        disposed = true;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      };
    } catch (error) {
      console.error("Failed to watch directory:", error);
      return () => {};
    }
  }
}

// Export singleton instance for convenience
export const fileSystem = TauriFileSystem.getInstance();
