import type { AppSettings } from "../../types";
import type { ChunkIndexSnapshot, TextChunk } from "../../types/vaultIndex";
import { BUILTIN_EMBEDDING_MODEL } from "./builtinEmbedding";
import { createEmbeddingProvider } from "./embeddingProvider";
import { diffChunks } from "./chunkService";
import {
  CHUNK_INDEX_FILE,
  VECTOR_INDEX_FILE,
  writeIndexJson,
} from "./indexStorage";
import type { VectorStore, VectorStoreSnapshot } from "./vectorStore";

const EMBED_BATCH = 16;
const BUILTIN_EMBED_BATCH = 4;

/** Stable model id stored on VectorStore / disk snapshots. */
export function resolveEmbeddingModelId(settings: {
  embeddingProvider?: AppSettings["embeddingProvider"];
  embeddingModel?: string;
}): string {
  const provider = settings.embeddingProvider ?? "builtin";
  if (provider === "none") return "";
  if (provider === "builtin") return `builtin:${BUILTIN_EMBEDDING_MODEL}`;
  return `${provider}:${settings.embeddingModel?.trim() || "nomic-embed-text"}`;
}

/**
 * True when a persisted vector snapshot matches the current embedding
 * provider/model (and has a positive dims when it contains records).
 */
export function isCompatibleVectorSnapshot(
  snapshot: VectorStoreSnapshot | null | undefined,
  settings: {
    embeddingProvider?: AppSettings["embeddingProvider"];
    embeddingModel?: string;
  },
): boolean {
  if (!snapshot) return false;
  const expected = resolveEmbeddingModelId(settings);
  if (!expected) return snapshot.records.length === 0;
  if (snapshot.model !== expected) return false;
  if (snapshot.records.length === 0) return true;
  if (snapshot.dims <= 0) return false;
  // Reject corrupt snapshots where declared dims disagree with vectors.
  const sample = snapshot.records[0];
  if (
    sample &&
    sample.values.length > 0 &&
    sample.values.length !== snapshot.dims
  ) {
    return false;
  }
  return true;
}

export async function embedChunkIndex(options: {
  chunkIndex: ChunkIndexSnapshot;
  vectorStore: VectorStore;
  settings: AppSettings;
  previousByPath?: Record<string, TextChunk[]>;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
  /** Force full re-embed even if content hashes match. */
  forceFullReembed?: boolean;
}): Promise<void> {
  const provider = createEmbeddingProvider(options.settings);
  if (provider.id === "none") {
    options.vectorStore.load(null);
    return;
  }

  const model = resolveEmbeddingModelId(options.settings);
  const modelChanged =
    Boolean(options.vectorStore.model) && options.vectorStore.model !== model;
  const forceFull =
    options.forceFullReembed === true ||
    modelChanged ||
    !isCompatibleVectorSnapshot(
      options.vectorStore.toSnapshot(),
      options.settings,
    );

  if (forceFull) {
    // Drop stale vectors from a previous provider/model so contentHash hits
    // cannot keep cross-model embeddings around.
    options.vectorStore.load(null);
  }

  options.vectorStore.model = model;
  const batchSize =
    provider.id === "builtin" ? BUILTIN_EMBED_BATCH : EMBED_BATCH;
  options.vectorStore.vaultRoot = options.chunkIndex.vaultRoot;

  const previousByPath = forceFull ? undefined : options.previousByPath;
  const upsertChunks: TextChunk[] = [];
  const removeIds: string[] = [];

  for (const [path, chunks] of Object.entries(options.chunkIndex.byPath)) {
    const previous = previousByPath?.[path] ?? [];
    if (forceFull) {
      upsertChunks.push(...chunks);
      continue;
    }
    const diff = diffChunks(previous, chunks);
    upsertChunks.push(...diff.upsert);
    removeIds.push(...diff.removeIds);
    // Also embed chunks whose vectors are missing even if hash matches.
    for (const chunk of chunks) {
      const existing = options.vectorStore.get(chunk.id);
      if (!existing || existing.contentHash !== chunk.contentHash) {
        if (!upsertChunks.some((item) => item.id === chunk.id)) {
          upsertChunks.push(chunk);
        }
      }
    }
  }

  // Drop vectors for removed paths entirely.
  const currentIds = new Set(
    Object.values(options.chunkIndex.byPath)
      .flat()
      .map((chunk) => chunk.id),
  );
  for (const record of options.vectorStore.toSnapshot().records) {
    if (!currentIds.has(record.id)) {
      removeIds.push(record.id);
    }
  }

  if (removeIds.length > 0) {
    options.vectorStore.remove(removeIds);
  }

  for (let index = 0; index < upsertChunks.length; index += batchSize) {
    if (options.shouldCancel?.()) return;
    const batch = upsertChunks.slice(index, index + batchSize);
    options.onProgress?.(index, upsertChunks.length);
    const vectors = await provider.embed(batch.map((chunk) => chunk.text));
    options.vectorStore.upsert(
      batch.map((chunk, batchIndex) => ({
        id: chunk.id,
        contentHash: chunk.contentHash,
        values: vectors[batchIndex]!,
      })),
    );
    // Yield a macrotask between batches so pending input events are processed
    // even when a provider computes on the calling thread. Keeps the UI
    // clickable during long index embedding runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  options.onProgress?.(upsertChunks.length, upsertChunks.length);
  options.vectorStore.builtAt = Date.now();
}

export async function persistSemanticIndexes(options: {
  vaultRoot: string;
  chunkIndex: ChunkIndexSnapshot;
  vectorStore: VectorStore;
}): Promise<void> {
  await writeIndexJson(options.vaultRoot, CHUNK_INDEX_FILE, options.chunkIndex);
  if (options.vectorStore.size() > 0) {
    await writeIndexJson(
      options.vaultRoot,
      VECTOR_INDEX_FILE,
      options.vectorStore.toSnapshot(),
    );
  }
}

export async function loadVectorSnapshot(
  vaultRoot: string,
  read: <T>(vaultRoot: string, file: string) => Promise<T | null>,
): Promise<VectorStoreSnapshot | null> {
  return read<VectorStoreSnapshot>(vaultRoot, VECTOR_INDEX_FILE);
}
