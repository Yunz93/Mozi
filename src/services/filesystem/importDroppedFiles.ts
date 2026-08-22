import { joinFsPath } from "../../utils/pathHelpers";
import {
  droppedFileRelativePath,
  nextAvailableFileName,
  sanitizeDroppedRelativePath,
} from "../../utils/droppedFiles";

export interface ImportDroppedFilesFileSystem {
  fileExists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  writeBinaryFile?(path: string, content: Uint8Array): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ImportedDroppedFile {
  path: string;
  name: string;
}

export interface ImportDroppedFilesResult {
  imported: ImportedDroppedFile[];
  skipped: number;
  failed: Array<{ name: string; error: string }>;
}

function takenKey(name: string): string {
  return name.toLocaleLowerCase();
}

async function allocateUniqueName(
  fs: ImportDroppedFilesFileSystem,
  folderPath: string,
  desired: string,
  taken: Set<string>,
): Promise<string> {
  let candidate = nextAvailableFileName(desired, taken);
  while (await fs.fileExists(joinFsPath(folderPath, candidate))) {
    taken.add(takenKey(candidate));
    candidate = nextAvailableFileName(desired, taken);
  }
  return candidate;
}

async function writeDroppedBytes(
  fs: ImportDroppedFilesFileSystem,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  if (typeof fs.writeBinaryFile === "function") {
    await fs.writeBinaryFile(path, bytes);
    return;
  }
  await fs.writeFile(path, new TextDecoder().decode(bytes));
}

export async function importDroppedFiles(options: {
  files: File[];
  targetFolderPath: string;
  fs: ImportDroppedFilesFileSystem;
}): Promise<ImportDroppedFilesResult> {
  const imported: ImportedDroppedFile[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  let skipped = 0;
  const takenByFolder = new Map<string, Set<string>>();

  for (const file of options.files) {
    const segments = sanitizeDroppedRelativePath(droppedFileRelativePath(file));
    if (!segments || segments.length === 0) {
      skipped += 1;
      continue;
    }

    const fileName = segments[segments.length - 1]!;
    const folderSegments = segments.slice(0, -1);
    const folderPath = folderSegments.reduce(
      (current, segment) => joinFsPath(current, segment),
      options.targetFolderPath,
    );

    try {
      if (folderSegments.length > 0) {
        await options.fs.createDirectory(folderPath);
      }

      let taken = takenByFolder.get(folderPath);
      if (!taken) {
        taken = new Set<string>();
        takenByFolder.set(folderPath, taken);
      }

      const uniqueName = await allocateUniqueName(
        options.fs,
        folderPath,
        fileName,
        taken,
      );
      taken.add(takenKey(uniqueName));
      const destPath = joinFsPath(folderPath, uniqueName);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await writeDroppedBytes(options.fs, destPath, bytes);
      imported.push({ path: destPath, name: uniqueName });
    } catch (error) {
      failed.push({
        name: fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped, failed };
}
