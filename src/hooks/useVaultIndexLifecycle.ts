import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { getFileSystem } from "../types/filesystem";
import {
  buildFullLinkIndex,
  reconcileTreeWithIndex,
  reindexFileContents,
  removeFilesFromIndex,
  updateFilesInIndex,
} from "../services/vault/linkIndexService";
import type {
  ChunkIndexSnapshot,
  LinkIndexSnapshot,
} from "../types/vaultIndex";
import {
  CHUNK_INDEX_FILE,
  LINK_INDEX_FILE,
  VECTOR_INDEX_FILE,
  readIndexJson,
  writeIndexJson,
} from "../services/vault/indexStorage";
import {
  setVaultFileSavedHandler,
  setVaultRebuildHandler,
} from "../services/vault/linkIndexEvents";
import { buildFileTreeSignature } from "../utils/fileTree";
import {
  buildFullChunkIndex,
  removeChunkPaths,
  upsertChunkPaths,
} from "../services/vault/chunkIndexService";
import {
  clearSemanticRuntime,
  ensureActiveVectorStore,
  getActiveChunkIndex,
  setActiveChunkIndex,
} from "../services/vault/semanticIndexRuntime";
import {
  embedChunkIndex,
  isCompatibleVectorSnapshot,
} from "../services/vault/semanticEmbedService";
import {
  packVectorSnapshot,
  unpackVectorSnapshot,
} from "../services/vault/vectorStore";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isValidLinkSnapshot(
  value: LinkIndexSnapshot | null,
  vaultRoot: string,
): value is LinkIndexSnapshot {
  return (
    !!value &&
    value.version === 1 &&
    normalizePath(value.vaultRoot) === normalizePath(vaultRoot) &&
    typeof value.outbounds === "object" &&
    value.outbounds !== null
  );
}

function isValidChunkSnapshot(
  value: ChunkIndexSnapshot | null,
  vaultRoot: string,
): value is ChunkIndexSnapshot {
  return (
    !!value &&
    value.version === 1 &&
    normalizePath(value.vaultRoot) === normalizePath(vaultRoot) &&
    typeof value.byPath === "object" &&
    value.byPath !== null
  );
}

/**
 * Keeps vault link + chunk (+ optional embedding) indexes in sync.
 */
