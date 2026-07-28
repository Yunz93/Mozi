import type { FileNode } from "../../types";
import { sanitizeTrashFolder } from "../../utils/trashFolder";
import { joinFsPath } from "../../utils/pathHelpers";
import {
  isMarkdownFile,
  isPreviewOnlyFile,
  shouldReadInitialFileContent,
} from "../../utils/fileTypes";

interface OpenKnowledgeBaseOptions {
  path?: string;
  silentSuccess?: boolean;
  skipSampleNotes?: boolean;
  /**
   * When true, restore `lastOpenedFilePath` if it still exists in the tree.
   * Interactive folder opens should leave this false so no tab opens until the user picks a file.
   */
  restoreLastOpenedFile?: boolean;
}

interface OpenKnowledgeBaseParams {
  addTab: (tabId: string, content?: string) => void;
  clearAllCache: () => void;
  findPreferredFile: (
    fileNodes: FileNode[],
    filePath: string,
  ) => FileNode | undefined;
  fs: {
    copySampleNotes?: (targetDir: string) => Promise<boolean>;
    fileExists?: (path: string) => Promise<boolean>;
    openDirectory: () => Promise<string | null>;
    readDirectory: (dirPath: string) => Promise<FileNode[]>;
    readFile: (path: string) => Promise<string>;
  };
  hasOpenedKnowledgeBaseBefore: (path: string) => boolean;
  handleInitialFileError: (error: unknown) => void;
  initializeSampleNotes: (targetDir: string) => Promise<boolean>;
  /** Only restored when the path still exists in the opened tree. Never falls back to "first file". */
  lastOpenedFilePath: string | null;
  options?: OpenKnowledgeBaseOptions;
  registerAllowedPath: (path: string, recursive: boolean) => Promise<void>;
  registerAllowedPathIfExists: (
    path: string,
    recursive: boolean,
  ) => Promise<void>;
  setCurrentFilePath: (path: string | null) => void;
  setFiles: (files: FileNode[]) => void;
  setRootFolderPath: (path: string | null) => void;
  trashFolder: string;
  withErrorHandling: <T>(fn: () => Promise<T>, context: string) => Promise<T>;
}

interface OpenKnowledgeBaseResult {
  dirPath: string;
  fileNodes: FileNode[];
  initialFile: FileNode | null;
  openedPreviewOnly: boolean;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context: string,
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(
      () => reject(new Error(`${context} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeoutPromise]);
}

export async function openKnowledgeBaseWorkspace(
  params: OpenKnowledgeBaseParams,
): Promise<OpenKnowledgeBaseResult | null> {
  const {
    addTab,
    clearAllCache,
    findPreferredFile,
    fs,
    hasOpenedKnowledgeBaseBefore,
    handleInitialFileError,
    initializeSampleNotes,
    lastOpenedFilePath,
    options,
    registerAllowedPath,
    registerAllowedPathIfExists,
    setCurrentFilePath,
    setFiles,
    setRootFolderPath,
    trashFolder,
    withErrorHandling,
  } = params;

  const dirPath = options?.path || (await fs.openDirectory());
  if (!dirPath) return null;

  try {
    await withTimeout(
      registerAllowedPath(dirPath, true),
      5000,
      "Register allowed path",
    );
  } catch (error) {
    console.warn("Failed to register allowed path (continuing):", error);
  }

  if (options?.path && fs.fileExists) {
    const pathExists = await withErrorHandling(
      () => fs.fileExists!(dirPath),
      "Failed to validate knowledge base path",
    );

    if (!pathExists) {
      return null;
    }
  }

  const trashRootPath = joinFsPath(dirPath, sanitizeTrashFolder(trashFolder));
  try {
    await withTimeout(
      registerAllowedPathIfExists(trashRootPath, true),
      3000,
      "Register trash path",
    );
  } catch (error) {
    console.warn("Failed to register trash path (continuing):", error);
  }

  const shouldInitializeSampleNotes =
    !options?.skipSampleNotes &&
    !!fs.copySampleNotes &&
    !hasOpenedKnowledgeBaseBefore(dirPath);

  if (shouldInitializeSampleNotes) {
    await initializeSampleNotes(dirPath);
  }

  const fileNodes = await withErrorHandling(
    () => fs.readDirectory(dirPath),
    "Failed to read knowledge base",
  );

  clearAllCache();
  setCurrentFilePath(null);
  setFiles(fileNodes);
  setRootFolderPath(dirPath);

  // Only restore the previously opened file on explicit restore (e.g. cold start).
  // Interactive "open folder" must not auto-open the first note or a leftover
  // lastOpenedFilePath — that produced surprise opens like "未命名".
  const shouldRestoreLastOpenedFile = Boolean(options?.restoreLastOpenedFile);
  const initialFile =
    shouldRestoreLastOpenedFile && lastOpenedFilePath
      ? (findPreferredFile(fileNodes, lastOpenedFilePath) ?? null)
      : null;

  let openedPreviewOnly = false;
  if (initialFile) {
    try {
      if (shouldReadInitialFileContent(initialFile.name)) {
        const initialContent = await withErrorHandling(
          () => fs.readFile(initialFile.path),
          `Failed to read file: ${initialFile.name}`,
        );

        addTab(initialFile.id, initialContent);
      } else {
        addTab(initialFile.id);
      }

      setCurrentFilePath(initialFile.path);
      openedPreviewOnly =
        isPreviewOnlyFile(initialFile.name) &&
        !isMarkdownFile(initialFile.name);
    } catch (error) {
      handleInitialFileError(error);
    }
  }

  return {
    dirPath,
    fileNodes,
    initialFile,
    openedPreviewOnly,
  };
}
