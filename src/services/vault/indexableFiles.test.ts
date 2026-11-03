import { describe, expect, it, vi } from "vitest";
import type { FileNode } from "../../types";
import {
  buildFullChunkIndex,
  createEmptyChunkIndex,
  upsertChunkPaths,
} from "./chunkIndexService";
import { chunkMarkdownFile } from "./chunkService";
import {
  buildFullLinkIndex,
  createEmptyLinkIndex,
  reconcileTreeWithIndex,
  reindexFileContents,
  updateFilesInIndex,
} from "./linkIndexService";

const markdownPaths = [
  "/vault/Note.md",
  "/vault/Other.MARKDOWN",
  "/vault/Board.excalidraw.md",
];
const attachmentPaths = [
  "/vault/Flow.excalidraw",
  "/vault/Flow.excalidraw.json",
  "/vault/image.png",
];
const files: FileNode[] = [...markdownPaths, ...attachmentPaths].map(
  (path) => ({ id: path, path, name: path.split("/").pop()!, type: "file" }),
);
const markdown =
  "# Reading context\nA paragraph with enough readable context to be retrieved and linked to [[Note]].";
const scene =
  '{"type":"excalidraw","elements":[{"strokeStyle":"solid","versionNonce":123,"text":"[[Note]]"}]}';

describe("索引只使用 Markdown 正文文件", () => {
  it("全量扫描保留 Markdown 扩展名与其画板 Markdown 包装，不读取原生画板或二进制附件", async () => {
    const readFile = vi.fn(async (_path: string) => markdown);
    const options = { files, vaultRoot: "/vault", readFile };
    const links = await buildFullLinkIndex(options);
    const chunks = await buildFullChunkIndex(options);
    expect(Object.keys(links.outbounds)).toEqual(markdownPaths);
    expect(Object.keys(chunks.byPath)).toEqual(markdownPaths);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual([
      ...markdownPaths,
      ...markdownPaths,
    ]);
    expect(chunks.byPath["/vault/Board.excalidraw.md"][0].text).toContain(
      "Reading context",
    );
  });

  it.each(attachmentPaths)("%s 即使有可解析文本也不会变成正文片段", (path) => {
    expect(
      chunkMarkdownFile({ path, content: scene, vaultRoot: "/vault" }),
    ).toEqual([]);
  });

  it("增量文件更新和保存事件都剔除遗留画板双链项", async () => {
    const snapshot = createEmptyLinkIndex("/vault");
    for (const path of attachmentPaths) snapshot.outbounds[path] = [];
    const pathContents = Object.fromEntries(
      files.map((file) => [
        file.path,
        markdownPaths.includes(file.path) ? markdown : scene,
      ]),
    );
    const saved = await reindexFileContents({
      snapshot,
      pathContents,
      files,
      vaultRoot: "/vault",
    });
    const readFile = vi.fn(async (_path: string) => markdown);
    const updated = await updateFilesInIndex({
      snapshot,
      paths: files.map((file) => file.path),
      files,
      vaultRoot: "/vault",
      readFile,
    });
    expect(Object.keys(saved.outbounds)).toEqual(markdownPaths);
    expect(Object.keys(updated.outbounds)).toEqual(markdownPaths);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(markdownPaths);
    expect(reconcileTreeWithIndex({ snapshot, files }).toRemove).toEqual(
      attachmentPaths,
    );
  });

  it("增量片段更新移除旧的附件缓存且不读取附件内容", async () => {
    const snapshot = createEmptyChunkIndex("/vault");
    for (const path of attachmentPaths) snapshot.byPath[path] = [];
    const readFile = vi.fn(async (_path: string) => markdown);
    const updated = await upsertChunkPaths({
      snapshot,
      paths: files.map((file) => file.path),
      vaultRoot: "/vault",
      readFile,
    });
    expect(Object.keys(updated.byPath)).toEqual(markdownPaths);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual(markdownPaths);
  });
});
