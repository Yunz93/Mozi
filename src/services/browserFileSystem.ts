import type { FileNode } from "../types";
import type { IFileSystem } from "../types/filesystem";
import { useAppStore } from "../store/appStore";
import { sanitizeTrashFolder } from "../utils/trashFolder";

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<
    [string, FileSystemFileHandle | FileSystemDirectoryHandle]
  >;
};

/**
 * Browser File System using File System Access API
 * Provides a fallback for non-Tauri environments
 */
export class BrowserFileSystem implements IFileSystem {
  async fileMetadata(paths: string[]) {
    const result: Record<
      string,
      { createdAt: number | null; modifiedAt: number | null }
    > = {};
    for (const path of paths) {
      try {
        const handle = await this.getFileHandle(
          this.directoryHandle!,
          this.getRelativePath(path),
        );
        const file = await handle.getFile();
        // 浏览器文件 API 不提供创建时间，不能用修改时间冒充。
        result[path] = { createdAt: null, modifiedAt: file.lastModified };
      } catch {
        // 目录或已移除文件没有可用时间，排序时稳定回退到名称。
      }
    }
    return result;
  }
  private static instance: BrowserFileSystem;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private fileHandles: Map<string, FileSystemFileHandle> = new Map();
  private objectUrlPromises: Map<string, Promise<string>> = new Map();
  private objectUrls: Map<string, string> = new Map();
  private rootPath: string = "";

  static getInstance(): BrowserFileSystem {
    if (!BrowserFileSystem.instance) {
      BrowserFileSystem.instance = new BrowserFileSystem();
    }
    return BrowserFileSystem.instance;
  }

  private registerObjectUrlCleanup(): void {
    if (
      typeof window === "undefined" ||
      (window as any).__markdownPressObjectUrlCleanupRegistered
    ) {
      return;
    }

    window.addEventListener(
      "beforeunload",
      () => {
        for (const url of this.objectUrls.values()) {
          URL.revokeObjectURL(url);
        }
        this.objectUrls.clear();
        this.objectUrlPromises.clear();
      },
      { once: true },
    );

    (window as any).__markdownPressObjectUrlCleanupRegistered = true;
  }

  private invalidateObjectUrl(path: string, recursive = false): void {
    const normalizedPath = path.replace(/\\/g, "/");

    for (const [cachedPath, url] of this.objectUrls.entries()) {
      const normalizedCachedPath = cachedPath.replace(/\\/g, "/");
      const matches = recursive
        ? normalizedCachedPath === normalizedPath ||
          normalizedCachedPath.startsWith(`${normalizedPath}/`)
        : normalizedCachedPath === normalizedPath;

      if (!matches) continue;

      URL.revokeObjectURL(url);
      this.objectUrls.delete(cachedPath);
      this.objectUrlPromises.delete(cachedPath);
      void import("../utils/previewImageCache")
        .then(({ invalidateCachedPreviewImageSrc }) => {
          invalidateCachedPreviewImageSrc(cachedPath);
        })
        .catch(() => {
          // Preview cache module may be unavailable in non-UI contexts.
        });
    }
  }

