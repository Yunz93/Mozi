// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import { useVaultIndexLifecycle } from "./useVaultIndexLifecycle";
import { buildFullLinkIndex } from "../services/vault/linkIndexService";
import { buildFullChunkIndex } from "../services/vault/chunkIndexService";
import {
  clearSemanticRuntime,
  getActiveChunkIndex,
  getActiveSemanticVaultRoot,
} from "../services/vault/semanticIndexRuntime";
import {
  flushVaultFileSavedNotificationsForTests,
  notifyVaultFileSaved,
} from "../services/vault/linkIndexEvents";
import {
  CHUNK_INDEX_FILE,
  LINK_INDEX_FILE,
  VECTOR_INDEX_FILE,
} from "../services/vault/indexStorage";
import type { FileNode } from "../types";
import type { LinkIndexSnapshot } from "../types/vaultIndex";
import type { ChunkIndexSnapshot } from "../types/vaultIndex";
import { retrieve } from "../services/vault/retrieveService";

const {
  disk,
  cache,
  readFile,
  readIndexJson,
  writeIndexJson,
  embedChunkIndex,
} = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  cache: new Map<string, unknown>(),
  readFile: vi.fn<(path: string) => Promise<string>>(),
  readIndexJson: vi.fn<(root: string, file: string) => Promise<unknown>>(),
  writeIndexJson:
    vi.fn<(root: string, file: string, value: unknown) => Promise<void>>(),
  embedChunkIndex: vi.fn<() => Promise<void>>(),
}));

