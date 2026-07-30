import { open, save } from "@tauri-apps/plugin-dialog";
import {
  readTextFile,
  readFile as readBinaryFile,
  writeTextFile,
  writeFile,
  exists,
  mkdir,
  readDir,
  rename,
  remove,
} from "@tauri-apps/plugin-fs";
import { basename, dirname, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode } from "../types";
import type {
  FileWatchEvent,
  DirectoryWatchEvent,
  IFileSystem,
} from "../types/filesystem";
import { useAppStore } from "../store/appStore";
import { sanitizeTrashFolder } from "../utils/trashFolder";
import { buildFileTreeSignature } from "../utils/fileTree";

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
type LineEnding = "\n" | "\r\n";

interface FileFormatState {
  lineEnding: LineEnding;
  hasBom: boolean;
  lastContent: string;
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
  private static instance: TauriFileSystem;
  private showHiddenFiles: boolean = false;
  private showImages: boolean = true;
  private showConfigFiles: boolean = false;
  private fileFormatStates: Map<string, FileFormatState> = new Map();
  private objectUrls: Map<string, string> = new Map();

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

  private captureFileFormat(path: string, raw: string): string {
    const hasBom = raw.startsWith("\uFEFF");
    const content = hasBom ? raw.slice(1) : raw;
    const lineEnding: LineEnding = content.includes("\r\n") ? "\r\n" : "\n";

    this.fileFormatStates.set(path, {
      lineEnding,
      hasBom,
      lastContent: content,
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

  /**
   * Read a text file
   */
  async readFile(path: string): Promise<string> {
    try {
      const raw = await readTextFile(path);
      return this.captureFileFormat(path, raw);
    } catch (error) {
      console.error(`Failed to read file ${path}:`, error);
      throw error;
    }
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
    try {
      const prepared = this.prepareContentForWrite(path, content);
      await writeTextFile(path, prepared);
      this.captureFileFormat(path, prepared);
      this.invalidateObjectUrl(path);
    } catch (error) {
      console.error(`Failed to write file ${path}:`, error);
      throw error;
    }
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

  /**
   * Save file - shows save dialog if path is null
   */
  async saveFile(path: string | null, content: string): Promise<string | null> {
    try {
      if (!path) {
        const savePath = await save({
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (savePath) {
          const prepared = this.prepareContentForWrite(savePath, content);
          await writeTextFile(savePath, prepared);
          this.captureFileFormat(savePath, prepared);
          this.invalidateObjectUrl(savePath);
          await this.registerAllowedPath(savePath, false);
          return savePath;
        }
        return null;
      }
      const prepared = this.prepareContentForWrite(path, content);
      await writeTextFile(path, prepared);
      this.captureFileFormat(path, prepared);
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

  /**
   * Recursively read directory and return file nodes
   */
  async readDirectory(
    dirPath: string,
    rootPath: string = dirPath,
    inTrash: boolean = false,
  ): Promise<FileNode[]> {
    try {
      const entries = await readDir(dirPath);
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
        if (!entry.name) continue;
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

        const fullPath = await join(dirPath, entry.name);
        const ext = entry.name.toLowerCase();

        if (entry.isDirectory) {
          const children = await this.readDirectory(
            fullPath,
            rootPath,
            nodeInTrash,
          );
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
      return [];
    }
  }

  /**
   * Create a new file
   */
  async createFile(path: string, content: string = ""): Promise<string> {
    try {
      const prepared = this.prepareContentForWrite(path, content);
      await writeTextFile(path, prepared);
      this.captureFileFormat(path, prepared);
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
  async watchFile(
    path: string,
    callback: (event: FileWatchEvent | null) => void,
  ): Promise<() => void> {
    try {
      let previous = this.fileFormatStates.get(path)?.lastContent;

      if (previous === undefined) {
        try {
          const initialRaw = await readTextFile(path);
          previous = this.captureFileFormat(path, initialRaw);
        } catch {
          previous = "";
        }
      }

      // Chain polls with setTimeout so a slow read of a large file can never
      // overlap the next poll.
      const POLL_INTERVAL_MS = 1500;
      let disposed = false;
      let timer: number | null = null;

      const scheduleNext = () => {
        if (disposed) return;
        timer = window.setTimeout(runPoll, POLL_INTERVAL_MS);
      };

      const runPoll = async () => {
        if (disposed) return;
        try {
          const latestKnown = this.fileFormatStates.get(path)?.lastContent;
          if (latestKnown !== undefined) {
            previous = latestKnown;
          }

          const currentRaw = await readTextFile(path);
          const current = this.captureFileFormat(path, currentRaw);
          if (disposed) return;

          if (current !== previous) {
            previous = current;
            callback({ path, type: "modified" });
          }
        } catch (error) {
          if (disposed) return;
          const message =
            error instanceof Error
              ? error.message.toLowerCase()
              : String(error).toLowerCase();
          const isMissingFile =
            message.includes("not found") ||
            message.includes("no such file") ||
            message.includes("cannot find the path") ||
            (message.includes("路径") && message.includes("找不到"));
          if (isMissingFile) {
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
  async watchDirectory(
    dirPath: string,
    callback: (event: DirectoryWatchEvent) => void,
  ): Promise<() => void> {
    const BASE_INTERVAL_MS = 2000;
    // Never spend more than ~1/4 of wall-clock time scanning large trees.
    const SCAN_BACKOFF_FACTOR = 4;

    try {
      let previousSignature = "";
      let disposed = false;
      let timer: number | null = null;

      try {
        const initialTree = await this.readDirectory(dirPath);
        previousSignature = buildFileTreeSignature(initialTree);
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
          const currentTree = await this.readDirectory(dirPath);
          if (disposed) return;

          const signature = buildFileTreeSignature(currentTree);
          if (signature !== previousSignature) {
            previousSignature = signature;
            callback({ type: "changed", tree: currentTree });
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
