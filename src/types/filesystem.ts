import type { FileNode } from "../types";

export type FileWatchEvent =
  | { path: string; type: "modified" }
  | { path: string; type: "deleted" }
  | { path: string; type: "error"; error: unknown };

export type DirectoryWatchEvent =
  | { type: "changed"; tree: FileNode[] }
  | { type: "error"; error: unknown };

/**
 * Unified file system interface
 * Implementations: TauriFileSystem (for Tauri app), BrowserFileSystem (for web)
 */
export interface IFileSystem {
  openFile(): Promise<string | null>;
  openDirectory(): Promise<string | null>;
  readFile(path: string): Promise<string>;
  readBinaryFile?(path: string): Promise<Uint8Array>;
  registerAllowedPath?(path: string, recursive: boolean): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  writeBinaryFile?(path: string, content: Uint8Array): Promise<void>;
  getFileObjectUrl?(path: string): Promise<string>;
  /** Drop a cached object URL and read the file again (dead blob recovery). */
  refreshFileObjectUrl?(path: string): Promise<string>;
  saveFile(path: string | null, content: string): Promise<string | null>;
  renameFile(oldPath: string, newName: string): Promise<string>;
  renameEntry?(
    oldPath: string,
    newName: string,
    isDirectory: boolean,
  ): Promise<string>;
  deleteFile(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  readDirectory(dirPath: string, rootPath?: string): Promise<FileNode[]>;
  createFile(path: string, content?: string): Promise<string>;
  createDirectory(path: string): Promise<void>;
  revealInExplorer?(path: string): Promise<void>;
  moveFile?(sourcePath: string, targetPath: string): Promise<string>;
  watchFile?(
    path: string,
    callback: (event: FileWatchEvent | null) => void,
  ): Promise<() => void>;
  watchDirectory?(
    dirPath: string,
    callback: (event: DirectoryWatchEvent) => void,
  ): Promise<() => void>;
  /**
   * Copy sample notes from bundled resources to target directory
   * Only available in Tauri environment
   */
  copySampleNotes?(targetDir: string): Promise<boolean>;
}

/**
 * Check if running in Tauri environment
 * Supports both Tauri 1.x (__TAURI__) and Tauri 2.x (__TAURI_INTERNALS__)
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;

  // Check for Tauri 2.x
  if ("__TAURI_INTERNALS__" in window) return true;

  // Check for Tauri 1.x
  if ("__TAURI__" in window) return true;

  // Check for Tauri APIs directly
  if ((window as any).__TAURI_INTERNALS__?.plugins) return true;

  return false;
}

/**
 * Check if Tauri core APIs are fully initialized and ready to use
 * This goes beyond isTauriEnvironment() by actually trying to use the API
 */
async function isTauriCoreReady(): Promise<boolean> {
  if (!isTauriEnvironment()) return false;

  try {
    // Try to import and invoke a simple Tauri command to verify core is ready
    const { invoke } = await import("@tauri-apps/api/core");
    // Ping the backend to verify connection is established
    await invoke("ping");
    return true;
  } catch {
    // If ping doesn't exist or fails, check if we can at least import core
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return typeof invoke === "function";
    } catch {
      return false;
    }
  }
}

/**
 * Wait for Tauri environment to be ready
 * Use this when you need to ensure Tauri APIs are available
 * This is useful in build mode where Tauri injection might be delayed
 */
export async function waitForTauri(maxWaitMs: number = 5000): Promise<boolean> {
  if (await isTauriCoreReady()) {
    return true;
  }

  const startTime = Date.now();
  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const check = async (): Promise<void> => {
      if (await isTauriCoreReady()) {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(true);
        return;
      }

      if (Date.now() - startTime > maxWaitMs) {
        resolve(false);
        return;
      }

      timeoutId = setTimeout(check, 100);
    };

    check();
  });
}

/**
 * Check if File System Access API is supported
 */
export function isFileSystemAccessSupported(): boolean {
  return "showOpenFilePicker" in window && "showDirectoryPicker" in window;
}

/**
 * Get the appropriate file system based on environment
 * @throws Error if no supported file system is available
 */
export async function getFileSystem(): Promise<IFileSystem> {
  // Check Tauri first
  if (isTauriEnvironment()) {
    const { TauriFileSystem } = await import("../services/tauriFileSystem");
    return TauriFileSystem.getInstance();
  }

  // Then check for File System Access API (browser)
  if (isFileSystemAccessSupported()) {
    const { BrowserFileSystem } = await import("../services/browserFileSystem");
    return BrowserFileSystem.getInstance();
  }

  throw new Error(
    "No supported file system available. Please use Tauri or a browser with File System Access API support.",
  );
}
