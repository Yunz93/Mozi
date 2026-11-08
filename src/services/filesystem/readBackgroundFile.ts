import type { IFileSystem } from "../../types/filesystem";

/** Keep background reads out of the open-document format/content cache. */
export function readBackgroundFile(
  fs: IFileSystem,
  path: string,
): Promise<string> {
  return fs.readFileUncached ? fs.readFileUncached(path) : fs.readFile(path);
}
