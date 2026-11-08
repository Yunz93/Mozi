import type { IFileSystem } from "../../types/filesystem";

/** Keep full-vault reads out of the open-document format/content cache. */
export function readIndexFile(fs: IFileSystem, path: string): Promise<string> {
  return fs.readFileUncached ? fs.readFileUncached(path) : fs.readFile(path);
}
