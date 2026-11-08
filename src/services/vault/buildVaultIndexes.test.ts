import { afterEach, expect, it, vi } from "vitest";
import { buildVaultIndexes } from "./buildVaultIndexes";
import { buildFullLinkIndex } from "./linkIndexService";
import { buildFullChunkIndex } from "./chunkIndexService";
import type { FileNode } from "../../types";

afterEach(() => vi.restoreAllMocks());
const texts: Record<string, string> = {
  "/vault/a.md": "# A\n\nA paragraph with enough context and [[secret/b]].",
  "/vault/secret/b.md":
    "# B\n\nExcluded from semantic retrieval, but links to [[a]].",
  "/vault/empty.md": "",
};
const files: FileNode[] = [
  "a.md",
  "secret/b.md",
  "empty.md",
  "broken.md",
  "drawing.excalidraw.md",
  "asset.png",
].map((name) => ({
  id: `/vault/${name}`,
  path: `/vault/${name}`,
  name: name.split("/").at(-1)!,
  type: "file",
}));
const read = async (path: string) => {
  if (!(path in texts)) throw new Error("missing");
  return texts[path];
};
it("produces the same indexes with one read per Markdown and separate exclusions", async () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  const options = {
    files,
    vaultRoot: "/vault",
    readFile: read,
    excludeGlobs: ["secret/**"],
  };
  const referenceLinks = await buildFullLinkIndex(options);
  const referenceChunks = await buildFullChunkIndex(options);
  const readFile = vi.fn(read);
  const combined = await buildVaultIndexes({ ...options, readFile });
  expect(combined).toEqual({
    linkIndex: referenceLinks,
    chunkIndex: referenceChunks,
  });
  expect(readFile).toHaveBeenCalledTimes(5);
  expect(new Set(readFile.mock.calls.map(([path]) => path)).size).toBe(5);
  expect(combined.linkIndex.inbounds["/vault/secret/b.md"]).toContain(
    "/vault/a.md",
  );
  expect(combined.chunkIndex.byPath["/vault/secret/b.md"]).toBeUndefined();
  expect(combined.chunkIndex.byPath["/vault/broken.md"]).toEqual([]);
});
it("stops reading on cancellation without a vault-wide text cache", async () => {
  const readFile = vi.fn(read);
  const result = await buildVaultIndexes({
    files,
    vaultRoot: "/vault",
    readFile,
    shouldCancel: () => readFile.mock.calls.length === 1,
  });
  expect(readFile).toHaveBeenCalledTimes(1);
  expect(Object.keys(result.linkIndex.outbounds)).toEqual(["/vault/a.md"]);
  expect(Object.keys(result.chunkIndex.byPath)).toEqual(["/vault/a.md"]);
});

it("keeps chunk order stable when concurrent reads finish in reverse order", async () => {
  const nodes: FileNode[] = ["a", "b", "c"].map((name) => ({
    id: `/vault/${name}.md`,
    path: `/vault/${name}.md`,
    name: `${name}.md`,
    type: "file",
  }));
  const pending: (() => void)[] = [];
  const building = buildVaultIndexes({
    files: nodes,
    vaultRoot: "/vault",
    excludeGlobs: ["b.md"],
    readFile: () =>
      new Promise<string>((resolve) =>
        pending.push(() =>
          resolve("# Note\n\nA paragraph with enough context for retrieval."),
        ),
      ),
  });
  pending.reverse().forEach((resolve) => resolve());
  const { linkIndex, chunkIndex } = await building;
  expect(Object.keys(linkIndex.outbounds)).toEqual(
    nodes.map((node) => node.path),
  );
  expect(Object.keys(chunkIndex.byPath)).toEqual([
    nodes[0].path,
    nodes[2].path,
  ]);
});