  /**
   * Open a single markdown file
   */
  async openFile(): Promise<string | null> {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Markdown Files",
            accept: { "text/markdown": [".md", ".markdown"] },
          },
        ],
      });

      const file = await fileHandle.getFile();
      const id = `browser-${Date.now()}-${file.name}`;
      this.fileHandles.set(id, fileHandle);
      return id;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return null; // User cancelled
      }
      console.error("Failed to open file:", error);
      throw error;
    }
  }

  /**
   * Open a directory
   */
  async openDirectory(): Promise<string | null> {
    try {
      this.directoryHandle = await window.showDirectoryPicker();
      this.rootPath = `browser-dir-${Date.now()}`;
      return this.rootPath;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return null; // User cancelled
      }
      console.error("Failed to open directory:", error);
      throw error;
    }
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<string> {
    try {
      // Check if it's a file handle path
      if (path.startsWith("browser-")) {
        const handle = this.fileHandles.get(path);
        if (handle) {
          const file = await handle.getFile();
          return await file.text();
        }
      }

      // Try to read from directory handle
      if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        const fileHandle = await this.getFileHandle(
          this.directoryHandle,
          relativePath,
        );
        const file = await fileHandle.getFile();
        return await file.text();
      }

      throw new Error("File not found");
    } catch (error) {
      console.error(`Failed to read file ${path}:`, error);
      throw error;
    }
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    try {
      let file: File;

      if (path.startsWith("browser-") && this.fileHandles.has(path)) {
        file = await this.fileHandles.get(path)!.getFile();
      } else if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        const fileHandle = await this.getFileHandle(
          this.directoryHandle,
          relativePath,
        );
        file = await fileHandle.getFile();
      } else {
        throw new Error("File not found");
      }

      return new Uint8Array(await file.arrayBuffer());
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
      let fileHandle: FileSystemFileHandle;

      // Check if it's a known file handle
      if (path.startsWith("browser-") && this.fileHandles.has(path)) {
        fileHandle = this.fileHandles.get(path)!;
      } else if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        fileHandle = await this.getFileHandle(
          this.directoryHandle,
          relativePath,
          true,
        );
      } else {
        throw new Error("No file handle or directory available");
      }

      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      this.invalidateObjectUrl(path);
    } catch (error) {
      console.error(`Failed to write file ${path}:`, error);
      throw error;
    }
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    return this.writeBinaryContent(path, content);
  }

  async writeBlobFile(path: string, content: Blob): Promise<void> {
    return this.writeBinaryContent(path, content);
  }

  private async writeBinaryContent(
    path: string,
    content: Uint8Array | Blob,
  ): Promise<void> {
    try {
      let fileHandle: FileSystemFileHandle;

      if (path.startsWith("browser-") && this.fileHandles.has(path)) {
        fileHandle = this.fileHandles.get(path)!;
      } else if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        fileHandle = await this.getFileHandle(
          this.directoryHandle,
          relativePath,
          true,
        );
      } else {
        throw new Error("No file handle or directory available");
      }

      const writable = await fileHandle.createWritable();
      try {
        await writable.write(content);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
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
        const fileHandle = await window.showSaveFilePicker({
          types: [
            {
              description: "Markdown Files",
              accept: { "text/markdown": [".md"] },
            },
          ],
        });

        if (fileHandle) {
          const writable = await fileHandle.createWritable();
          await writable.write(content);
          await writable.close();

          const id = `browser-${Date.now()}-${fileHandle.name}`;
          this.fileHandles.set(id, fileHandle);
          this.invalidateObjectUrl(id);
          return id;
        }
        return null;
      }

      await this.writeFile(path, content);
      return path;
    } catch (error) {
      console.error("Failed to save file:", error);
      throw error;
    }
  }

  /**
   * Rename a file (creates a new file with new name, deletes old)
   */
  async renameFile(oldPath: string, newName: string): Promise<string> {
    const normalizedName =
      newName.trim() || oldPath.split(/[/\\]/).pop() || newName;
    return this.renameEntry(oldPath, normalizedName, false);
  }

  async renameEntry(
    oldPath: string,
    newName: string,
    isDirectory: boolean,
  ): Promise<string> {
    try {
      if (!this.directoryHandle) {
        throw new Error("Cannot rename without directory context");
      }

      const oldRelativePath = this.getRelativePath(oldPath);
      const parentPath = oldRelativePath.includes("/")
        ? oldRelativePath.substring(0, oldRelativePath.lastIndexOf("/"))
        : "";
      const parentFullPath = parentPath
        ? `${this.rootPath}/${parentPath}`
        : this.rootPath;

      return await this.moveEntry(
        oldPath,
        parentFullPath,
        newName,
        isDirectory,
      );
    } catch (error) {
      console.error("Failed to rename entry:", error);
      throw error;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    try {
      if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        const parentPath = relativePath.substring(
          0,
          relativePath.lastIndexOf("/"),
        );
        const fileName = relativePath.substring(
          relativePath.lastIndexOf("/") + 1,
        );
        const kind = await this.getEntryKind(path);

        const parentHandle = parentPath
          ? await this.getDirectoryHandle(this.directoryHandle, parentPath)
          : this.directoryHandle;

        await parentHandle.removeEntry(fileName, {
          recursive: kind === "directory",
        });
      }

      this.fileHandles.delete(path);
      this.invalidateObjectUrl(path, true);
    } catch (error) {
      console.error("Failed to delete file:", error);
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      if (this.fileHandles.has(path)) {
        return true;
      }

      if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        await this.getFileHandle(this.directoryHandle, relativePath);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Read directory and return file nodes
   */
  async readDirectory(
    dirPath: string,
    rootPath: string = dirPath,
    inTrash: boolean = false,
  ): Promise<FileNode[]> {
    try {
      const dirHandle =
        dirPath === this.rootPath && this.directoryHandle
          ? this.directoryHandle
          : await this.getDirectoryHandle(
              this.directoryHandle!,
              this.getRelativePath(dirPath),
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

      for await (const [name, entry] of (dirHandle as any).entries()) {
        const fullPath = `${dirPath}/${name}`;
        const isTrashDirectory =
          entry.kind === "directory" && isAtRoot && name === trashFolder;
        const nodeInTrash = inTrash || isTrashDirectory;

        if (entry.kind === "file" && (nodeInTrash || !name.startsWith("."))) {
          nodes.push({
            id: fullPath,
            name,
            type: "file",
            path: fullPath,
            isTrash: nodeInTrash,
          });
        } else if (
          entry.kind === "directory" &&
          (!name.startsWith(".") || isTrashDirectory || inTrash)
        ) {
          const children = await this.readDirectory(
            fullPath,
            rootPath,
            nodeInTrash,
          );
          nodes.push({
            id: fullPath,
            name,
            type: "folder",
            path: fullPath,
            children,
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
      if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        const fileHandle = await this.getFileHandle(
          this.directoryHandle,
          relativePath,
          true,
        );

        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        this.invalidateObjectUrl(path);

        return path;
      }

      throw new Error("No directory opened");
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
      if (this.directoryHandle) {
        const relativePath = this.getRelativePath(path);
        await this.getDirectoryHandle(this.directoryHandle, relativePath, true);
      }
    } catch (error) {
      console.error("Failed to create directory:", error);
      throw error;
    }
  }

  /**
   * Move a file or directory via copy + delete (browser File System Access API).
   */
  async moveFile(sourcePath: string, targetPath: string): Promise<string> {
    const kind = await this.getEntryKind(sourcePath);
    if (!kind) {
      throw new Error("Source entry not found");
    }

    return this.moveEntry(
      sourcePath,
      targetPath,
      undefined,
      kind === "directory",
    );
  }

  // Helper methods

  private async moveEntry(
    sourcePath: string,
    targetDirectoryPath: string,
    newName?: string,
    isDirectory?: boolean,
  ): Promise<string> {
    if (!this.directoryHandle) {
      throw new Error("No directory opened");
    }

    const kind =
      isDirectory !== undefined
        ? isDirectory
          ? "directory"
          : "file"
        : await this.getEntryKind(sourcePath);

    if (!kind) {
      throw new Error("Source entry not found");
    }

    const sourceRelativePath = this.getRelativePath(sourcePath);
    const sourceName = sourceRelativePath.split("/").filter(Boolean).pop();
    if (!sourceName) {
      throw new Error("Invalid source path");
    }

    const entryName = newName || sourceName;
    const targetRelativeDir = this.getRelativePath(targetDirectoryPath);
    const destinationRelativePath = targetRelativeDir
      ? `${targetRelativeDir}/${entryName}`
      : entryName;
    const sourceParentPath = sourceRelativePath
      .split("/")
      .slice(0, -1)
      .join("/");
    const sourceParent =
      await this.getCanonicalDirectoryHandle(sourceParentPath);
    const sourceHandle = await this.getCanonicalEntry(
      sourceParent,
      sourceName,
      kind,
    );
    if (!sourceHandle) throw new Error("Source entry not found");
    const targetParent =
      await this.getCanonicalDirectoryHandle(targetRelativeDir);

    if (
      sourceHandle.kind === "directory" &&
      (await sourceHandle.resolve(targetParent)) !== null
    ) {
      throw new Error("Cannot move a directory into itself or its descendants");
    }

    const existingTarget = await this.getCanonicalEntry(
      targetParent,
      entryName,
      kind,
    );
    if (existingTarget) {
      if (!(await sourceHandle.isSameEntry(existingTarget))) {
        throw new Error("A file with this name already exists.");
      }
      if (entryName === sourceHandle.name) return sourcePath;
      await this.renameAliasedEntry(
        sourceHandle,
        sourceParent,
        targetParent,
        entryName,
        sourceParentPath,
      );
    } else {
      await this.copyEntry(sourceHandle, targetParent, entryName);
      await this.deleteFile(sourcePath);
    }

    const nextPath = `${this.rootPath}/${destinationRelativePath}`;
    this.fileHandles.delete(sourcePath);
    this.invalidateObjectUrl(sourcePath, true);
    this.invalidateObjectUrl(nextPath, true);
    return nextPath;
  }

  /** 先以目录中的真实名称取 handle，避免 Chromium 把大小写别名视作不同路径。 */
  private async getCanonicalEntry(
    parent: FileSystemDirectoryHandle,
    name: string,
    kind: "file" | "directory",
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null> {
    let requested: FileSystemFileHandle | FileSystemDirectoryHandle;
    try {
      requested =
        kind === "file"
          ? await parent.getFileHandle(name)
          : await parent.getDirectoryHandle(name);
    } catch (error) {
      if ((error as Error).name === "NotFoundError") return null;
      throw error;
    }
    const foldedName = name.normalize("NFC").toLowerCase();
    let alias: FileSystemFileHandle | FileSystemDirectoryHandle | undefined;
    for await (const [actualName, entry] of (
      parent as IterableDirectoryHandle
    ).entries()) {
      if (actualName === name) return entry;
      if (actualName.normalize("NFC").toLowerCase() === foldedName)
        alias = entry;
    }
    return alias ?? requested;
  }

  private async getCanonicalDirectoryHandle(
    path: string,
  ): Promise<FileSystemDirectoryHandle> {
    let directory = this.directoryHandle!;
    for (const part of path.split("/").filter(Boolean)) {
      const entry = await this.getCanonicalEntry(directory, part, "directory");
      if (!entry || entry.kind !== "directory")
        throw new Error("Directory not found");
      directory = entry;
    }
    return directory;
  }

  private async copyEntry(
    source: FileSystemFileHandle | FileSystemDirectoryHandle,
    parent: FileSystemDirectoryHandle,
    name: string,
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
    if (source.kind === "directory") {
      const target = await parent.getDirectoryHandle(name, { create: true });
      await this.copyDirectoryContents(source, target);
      return target;
    }
    const file = await source.getFile();
    const bytes = await file.arrayBuffer();
    const target = await parent.getFileHandle(name, { create: true });
    const writable = await target.createWritable();
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    return target;
  }

  /** 完整备份后才删除原条目；回滚失败时保留备份并报告位置，绝不清理唯一副本。 */
  private async renameAliasedEntry(
    source: FileSystemFileHandle | FileSystemDirectoryHandle,
    sourceParent: FileSystemDirectoryHandle,
    targetParent: FileSystemDirectoryHandle,
    newName: string,
    sourceParentPath: string,
  ): Promise<void> {
    let backupName: string;
    do {
      backupName = `.mozi-rename-${crypto.randomUUID()}`;
    } while (
      await this.getCanonicalEntry(sourceParent, backupName, source.kind)
    );
    const recursive = source.kind === "directory";
    let sourceRemovalStarted = false;
    let backup: FileSystemFileHandle | FileSystemDirectoryHandle;
    try {
      backup = await this.copyEntry(source, sourceParent, backupName);
      sourceRemovalStarted = true;
      await sourceParent.removeEntry(source.name, { recursive });
      await this.copyEntry(backup, targetParent, newName);
    } catch (error) {
      if (sourceRemovalStarted) {
        try {
          await targetParent
            .removeEntry(newName, { recursive })
            .catch((removeError: Error) => {
              if (removeError.name !== "NotFoundError") throw removeError;
            });
          await this.copyEntry(backup!, sourceParent, source.name);
        } catch {
          const backupPath = [this.rootPath, sourceParentPath, backupName]
            .filter(Boolean)
            .join("/");
          throw new Error(
            `Rename failed; original data is preserved at ${backupPath}.`,
            { cause: error },
          );
        }
      }
      await sourceParent.removeEntry(backupName, { recursive }).catch(() => {});
      throw error;
    }
    await sourceParent.removeEntry(backupName, { recursive }).catch(() => {});
  }

  async getFileObjectUrl(path: string): Promise<string> {
    const normalizedPath = path.replace(/\\/g, "/");
    const cachedUrl = this.objectUrls.get(normalizedPath);
    if (cachedUrl) {
      return cachedUrl;
    }

    const pendingUrl = this.objectUrlPromises.get(normalizedPath);
    if (pendingUrl) {
      return pendingUrl;
    }

    const pending = (async () => {
      this.registerObjectUrlCleanup();

      let file: File;
      if (
        normalizedPath.startsWith("browser-") &&
        this.fileHandles.has(normalizedPath)
      ) {
        file = await this.fileHandles.get(normalizedPath)!.getFile();
      } else if (this.directoryHandle) {
        const relativePath = this.getRelativePath(normalizedPath);
        const fileHandle = await this.getFileHandle(
          this.directoryHandle,
          relativePath,
        );
        file = await fileHandle.getFile();
      } else {
        throw new Error(
          `Cannot resolve local file object URL: ${normalizedPath}`,
        );
      }

      const objectUrl = URL.createObjectURL(file);
      this.objectUrls.set(normalizedPath, objectUrl);
      return objectUrl;
    })().finally(() => {
      this.objectUrlPromises.delete(normalizedPath);
    });

    this.objectUrlPromises.set(normalizedPath, pending);
    return pending;
  }

  async refreshFileObjectUrl(path: string): Promise<string> {
    this.invalidateObjectUrl(path);
    return this.getFileObjectUrl(path);
  }

  private async copyDirectoryContents(
    sourceHandle: FileSystemDirectoryHandle,
    targetHandle: FileSystemDirectoryHandle,
  ): Promise<void> {
    for await (const [name, entry] of (
      sourceHandle as IterableDirectoryHandle
    ).entries()) {
      await this.copyEntry(entry, targetHandle, name);
    }
  }

  private async getEntryKind(
    path: string,
  ): Promise<"file" | "directory" | null> {
    if (!this.directoryHandle) return null;

    const relativePath = this.getRelativePath(path);
    try {
      await this.getFileHandle(this.directoryHandle, relativePath);
      return "file";
    } catch {
      // continue
    }

    try {
      await this.getDirectoryHandle(this.directoryHandle, relativePath);
      return "directory";
    } catch {
      return null;
    }
  }

  private getRelativePath(path: string): string {
    if (path.startsWith(this.rootPath)) {
      return path.substring(this.rootPath.length + 1);
    }
    return path;
  }

  private async getFileHandle(
    dirHandle: FileSystemDirectoryHandle,
    path: string,
    create = false,
  ): Promise<FileSystemFileHandle> {
    const parts = path.split("/").filter(Boolean);

    let currentHandle: FileSystemDirectoryHandle = dirHandle;

    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i], {
        create,
      });
    }

    return currentHandle.getFileHandle(parts[parts.length - 1], { create });
  }

  private async getDirectoryHandle(
    dirHandle: FileSystemDirectoryHandle,
    path: string,
    create = false,
  ): Promise<FileSystemDirectoryHandle> {
    const parts = path.split("/").filter(Boolean);

    let currentHandle: FileSystemDirectoryHandle = dirHandle;

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create });
    }

    return currentHandle;
  }
}

// Add type declarations for File System Access API
declare global {
  interface Window {
    showOpenFilePicker(options?: {
      multiple?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(options?: {
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle>;
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  }
}
