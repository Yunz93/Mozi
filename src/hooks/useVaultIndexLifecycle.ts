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
import { flattenFiles, isMarkdownFile } from "../utils/markdownLinkUtils";
import { pathMatchesAnyGlob } from "../utils/pathGlob";
import type { FileNode } from "../types";
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
import { invalidateLivePreviewWikiCachesForPath } from "../components/editor/livePreview/wiki";
import { isBuiltinEmbeddingModelCached } from "../services/vault/builtinEmbedding";
import {
  consumeBuiltinEmbeddingSkipNotice,
  requestBuiltinEmbeddingDownloadConsent,
  resolveBuiltinEmbeddingDownloadAction,
} from "../services/vault/builtinEmbeddingConsent";
import { t } from "../utils/i18n";

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
  files: FileNode[],
  excludeGlobs?: string[],
): value is ChunkIndexSnapshot {
  if (
    !(
      !!value &&
      value.version === 1 &&
      normalizePath(value.vaultRoot) === normalizePath(vaultRoot) &&
      typeof value.byPath === "object" &&
      value.byPath !== null
    )
  )
    return false;
  const paths = new Set(
    flattenFiles(files)
      .filter(isMarkdownFile)
      .map((file) => normalizePath(file.path))
      .filter((path) => !pathMatchesAnyGlob(path, excludeGlobs, vaultRoot)),
  );
  // 旧版增量保存曾把画板和附件写入片段缓存，恢复前必须与当前 Markdown 范围一致。
  return (
    Object.keys(value.byPath).length === paths.size &&
    Object.keys(value.byPath).every((path) => paths.has(normalizePath(path)))
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
  const prevPathsRef = useRef<string | null>(null);
  /** File-tree changes that arrived while a full rebuild was running. */
  const reconcilePendingRef = useRef(false);
  const signatureAtBuildStartRef = useRef<string | null>(null);
  const indexTaskQueuesRef = useRef(new Map<string, Promise<unknown>>());
  const syncSemanticStatus = useCallback((vectorCount: number) => {
    useAppStore.getState().setSemanticStatus(vectorCount > 0, vectorCount);
  }, []);
  const isCurrentIndexContext = useCallback(
    (vaultRoot: string, generation: number) =>
      generation === generationRef.current &&
      normalizePath(useAppStore.getState().rootFolderPath ?? "") ===
        normalizePath(vaultRoot),
    [],
  );
  const queueIndexTask = useCallback(
    <T>(vaultRoot: string, task: () => Promise<T>): Promise<T> => {
      // 同库索引按顺序读取最新快照，切换到其他库时不等待旧库任务。
      const key = normalizePath(vaultRoot);
      const previous = indexTaskQueuesRef.current.get(key) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(task);
      indexTaskQueuesRef.current.set(key, next);
      const cleanup = () => {
        if (indexTaskQueuesRef.current.get(key) === next) {
          indexTaskQueuesRef.current.delete(key);
        }
      };
      void next.then(cleanup, cleanup);
      return next;
    },
    [],
  );

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
      const vaultRoot = chunkIndex.vaultRoot;
      const linkGeneration = options?.linkGeneration ?? generationRef.current;
      if (!isCurrentIndexContext(vaultRoot, linkGeneration)) return;
      const embedGeneration = ++semanticEmbedGenerationRef.current;
      const state = useAppStore.getState();
      const isCurrent = () =>
        embedGeneration === semanticEmbedGenerationRef.current &&
        isCurrentIndexContext(vaultRoot, linkGeneration);

      if (!isCurrent()) return;
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

      if (provider === "builtin") {
        const modelCached = await isBuiltinEmbeddingModelCached();
        if (!isCurrent()) return;
        const latestSettings = useAppStore.getState().settings;
        let consent =
          latestSettings.builtinEmbeddingDownloadConsent ?? "unknown";
        const privacyMode = latestSettings.privacyMode === true;
        let action = resolveBuiltinEmbeddingDownloadAction({
          consent,
          privacyMode,
          modelCached,
        });

        if (action === "prompt") {
          const granted = await requestBuiltinEmbeddingDownloadConsent();
          if (!isCurrent()) return;
          consent = granted ? "granted" : "denied";
          useAppStore.getState().updateSettings({
            builtinEmbeddingDownloadConsent: consent,
          });
          action = granted ? "allow" : "skip";
        }

        if (action === "skip") {
          store.load(null);
          if (isCurrent()) {
            syncSemanticStatus(0);
            if (consumeBuiltinEmbeddingSkipNotice()) {
              useAppStore
                .getState()
                .showNotification(
                  t(
                    latestSettings.language,
                    "notifications_builtinEmbeddingSkipped",
                  ),
                  "info",
                );
            }
          }
          return;
        }
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
    [isCurrentIndexContext, syncSemanticStatus],
  );

  const reconcileCurrentTree = useCallback(async () => {
    const vaultRoot = useAppStore.getState().rootFolderPath;
    if (!vaultRoot) return;
    const generation = generationRef.current;
    const isCurrent = () => isCurrentIndexContext(vaultRoot, generation);
    await queueIndexTask(vaultRoot, async () => {
      if (!isCurrent()) return;
      const state = useAppStore.getState();
      const snapshot = state.linkIndex;
      if (
        !snapshot ||
        normalizePath(snapshot.vaultRoot) !== normalizePath(vaultRoot)
      )
        return;

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
          if (!isCurrent()) return;
          next = await updateFilesInIndex({
            snapshot: next,
            paths: toAdd,
            files: state.files,
            vaultRoot,
            readFile: (path) => fs.readFile(path),
            reresolveAll: true,
          });
        }

        if (!isCurrent()) return;
        useAppStore.getState().setLinkIndex(next);
        await writeIndexJson(vaultRoot, LINK_INDEX_FILE, next);
        if (!isCurrent()) return;

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
            excludeGlobs: useAppStore.getState().settings.indexExcludeGlobs,
          });
        }
        if (!isCurrent()) return;
        await refreshSemanticForChunkIndex(chunkIndex, {
          previousByPath,
          linkGeneration: generation,
        });
        if (!isCurrent()) return;
      } catch (error) {
        if (!isCurrent()) return;
        console.warn("Failed to reconcile link index:", error);
      }
    });
  }, [isCurrentIndexContext, queueIndexTask, refreshSemanticForChunkIndex]);

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
    const isCurrent = () => isCurrentIndexContext(vaultRoot, generation);
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

    await queueIndexTask(vaultRoot, async () => {
      if (!isCurrent()) return;
      const state = useAppStore.getState();
      signatureAtBuildStartRef.current = buildFileTreeSignature(state.files);
      try {
        const fs = await getFileSystem();
        if (!isCurrent()) return;
        const previousChunks = getActiveChunkIndex()?.byPath;
        const snapshot = await buildFullLinkIndex({
          files: state.files,
          vaultRoot,
          readFile: (path) => fs.readFile(path),
          onProgress: (done, total, currentPath) => {
            if (!isCurrent()) return;
            useAppStore.getState().setLinkIndexProgress({
              phase: "building",
              done,
              total,
              currentPath: currentPath || null,
              error: null,
            });
          },
          shouldCancel: () => !isCurrent(),
        });

        if (!isCurrent()) return;
        state.setLinkIndex(snapshot);
        await writeIndexJson(snapshot.vaultRoot, LINK_INDEX_FILE, snapshot);
        if (!isCurrent()) return;

        const chunkIndex = await buildFullChunkIndex({
          files: state.files,
          vaultRoot,
          readFile: (path) => fs.readFile(path),
          shouldCancel: () => !isCurrent(),
          excludeGlobs: state.settings.indexExcludeGlobs,
        });
        if (!isCurrent()) return;
        await refreshSemanticForChunkIndex(chunkIndex, {
          previousByPath: previousChunks,
          linkGeneration: generation,
        });
        if (!isCurrent()) return;

        // Mark the tree we indexed; post-build reconcile handles later drift.
        prevPathsRef.current =
          signatureAtBuildStartRef.current ??
          buildFileTreeSignature(useAppStore.getState().files);
      } catch (error) {
        if (!isCurrent()) return;
        useAppStore.getState().setLinkIndexProgress({
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (isCurrent()) {
          buildingRef.current = false;
          const currentSig = buildFileTreeSignature(
            useAppStore.getState().files,
          );
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
    });
  }, [isCurrentIndexContext, queueIndexTask, refreshSemanticForChunkIndex]);

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

    const generation = generationRef.current;
    const isCurrent = () => isCurrentIndexContext(vaultRoot, generation);
    const needsRebuild = await queueIndexTask(vaultRoot, async () => {
      if (!isCurrent()) return false;
      const state = useAppStore.getState();
      const cached = await readIndexJson<LinkIndexSnapshot>(
        vaultRoot,
        LINK_INDEX_FILE,
      );
      if (!isCurrent()) return false;
      const cachedChunks = await readIndexJson<ChunkIndexSnapshot>(
        vaultRoot,
        CHUNK_INDEX_FILE,
      );
      if (!isCurrent()) return false;
      const cachedVectors = unpackVectorSnapshot(
        await readIndexJson<unknown>(vaultRoot, VECTOR_INDEX_FILE),
      );
      if (!isCurrent()) return false;

      if (isValidLinkSnapshot(cached, vaultRoot)) {
        const { toAdd, toRemove } = reconcileTreeWithIndex({
          snapshot: cached,
          files: state.files,
        });
        if (toAdd.length === 0 && toRemove.length === 0) {
          state.setLinkIndex(cached);
          prevPathsRef.current = buildFileTreeSignature(state.files);

          if (
            isValidChunkSnapshot(
              cachedChunks,
              vaultRoot,
              state.files,
              state.settings.indexExcludeGlobs,
            )
          ) {
            state.setChunkIndex(cachedChunks);
            setActiveChunkIndex(cachedChunks);
            const store = ensureActiveVectorStore(vaultRoot);
            if (isCompatibleVectorSnapshot(cachedVectors, state.settings)) {
              store.load(cachedVectors);
              syncSemanticStatus(store.size());
              return false;
            }
            // Snapshot from a different provider/model — rebuild vectors.
            store.load(null);
            await refreshSemanticForChunkIndex(cachedChunks, {
              forceFullReembed: true,
              linkGeneration: generation,
            });
            return false;
          }

          const fs = await getFileSystem();
          if (!isCurrent()) return false;
          const chunkIndex = await buildFullChunkIndex({
            files: state.files,
            vaultRoot,
            readFile: (path) => fs.readFile(path),
            excludeGlobs: state.settings.indexExcludeGlobs,
            shouldCancel: () => !isCurrent(),
          });
          if (!isCurrent()) return false;
          await refreshSemanticForChunkIndex(chunkIndex, {
            linkGeneration: generation,
          });
          return false;
        }
      }

      return true;
    });
    if (needsRebuild && isCurrent()) await rebuildLinkIndex();
  }, [
    isCurrentIndexContext,
    queueIndexTask,
    rebuildLinkIndex,
    refreshSemanticForChunkIndex,
    syncSemanticStatus,
  ]);

  const invalidateFile = useCallback(
    async (path: string, content?: string) => {
      const vaultRoot = useAppStore.getState().rootFolderPath;
      if (!vaultRoot) return;
      const generation = generationRef.current;
      const isCurrent = () => isCurrentIndexContext(vaultRoot, generation);
      await queueIndexTask(vaultRoot, async () => {
        if (!isCurrent()) return;
        const state = useAppStore.getState();
        const snapshot = state.linkIndex;
        if (
          !snapshot ||
          normalizePath(snapshot.vaultRoot) !== normalizePath(vaultRoot) ||
          !normalizePath(path).startsWith(
            `${normalizePath(vaultRoot).replace(/\/+$/, "")}/`,
          )
        )
          return;

        const isMarkdown = isMarkdownFile({ name: path });
        if (
          !isMarkdown &&
          !snapshot.outbounds[path] &&
          !state.chunkIndex?.byPath[path]
        )
          return;

        try {
          const fs = await getFileSystem();
          if (!isCurrent()) return;
          const fileContent = isMarkdown
            ? (content ?? state.fileContents[path] ?? (await fs.readFile(path)))
            : "";
          if (!isCurrent()) return;
          const next = await reindexFileContents({
            snapshot,
            pathContents: { [path]: fileContent },
            files: state.files,
            vaultRoot,
          });
          if (!isCurrent()) return;
          state.setLinkIndex(next);
          await writeIndexJson(vaultRoot, LINK_INDEX_FILE, next);
          if (!isCurrent()) return;

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
            excludeGlobs: state.settings.indexExcludeGlobs,
          });
          if (!isCurrent()) return;
          await refreshSemanticForChunkIndex(nextChunks, {
            previousByPath: previousChunks?.byPath,
            linkGeneration: generation,
          });
          if (!isCurrent()) return;
          invalidateLivePreviewWikiCachesForPath(path);
        } catch (error) {
          if (!isCurrent()) return;
          console.warn("Failed to update link index for file:", path, error);
        }
      });
    },
    [isCurrentIndexContext, queueIndexTask, refreshSemanticForChunkIndex],
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
      prevPathsRef.current = null;
      return;
    }
    clearSemanticRuntime();
    const state = useAppStore.getState();
    state.setLinkIndex(null);
    state.setChunkIndex(null);
    state.setSemanticStatus(false, 0);
    prevPathsRef.current = null;
    void ensureIndex();
    return () => {
      generationRef.current += 1;
      semanticEmbedGenerationRef.current += 1;
    };
  }, [rootFolderPath, ensureIndex]);

  // Re-embed when provider / model changes after an index already exists.
  const prevEmbeddingKeyRef = useRef(`${embeddingProvider}::${embeddingModel}`);
  useEffect(() => {
    const key = `${embeddingProvider}::${embeddingModel}`;
    if (prevEmbeddingKeyRef.current === key) return;
    prevEmbeddingKeyRef.current = key;
    const state = useAppStore.getState();
    const vaultRoot = state.rootFolderPath;
    if (!vaultRoot || !state.chunkIndex) return;
    const generation = generationRef.current;
    semanticEmbedGenerationRef.current += 1;
    void queueIndexTask(vaultRoot, async () => {
      if (!isCurrentIndexContext(vaultRoot, generation)) return;
      const chunkIndex = useAppStore.getState().chunkIndex;
      if (!chunkIndex) return;
      await refreshSemanticForChunkIndex(chunkIndex, {
        forceFullReembed: true,
        linkGeneration: generation,
      });
    });
  }, [
    embeddingProvider,
    embeddingModel,
    isCurrentIndexContext,
    queueIndexTask,
    refreshSemanticForChunkIndex,
  ]);

  useEffect(() => {
    if (!rootFolderPath) return;
    const signature = buildFileTreeSignature(files);
    if (prevPathsRef.current === null) {
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
