import type { FileNode } from "../../types";
import { pathMatchesAnyGlob } from "../../utils/pathGlob";
import { toForwardSlashes } from "../../utils/pathHelpers";
import { buildFullLinkIndex } from "./linkIndexService";
import { createEmptyChunkIndex } from "./chunkIndexService";
import { chunkMarkdownFile } from "./chunkService";

/** Read each Markdown file once and feed both index consumers immediately.
 * Do not retain a vault-sized text cache. Link resolution still sees every note;
 * semantic exclude globs apply only to the chunk consumer, as before.
 */
export async function buildVaultIndexes(options: {
  files: FileNode[];
  vaultRoot: string;
  readFile: (path: string) => Promise<string>;
  onProgress?: (done: number, total: number, currentPath: string) => void;
  shouldCancel?: () => boolean;
  excludeGlobs?: string[];
}) {
  const chunkIndex = createEmptyChunkIndex(options.vaultRoot);
  const linkIndex = await buildFullLinkIndex({
    ...options,
    readFile: async (rawPath) => {
      const path = toForwardSlashes(rawPath);
      const includeChunks = !pathMatchesAnyGlob(
        path,
        options.excludeGlobs,
        options.vaultRoot,
      );
      // Reserve in admission/tree order before asynchronous reads complete, so
      // embedding batches and tied retrieval results remain deterministic.
      if (includeChunks) chunkIndex.byPath[path] = [];
      let content: string;
      try {
        content = await options.readFile(rawPath);
      } catch (error) {
        if (includeChunks) chunkIndex.byPath[path] = [];
        throw error; // The link consumer retains its existing per-file error behavior.
      }
      if (includeChunks) {
        try {
          chunkIndex.byPath[path] = chunkMarkdownFile({
            path,
            vaultRoot: options.vaultRoot,
            content,
          });
        } catch {
          chunkIndex.byPath[path] = [];
        }
      }
      return content;
    },
  });
  chunkIndex.builtAt = Date.now();
  return { linkIndex, chunkIndex };
}