vi.mock("../types/filesystem", () => ({
  getFileSystem: async () => ({ readFile }),
  isTauriEnvironment: () => false,
}));
vi.mock("../services/vault/indexStorage", () => ({
  LINK_INDEX_FILE: "link-index.json",
  CHUNK_INDEX_FILE: "chunk-index.json",
  VECTOR_INDEX_FILE: "vector-index.json",
  readIndexJson,
  writeIndexJson,
}));
vi.mock("../services/vault/semanticEmbedService", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  embedChunkIndex,
}));
vi.mock("../services/vault/builtinEmbedding", () => ({
  BUILTIN_EMBEDDING_MODEL: "test-model",
  isBuiltinEmbeddingModelCached: async () => true,
}));
vi.mock("../components/editor/livePreview/wiki", () => ({
  invalidateLivePreviewWikiCachesForPath: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nodes(root: string): FileNode[] {
  return ["a", "b", "target"].map((name) => ({
    id: `${root}/${name}.md`,
    path: `${root}/${name}.md`,
    name: `${name}.md`,
    type: "file",
  }));
}

async function seedVault(root: string) {
  const files = nodes(root);
  for (const file of files)
    disk.set(
      file.path,
      `# ${file.name}\nOriginal paragraph with enough text for the retrieval index.`,
    );
  const read = async (path: string) => disk.get(path)!;
  cache.set(
    `${root}:${LINK_INDEX_FILE}`,
    await buildFullLinkIndex({ files, vaultRoot: root, readFile: read }),
  );
  cache.set(
    `${root}:${CHUNK_INDEX_FILE}`,
    await buildFullChunkIndex({ files, vaultRoot: root, readFile: read }),
  );
  cache.set(`${root}:${VECTOR_INDEX_FILE}`, {
    version: 1,
    vaultRoot: root,
    builtAt: 0,
    model: "",
    dims: 0,
    records: [],
  });
  return files;
}

async function openVault(root: string) {
  act(() => useAppStore.setState({ rootFolderPath: root, files: nodes(root) }));
  await waitFor(() => {
    expect(useAppStore.getState().linkIndex?.vaultRoot).toBe(root);
    expect(useAppStore.getState().chunkIndex?.vaultRoot).toBe(root);
    expect(getActiveSemanticVaultRoot()).toBe(root);
  });
}

async function renderReady() {
  const hook = renderHook(() => useVaultIndexLifecycle());
  await waitFor(() => expect(getActiveChunkIndex()?.vaultRoot).toBe("/vault"));
  return hook;
}

beforeEach(async () => {
  disk.clear();
  cache.clear();
  clearSemanticRuntime();
  readFile.mockReset().mockImplementation(async (path) => disk.get(path)!);
  readIndexJson
    .mockReset()
    .mockImplementation(
      async (root, file) => cache.get(`${root}:${file}`) ?? null,
    );
  writeIndexJson.mockReset().mockImplementation(async (root, file, value) => {
    cache.set(`${root}:${file}`, value);
  });
  embedChunkIndex.mockReset().mockResolvedValue(undefined);
  await seedVault("/vault");
  await seedVault("/other");
  useAppStore.setState({
    rootFolderPath: "/vault",
    files: nodes("/vault"),
    fileContents: {},
    linkIndex: null,
    chunkIndex: null,
    settings: {
      ...defaultSettings,
      embeddingProvider: "none",
      indexExcludeGlobs: [],
    },
  });
});
afterEach(() => {
  cleanup();
  clearSemanticRuntime();
});

describe("知识库索引任务的顺序与生命周期", () => {
  it("bounds progress publications while still completing a large index", async () => {
    cache.clear();
    const files: FileNode[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `/vault/n${i}.md`,
      path: `/vault/n${i}.md`,
      name: `n${i}.md`,
      type: "file",
    }));
    for (const file of files) disk.set(file.path, "# Note\n\n[[n0]]");
    useAppStore.setState({ files });
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const progress = vi.spyOn(useAppStore.getState(), "setLinkIndexProgress");
    try {
      await renderReady();
      expect(
        Object.keys(useAppStore.getState().linkIndex!.outbounds),
      ).toHaveLength(1000);
      expect(
        progress.mock.calls.filter(([value]) => value.phase === "building")
          .length,
      ).toBeLessThanOrEqual(3);
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ done: 1000, total: 1000 }),
      );
      expect(useAppStore.getState().linkIndexProgress.phase).toBe("idle");
    } finally {
      now.mockRestore();
      progress.mockRestore();
    }
  });
  it.each(["/vault/Flow.excalidraw", "/vault/image.png"])(
    "保存 %s 不把附件原始数据写入检索索引",
    async (path) => {
      useAppStore.setState({
        files: [
          ...nodes("/vault"),
          { id: path, path, name: path.split("/").pop()!, type: "file" },
        ],
      });
      const hook = await renderReady();
      readFile.mockClear();
      writeIndexJson.mockClear();
      await act(async () => {
        await hook.result.current.invalidateFile(
          path,
          '{"strokeStyle":"solid","versionNonce":123456789,"elements":[]}',
        );
      });
      expect(useAppStore.getState().linkIndex?.outbounds[path]).toBeUndefined();
      expect(getActiveChunkIndex()?.byPath[path]).toBeUndefined();
      expect(readFile).not.toHaveBeenCalled();
      expect(writeIndexJson).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "缓存中的原生画板片段不会恢复到仅检索（双链缓存也有污染：%s）",
    async (dirtyLinks) => {
      const path = "/vault/Flow.excalidraw";
      const chunks = cache.get(
        `/vault:${CHUNK_INDEX_FILE}`,
      ) as ChunkIndexSnapshot;
      const legacy = {
        ...chunks.byPath["/vault/a.md"][0],
        id: "Flow.excalidraw#0",
        path,
        relPath: "Flow.excalidraw",
        text: '{"strokeStyle":"solid","versionNonce":123456789,"elements":[]}',
      };
      cache.set(`/vault:${CHUNK_INDEX_FILE}`, {
        ...chunks,
        byPath: { ...chunks.byPath, [path]: [legacy] },
      });
      if (dirtyLinks) {
        const links = cache.get(
          `/vault:${LINK_INDEX_FILE}`,
        ) as LinkIndexSnapshot;
        cache.set(`/vault:${LINK_INDEX_FILE}`, {
          ...links,
          outbounds: { ...links.outbounds, [path]: [] },
        });
      }
      useAppStore.setState({
        files: [
          ...nodes("/vault"),
          { id: path, path, name: "Flow.excalidraw", type: "file" },
        ],
      });
      await renderReady();
      await waitFor(() =>
        expect(
          (cache.get(`/vault:${CHUNK_INDEX_FILE}`) as ChunkIndexSnapshot)
            .byPath[path],
        ).toBeUndefined(),
      );
      const hits = await retrieve({
        query: "strokeStyle",
        chunkIndex: getActiveChunkIndex(),
        vectorStore: null,
        embeddingProvider: null,
        retrieve: { mode: "keyword" },
      });
      expect(hits).toEqual([]);
      expect(useAppStore.getState().linkIndex?.outbounds[path]).toBeUndefined();
      expect(readFile.mock.calls.some(([readPath]) => readPath === path)).toBe(
        false,
      );
      expect(Object.keys(getActiveChunkIndex()?.byPath ?? {})).toEqual(
        nodes("/vault").map((file) => file.path),
      );
    },
  );

  it.each([true, false])(
    "空库恢复或清空目录后新增第一篇笔记也会更新索引（初始为空：%s）",
    async (initiallyEmpty) => {
      if (initiallyEmpty) {
        cache.set(
          `/vault:${LINK_INDEX_FILE}`,
          await buildFullLinkIndex({
            files: [],
            vaultRoot: "/vault",
            readFile,
          }),
        );
        cache.set(
          `/vault:${CHUNK_INDEX_FILE}`,
          await buildFullChunkIndex({
            files: [],
            vaultRoot: "/vault",
            readFile,
          }),
        );
        useAppStore.setState({ files: [] });
      }
      await renderReady();
      if (!initiallyEmpty) act(() => useAppStore.setState({ files: [] }));
      await waitFor(() => {
        expect(useAppStore.getState().linkIndex?.outbounds).toEqual({});
        expect(useAppStore.getState().chunkIndex?.byPath).toEqual({});
      });
      const path = "/vault/first.md";
      disk.set(
        path,
        "# First note\nA newly added paragraph with enough retrieval context and [[target]].",
      );
      act(() =>
        useAppStore.setState({
          files: [{ id: path, path, name: "first.md", type: "file" }],
        }),
      );
      await waitFor(() => {
        expect(
          useAppStore.getState().linkIndex?.outbounds[path][0].targetRaw,
        ).toBe("target");
        expect(
          useAppStore.getState().chunkIndex?.byPath[path][0].text,
        ).toContain("First note");
      });
    },
  );

  it.each([LINK_INDEX_FILE, CHUNK_INDEX_FILE])(
    "缺少 %s 缓存时能完成恢复与重建",
    async (missingFile) => {
      cache.delete(`/vault:${missingFile}`);
      await renderReady();
      await waitFor(() => {
        expect(
          Object.keys(useAppStore.getState().linkIndex?.outbounds ?? {}),
        ).toHaveLength(3);
        expect(
          useAppStore.getState().chunkIndex?.byPath["/vault/a.md"][0].text,
        ).toContain("Original paragraph");
        expect(cache.has(`/vault:${missingFile}`)).toBe(true);
      });
    },
  );

  it("同批多文件保存同时保留双链与检索片段", async () => {
    await renderReady();
    act(() => {
      notifyVaultFileSaved(
        "/vault/a.md",
        "# Updated A\nA saved paragraph that remains available in retrieval. [[target]]",
      );
      notifyVaultFileSaved(
        "/vault/b.md",
        "# Updated B\nA different saved paragraph that remains available in retrieval. [[target]]",
      );
      flushVaultFileSavedNotificationsForTests();
    });
    await waitFor(() => {
      const state = useAppStore.getState();
      expect(state.linkIndex?.inbounds["/vault/target.md"]).toEqual([
        "/vault/a.md",
        "/vault/b.md",
      ]);
      expect(state.chunkIndex?.byPath["/vault/a.md"][0].text).toContain(
        "Updated A",
      );
      expect(state.chunkIndex?.byPath["/vault/b.md"][0].text).toContain(
        "Updated B",
      );
    });
    expect(embedChunkIndex).not.toHaveBeenCalled();
  });

  it("延迟的旧库保存不污染新库，也不阻塞新库缓存恢复", async () => {
    const hook = await renderReady();
    const pendingRead = deferred<string>();
    readFile.mockImplementationOnce(() => pendingRead.promise);
    let updating!: Promise<void>;
    act(() => {
      updating = hook.result.current.invalidateFile("/vault/a.md");
    });
    await waitFor(() => expect(readFile).toHaveBeenCalledWith("/vault/a.md"));
    await openVault("/other");
    const writesBefore = writeIndexJson.mock.calls.length;
    await act(async () => {
      pendingRead.resolve("# Late\n[[target]]");
      await updating;
    });
    expect(writeIndexJson).toHaveBeenCalledTimes(writesBefore);
    expect(useAppStore.getState().linkIndex?.vaultRoot).toBe("/other");
    expect(getActiveChunkIndex()?.vaultRoot).toBe("/other");
  });

  it.each([LINK_INDEX_FILE, CHUNK_INDEX_FILE, VECTOR_INDEX_FILE])(
    "切库时丢弃延迟的 %s 缓存恢复",
    async (blockedFile) => {
      const pendingCache = deferred<unknown>();
      readIndexJson.mockImplementation(async (root, file) =>
        root === "/vault" && file === blockedFile
          ? pendingCache.promise
          : (cache.get(`${root}:${file}`) ?? null),
      );
      renderHook(() => useVaultIndexLifecycle());
      await waitFor(() =>
        expect(readIndexJson).toHaveBeenCalledWith("/vault", blockedFile),
      );
      await openVault("/other");
      await act(async () => {
        pendingCache.resolve(cache.get(`/vault:${blockedFile}`));
      });
      expect(useAppStore.getState().linkIndex?.vaultRoot).toBe("/other");
      expect(useAppStore.getState().chunkIndex?.vaultRoot).toBe("/other");
      expect(getActiveChunkIndex()?.vaultRoot).toBe("/other");
      expect(writeIndexJson).not.toHaveBeenCalled();
    },
  );

  it.each([1, 3])(
    "切库时停止全量重建第 %i 次延迟读取后的写回",
    async (blockedRead) => {
      const hook = await renderReady();
      const pendingRead = deferred<string>();
      let reads = 0;
      readFile.mockImplementation(async (path) =>
        ++reads === blockedRead ? pendingRead.promise : disk.get(path)!,
      );
      let rebuilding!: Promise<void>;
      act(() => {
        rebuilding = hook.result.current.rebuildLinkIndex();
      });
      await waitFor(() => expect(readFile).toHaveBeenCalledTimes(blockedRead));
      await openVault("/other");
      const writesBefore = writeIndexJson.mock.calls.length;
      await act(async () => {
        pendingRead.resolve("# Late\n[[target]]");
        await rebuilding;
      });
      expect(writeIndexJson).toHaveBeenCalledTimes(writesBefore);
      expect(useAppStore.getState().linkIndex?.vaultRoot).toBe("/other");
      expect(getActiveChunkIndex()?.vaultRoot).toBe("/other");
    },
  );

  it("全量重建期间的多文件保存随后更新最新快照", async () => {
    const hook = await renderReady();
    const pendingRead = deferred<string>();
    readFile.mockImplementationOnce(() => pendingRead.promise);
    let rebuilding!: Promise<void>;
    act(() => {
      rebuilding = hook.result.current.rebuildLinkIndex();
    });
    await waitFor(() => expect(readFile).toHaveBeenCalledOnce());
    const contentA =
        "# Saved A\nA saved paragraph that remains available in retrieval. [[target]]",
      contentB =
        "# Saved B\nA different saved paragraph that remains available in retrieval. [[target]]";
    disk.set("/vault/a.md", contentA);
    disk.set("/vault/b.md", contentB);
    let updating!: Promise<void[]>;
    act(() => {
      updating = Promise.all([
        hook.result.current.invalidateFile("/vault/a.md", contentA),
        hook.result.current.invalidateFile("/vault/b.md", contentB),
      ]);
    });
    await act(async () => {
      pendingRead.resolve("# Original A");
      await rebuilding;
      await updating;
    });
    expect(
      useAppStore.getState().linkIndex?.inbounds["/vault/target.md"],
    ).toEqual(["/vault/a.md", "/vault/b.md"]);
    expect(
      useAppStore.getState().chunkIndex?.byPath["/vault/a.md"][0].text,
    ).toContain("Saved A");
    expect(
      useAppStore.getState().chunkIndex?.byPath["/vault/b.md"][0].text,
    ).toContain("Saved B");
  });

  it("全量重建期间新增的文件由随后目录扫描补齐", async () => {
    const hook = await renderReady();
    const pendingRead = deferred<string>();
    readFile.mockImplementationOnce(() => pendingRead.promise);
    let rebuilding!: Promise<void>;
    act(() => {
      rebuilding = hook.result.current.rebuildLinkIndex();
    });
    await waitFor(() => expect(readFile).toHaveBeenCalledOnce());
    disk.set(
      "/vault/new.md",
      "# Added during rebuild\nA new reading paragraph with a link to [[target]] and enough context.",
    );
    act(() =>
      useAppStore.setState({
        files: [
          ...nodes("/vault"),
          {
            id: "/vault/new.md",
            path: "/vault/new.md",
            name: "new.md",
            type: "file",
          },
        ],
      }),
    );
    await act(async () => {
      pendingRead.resolve(disk.get("/vault/a.md")!);
      await rebuilding;
    });
    await waitFor(() => {
      expect(
        useAppStore.getState().linkIndex?.inbounds["/vault/target.md"],
      ).toContain("/vault/new.md");
      expect(
        useAppStore.getState().chunkIndex?.byPath["/vault/new.md"][0].text,
      ).toContain("Added during rebuild");
    });
  });

  it("离开后返回同一库也不会接受旧代际保存", async () => {
    const hook = await renderReady();
    const pendingRead = deferred<string>();
    readFile.mockImplementationOnce(() => pendingRead.promise);
    let updating!: Promise<void>;
    act(() => {
      updating = hook.result.current.invalidateFile("/vault/a.md");
    });
    await waitFor(() => expect(readFile).toHaveBeenCalledOnce());
    await openVault("/other");
    act(() =>
      useAppStore.setState({
        rootFolderPath: "/vault",
        files: nodes("/vault"),
      }),
    );
    await act(async () => {
      pendingRead.resolve("# Old generation\n[[target]]");
      await updating;
    });
    await waitFor(() =>
      expect(getActiveChunkIndex()?.vaultRoot).toBe("/vault"),
    );
    expect(useAppStore.getState().linkIndex?.outbounds["/vault/a.md"]).toEqual(
      [],
    );
    expect(
      (cache.get(`/vault:${LINK_INDEX_FILE}`) as LinkIndexSnapshot).outbounds[
        "/vault/a.md"
      ],
    ).toEqual([]);
    expect(writeIndexJson).not.toHaveBeenCalled();
  });

  it("切库时丢弃目录增量扫描的迟到结果", async () => {
    await renderReady();
    const pendingRead = deferred<string>();
    readFile.mockImplementationOnce(() => pendingRead.promise);
    act(() =>
      useAppStore.setState({
        files: [
          ...nodes("/vault"),
          {
            id: "/vault/new.md",
            path: "/vault/new.md",
            name: "new.md",
            type: "file",
          },
        ],
      }),
    );
    await waitFor(() => expect(readFile).toHaveBeenCalledWith("/vault/new.md"));
    await openVault("/other");
    await act(async () => {
      pendingRead.resolve("# Late new file\n[[target]]");
    });
    expect(useAppStore.getState().linkIndex?.vaultRoot).toBe("/other");
    expect(getActiveChunkIndex()?.vaultRoot).toBe("/other");
    expect(writeIndexJson).not.toHaveBeenCalled();
  });
});