export function useVaultIndexLifecycle(): {
  rebuildLinkIndex: () => Promise<void>;
  invalidateFile: (path: string, content?: string) => Promise<void>;
} {
  const rootFolderPath = useAppStore((s) => s.rootFolderPath);
  const files = useAppStore((s) => s.files);
  const embeddingProvider = useAppStore(
    (s) => s.settings.embeddingProvider ?? "builtin",
  );
  const embeddingModel = useAppStore((s) => s.settings.embeddingModel ?? "");
  const generationRef = useRef(0);
  const buildingRef = useRef(false);
  const semanticEmbedGenerationRef = useRef(0);
  const prevPathsRef = useRef<string>("");
  /** File-tree changes that arrived while a full rebuild was running. */
  const reconcilePendingRef = useRef(false);
  const signatureAtBuildStartRef = useRef<string | null>(null);
  const syncSemanticStatus = useCallback((vectorCount: number) => {
    useAppStore.getState().setSemanticStatus(vectorCount > 0, vectorCount);
  }, []);

  const refreshSemanticForChunkIndex = useCallback(
    async (
      chunkIndex: ChunkIndexSnapshot,
      options?: {
        previousByPath?: ChunkIndexSnapshot["byPath"];
        /** When set, abort if vault generation moved on (rebuild / vault switch). */
        linkGeneration?: number;
        forceFullReembed?: boolean;
      },
    ) => {
      const embedGeneration = ++semanticEmbedGenerationRef.current;
      const state = useAppStore.getState();
      const vaultRoot = chunkIndex.vaultRoot;
      const isCurrent = () =>
        embedGeneration === semanticEmbedGenerationRef.current &&
        (options?.linkGeneration == null ||
          options.linkGeneration === generationRef.current) &&
        normalizePath(useAppStore.getState().rootFolderPath ?? "") ===
          normalizePath(vaultRoot);

      state.setChunkIndex(chunkIndex);
      setActiveChunkIndex(chunkIndex);
      await writeIndexJson(vaultRoot, CHUNK_INDEX_FILE, chunkIndex);
      if (!isCurrent()) return;

      const provider = state.settings.embeddingProvider ?? "builtin";
      const store = ensureActiveVectorStore(vaultRoot);
      if (provider === "none") {
        store.load(null);
        if (isCurrent()) syncSemanticStatus(0);
        return;
      }

      try {
        await embedChunkIndex({
          chunkIndex,
          vectorStore: store,
          settings: state.settings,
          previousByPath: options?.previousByPath,
          forceFullReembed: options?.forceFullReembed,
          shouldCancel: () => !isCurrent(),
        });
        if (!isCurrent()) return;
        if (store.size() > 0) {
          await writeIndexJson(
            vaultRoot,
            VECTOR_INDEX_FILE,
            packVectorSnapshot(store.toSnapshot()),
          );
        }
        if (isCurrent()) syncSemanticStatus(store.size());
      } catch (error) {
        if (!isCurrent()) return;
        console.warn("Failed to embed chunk index:", error);
        syncSemanticStatus(store.size());
      }
    },
    [syncSemanticStatus],
  );

  const reconcileCurrentTree = useCallback(async () => {
    const state = useAppStore.getState();
    const vaultRoot = state.rootFolderPath;
    const snapshot = state.linkIndex;
    if (!vaultRoot || !snapshot || buildingRef.current) return;

    const { toAdd, toRemove } = reconcileTreeWithIndex({
      snapshot,
      files: state.files,
    });
    if (toAdd.length === 0 && toRemove.length === 0) return;

    state.setLinkIndexProgress({
      phase: "updating",
      done: 0,
      total: toAdd.length,
      currentPath: null,
      error: null,
    });

    try {
      let next = snapshot;
      if (toRemove.length > 0) {
        next = removeFilesFromIndex(next, toRemove);
      }
      if (toAdd.length > 0 || toRemove.length > 0) {
        const fs = await getFileSystem();
        next = await updateFilesInIndex({
          snapshot: next,
          paths: toAdd,
          files: state.files,
          vaultRoot,
          readFile: (path) => fs.readFile(path),
          reresolveAll: true,
        });
      }

      useAppStore.getState().setLinkIndex(next);
      void writeIndexJson(vaultRoot, LINK_INDEX_FILE, next);

      let chunkIndex =
        state.chunkIndex ??
        createEmptyChunkFallback(vaultRoot, state.chunkIndex);
      const previousByPath = chunkIndex.byPath;
      if (toRemove.length > 0) {
        chunkIndex = removeChunkPaths(chunkIndex, toRemove);
      }
      if (toAdd.length > 0) {
        const fs = await getFileSystem();
        chunkIndex = await upsertChunkPaths({
          snapshot: chunkIndex,
          paths: toAdd,
          vaultRoot,
          readFile: (path) => fs.readFile(path),
        });
      }
      await refreshSemanticForChunkIndex(chunkIndex, { previousByPath });
    } catch (error) {
      console.warn("Failed to reconcile link index:", error);
    }
  }, [refreshSemanticForChunkIndex]);

  const reconcileCurrentTreeRef = useRef(reconcileCurrentTree);
  reconcileCurrentTreeRef.current = reconcileCurrentTree;

  const rebuildLinkIndex = useCallback(async () => {
    const state = useAppStore.getState();
    const vaultRoot = state.rootFolderPath;
    if (!vaultRoot) {
      state.setLinkIndex(null);
      state.setChunkIndex(null);
      state.setSemanticStatus(false, 0);
      clearSemanticRuntime();
      return;
    }

    const generation = ++generationRef.current;
    buildingRef.current = true;
    reconcilePendingRef.current = false;
    signatureAtBuildStartRef.current = buildFileTreeSignature(state.files);
    state.setLinkIndexProgress({
      phase: "building",
      done: 0,
      total: 0,
      currentPath: null,
      error: null,
    });

    try {
      const fs = await getFileSystem();
      const previousChunks = getActiveChunkIndex()?.byPath;
      const snapshot = await buildFullLinkIndex({
        files: state.files,
        vaultRoot,
        readFile: (path) => fs.readFile(path),
        onProgress: (done, total, currentPath) => {
          if (generation !== generationRef.current) return;
          useAppStore.getState().setLinkIndexProgress({
            phase: "building",
            done,
            total,
            currentPath: currentPath || null,
            error: null,
          });
        },
        shouldCancel: () => generation !== generationRef.current,
      });

      if (generation !== generationRef.current) return;
      state.setLinkIndex(snapshot);
      await writeIndexJson(snapshot.vaultRoot, LINK_INDEX_FILE, snapshot);

      const chunkIndex = await buildFullChunkIndex({
        files: state.files,
        vaultRoot,
        readFile: (path) => fs.readFile(path),
        shouldCancel: () => generation !== generationRef.current,
      });
      if (generation !== generationRef.current) return;
      await refreshSemanticForChunkIndex(chunkIndex, {
        previousByPath: previousChunks,
        linkGeneration: generation,
      });

      // Mark the tree we indexed; post-build reconcile handles later drift.
      prevPathsRef.current =
        signatureAtBuildStartRef.current ??
        buildFileTreeSignature(useAppStore.getState().files);
    } catch (error) {
      if (generation !== generationRef.current) return;
      useAppStore.getState().setLinkIndexProgress({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (generation === generationRef.current) {
        buildingRef.current = false;
        const currentSig = buildFileTreeSignature(useAppStore.getState().files);
        const drifted =
          reconcilePendingRef.current ||
          (signatureAtBuildStartRef.current !== null &&
            currentSig !== signatureAtBuildStartRef.current);
        reconcilePendingRef.current = false;
        signatureAtBuildStartRef.current = null;
        if (drifted) {
          // Consume the current signature and reconcile so mid-build adds
          // / removes / moves are not permanently skipped.
          prevPathsRef.current = currentSig;
          void reconcileCurrentTreeRef.current?.();
        }
      }
    }
  }, [refreshSemanticForChunkIndex]);

  const ensureIndex = useCallback(async () => {
    const state = useAppStore.getState();
    const vaultRoot = state.rootFolderPath;
    if (!vaultRoot) {
      state.setLinkIndex(null);
      state.setChunkIndex(null);
      state.setSemanticStatus(false, 0);
      clearSemanticRuntime();
      return;
    }

    const cached = await readIndexJson<LinkIndexSnapshot>(
      vaultRoot,
      LINK_INDEX_FILE,
    );
    const cachedChunks = await readIndexJson<ChunkIndexSnapshot>(
      vaultRoot,
      CHUNK_INDEX_FILE,
    );
    const cachedVectors = unpackVectorSnapshot(
      await readIndexJson<unknown>(vaultRoot, VECTOR_INDEX_FILE),
    );

    if (isValidLinkSnapshot(cached, vaultRoot)) {
      const { toAdd, toRemove } = reconcileTreeWithIndex({
        snapshot: cached,
        files: state.files,
      });
      if (toAdd.length === 0 && toRemove.length === 0) {
        state.setLinkIndex(cached);
        prevPathsRef.current = buildFileTreeSignature(state.files);

        if (isValidChunkSnapshot(cachedChunks, vaultRoot)) {
          state.setChunkIndex(cachedChunks);
          setActiveChunkIndex(cachedChunks);
          const store = ensureActiveVectorStore(vaultRoot);
          if (isCompatibleVectorSnapshot(cachedVectors, state.settings)) {
            store.load(cachedVectors);
            syncSemanticStatus(store.size());
            return;
          }
          // Snapshot from a different provider/model — rebuild vectors.
          store.load(null);
          await refreshSemanticForChunkIndex(cachedChunks, {
            forceFullReembed: true,
          });
          return;
        }

        const fs = await getFileSystem();
        const chunkIndex = await buildFullChunkIndex({
          files: state.files,
          vaultRoot,
          readFile: (path) => fs.readFile(path),
        });
        await refreshSemanticForChunkIndex(chunkIndex);
        return;
      }
    }

    await rebuildLinkIndex();
  }, [rebuildLinkIndex, refreshSemanticForChunkIndex, syncSemanticStatus]);

  const invalidateFile = useCallback(
    async (path: string, content?: string) => {
      const state = useAppStore.getState();
      const vaultRoot = state.rootFolderPath;
      const snapshot = state.linkIndex;
      if (!vaultRoot || !snapshot) return;

      try {
        const fs = await getFileSystem();
        const fileContent =
          content ?? state.fileContents[path] ?? (await fs.readFile(path));
        const next = await reindexFileContents({
          snapshot,
          pathContents: { [path]: fileContent },
          files: state.files,
          vaultRoot,
        });
        state.setLinkIndex(next);
        void writeIndexJson(vaultRoot, LINK_INDEX_FILE, next);

        const previousChunks = state.chunkIndex;
        const baseChunks =
          previousChunks ??
          createEmptyChunkFallback(vaultRoot, state.chunkIndex);
        const nextChunks = await upsertChunkPaths({
          snapshot: baseChunks,
          paths: [path],
          vaultRoot,
          readFile: async () => fileContent,
          contentsByPath: { [path]: fileContent },
        });
        await refreshSemanticForChunkIndex(nextChunks, {
          previousByPath: previousChunks?.byPath,
        });
      } catch (error) {
        console.warn("Failed to update link index for file:", path, error);
      }
    },
    [refreshSemanticForChunkIndex],
  );

  useEffect(() => {
    setVaultFileSavedHandler((path, content) => {
      void invalidateFile(path, content);
    });
    return () => setVaultFileSavedHandler(null);
  }, [invalidateFile]);

  useEffect(() => {
    setVaultRebuildHandler(rebuildLinkIndex);
    return () => setVaultRebuildHandler(null);
  }, [rebuildLinkIndex]);

  useEffect(() => {
    // Bump embed generation so in-flight jobs cannot write status for the old vault.
    semanticEmbedGenerationRef.current += 1;
    generationRef.current += 1;
    // Supersede any in-flight full rebuild so reconcile is not stuck behind
    // a cancelled build that never cleared buildingRef.
    buildingRef.current = false;
    reconcilePendingRef.current = false;
    signatureAtBuildStartRef.current = null;
    if (!rootFolderPath) {
      const state = useAppStore.getState();
      state.setLinkIndex(null);
      state.setChunkIndex(null);
      state.setSemanticStatus(false, 0);
      clearSemanticRuntime();
      prevPathsRef.current = "";
      return;
    }
    void ensureIndex();
  }, [rootFolderPath, ensureIndex]);

  // Re-embed when provider / model changes after an index already exists.
  const prevEmbeddingKeyRef = useRef(`${embeddingProvider}::${embeddingModel}`);
  useEffect(() => {
    const key = `${embeddingProvider}::${embeddingModel}`;
    if (prevEmbeddingKeyRef.current === key) return;
    prevEmbeddingKeyRef.current = key;
    const state = useAppStore.getState();
    const chunkIndex = state.chunkIndex;
    if (!state.rootFolderPath || !chunkIndex) return;
    void refreshSemanticForChunkIndex(chunkIndex, {
      forceFullReembed: true,
    });
  }, [embeddingProvider, embeddingModel, refreshSemanticForChunkIndex]);

  useEffect(() => {
    if (!rootFolderPath) return;
    const signature = buildFileTreeSignature(files);
    if (!prevPathsRef.current) {
      prevPathsRef.current = signature;
      return;
    }
    if (signature === prevPathsRef.current) return;

    // Do not consume the signature while a full rebuild is running — otherwise
    // mid-build adds/removes are skipped forever after buildingRef clears.
    if (buildingRef.current) {
      reconcilePendingRef.current = true;
      return;
    }

    prevPathsRef.current = signature;
    void reconcileCurrentTree();
  }, [files, rootFolderPath, reconcileCurrentTree]);

  return { rebuildLinkIndex, invalidateFile };
}

function createEmptyChunkFallback(
  vaultRoot: string,
  existing: ChunkIndexSnapshot | null,
): ChunkIndexSnapshot {
  return (
    existing ?? {
      version: 1,
      vaultRoot: vaultRoot.replace(/\\/g, "/"),
      builtAt: Date.now(),
      byPath: {},
    }
  );
}
