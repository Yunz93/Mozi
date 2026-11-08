export interface VectorRecord {
  id: string;
  contentHash: string;
  values: number[];
}

export interface VectorStoreSnapshot {
  version: 1;
  vaultRoot: string;
  model: string;
  dims: number;
  builtAt: number;
  records: VectorRecord[];
}

/**
 * Persisted on-disk form: Float32 values are base64-packed. Plain JSON number
 * arrays serialize each dimension as ~19 characters, so a moderate vault
 * produced a multi-megabyte file whose `JSON.parse` / `JSON.stringify` blocked
 * the UI thread at startup and on every save. Packing shrinks the file ~10x
 * and makes (de)serialization proportionally cheaper.
 */
export interface PackedVectorRecord {
  id: string;
  contentHash: string;
  /** base64 of the little-endian Float32 vector */
  v: string;
}

export interface PackedVectorStoreSnapshot {
  version: 1;
  encoding: "f32-b64";
  vaultRoot: string;
  model: string;
  dims: number;
  builtAt: number;
  records: PackedVectorRecord[];
}

const BASE64_CHUNK_SIZE = 0x8000;

function floatsToBase64(values: number[]): string {
  const floats = Float32Array.from(values);
  const bytes = new Uint8Array(floats.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

function base64ToFloats(encoded: string): number[] {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Array.from(new Float32Array(bytes.buffer));
}

export function packVectorSnapshot(
  snapshot: VectorStoreSnapshot,
): PackedVectorStoreSnapshot {
  return {
    version: 1,
    encoding: "f32-b64",
    vaultRoot: snapshot.vaultRoot,
    model: snapshot.model,
    dims: snapshot.dims,
    builtAt: snapshot.builtAt,
    records: snapshot.records.map((record) => ({
      id: record.id,
      contentHash: record.contentHash,
      v: floatsToBase64(record.values),
    })),
  };
}

/**
 * Accepts both the packed on-disk form and the legacy plain-array form.
 * Returns null when the payload is not a recognizable vector snapshot.
 */
export function unpackVectorSnapshot(raw: unknown): VectorStoreSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const snapshot = raw as Partial<PackedVectorStoreSnapshot> &
    Partial<VectorStoreSnapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.records)) return null;

  try {
    const records: VectorRecord[] = [];
    for (const record of snapshot.records as Array<
      Partial<PackedVectorRecord> & Partial<VectorRecord>
    >) {
      if (typeof record?.id !== "string") return null;
      if (typeof record.v === "string") {
        records.push({
          id: record.id,
          contentHash: record.contentHash ?? "",
          values: base64ToFloats(record.v),
        });
        continue;
      }
      if (Array.isArray(record.values)) {
        records.push({
          id: record.id,
          contentHash: record.contentHash ?? "",
          values: record.values,
        });
        continue;
      }
      return null;
    }

    return {
      version: 1,
      vaultRoot: snapshot.vaultRoot ?? "",
      model: snapshot.model ?? "",
      dims: snapshot.dims ?? 0,
      builtAt: snapshot.builtAt ?? 0,
      records,
    };
  } catch {
    return null;
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface RuntimeVectorRecord extends Omit<VectorRecord, "values"> {
  values: Float32Array;
}
interface ScoredVector {
  id: string;
  score: number;
  order: number;
}
function worse(a: ScoredVector, b: ScoredVector): boolean {
  return a.score < b.score || (a.score === b.score && a.order > b.order);
}

export class VectorStore {
  private records = new Map<string, RuntimeVectorRecord>();
  dims = 0;
  model = "";
  vaultRoot = "";
  builtAt = 0;

  load(snapshot: VectorStoreSnapshot | null): void {
    this.records.clear();
    if (!snapshot) {
      this.dims = 0;
      this.model = "";
      this.vaultRoot = "";
      this.builtAt = 0;
      return;
    }
    this.dims = snapshot.dims;
    this.model = snapshot.model;
    this.vaultRoot = snapshot.vaultRoot;
    this.builtAt = snapshot.builtAt;
    for (const record of snapshot.records) {
      this.records.set(record.id, {
        ...record,
        values: Float32Array.from(record.values),
      });
    }
  }

  toSnapshot(): VectorStoreSnapshot {
    return {
      version: 1,
      vaultRoot: this.vaultRoot,
      model: this.model,
      dims: this.dims,
      builtAt: this.builtAt || Date.now(),
      records: [...this.records.values()].map((record) => ({
        ...record,
        values: Array.from(record.values),
      })),
    };
  }

  upsert(
    entries: Array<{ id: string; contentHash: string; values: Float32Array }>,
  ): void {
    for (const entry of entries) {
      if (this.dims === 0) this.dims = entry.values.length;
      this.records.set(entry.id, {
        id: entry.id,
        contentHash: entry.contentHash,
        values: new Float32Array(entry.values),
      });
    }
    this.builtAt = Date.now();
  }

  remove(ids: string[]): void {
    for (const id of ids) {
      this.records.delete(id);
    }
    this.builtAt = Date.now();
  }

  /** Remap vector record ids (e.g. after note rename changes `relPath#n`). */
  remapIds(idMap: Record<string, string>): void {
    const entries = Object.entries(idMap);
    if (entries.length === 0) return;
    for (const [from, to] of entries) {
      if (!to || from === to) continue;
      const record = this.records.get(from);
      if (!record) continue;
      this.records.delete(from);
      this.records.set(to, { ...record, id: to });
    }
    this.builtAt = Date.now();
  }

  get(id: string): VectorRecord | undefined {
    const record = this.records.get(id);
    return record
      ? { ...record, values: Array.from(record.values) }
      : undefined;
  }

  getContentHash(id: string): string | undefined {
    return this.records.get(id)?.contentHash;
  }

  ids(): IterableIterator<string> {
    return this.records.keys();
  }

  size(): number {
    return this.records.size;
  }

  search(
    query: Float32Array,
    topK: number,
  ): Array<{ id: string; score: number }> {
    // Match Array.slice's legacy count semantics (including fractional/NaN/Inf).
    const limit = Math.min(this.records.size, Math.trunc(Math.max(1, topK)));
    if (!limit) return [];
    const heap: ScoredVector[] = [];
    let order = 0;
    for (const record of this.records.values()) {
      const position = order++;
      const score = cosineSimilarity(query, record.values);
      if (score <= 0) continue;
      // Malformed legacy snapshots can contain NaNs. Native stable sort has
      // special behavior for a NaN comparator; keep that rare compatibility path.
      if (!Number.isFinite(score)) return this.searchLegacy(query, topK);
      if (heap.length === limit && score <= heap[0].score) continue;
      const candidate = { id: record.id, score, order: position };
      if (heap.length < limit) {
        heap.push(candidate);
        let child = heap.length - 1;
        while (child > 0) {
          const parent = (child - 1) >> 1;
          if (!worse(heap[child], heap[parent])) break;
          [heap[child], heap[parent]] = [heap[parent], heap[child]];
          child = parent;
        }
      } else {
        heap[0] = candidate;
        let parent = 0;
        while (parent * 2 + 1 < heap.length) {
          let child = parent * 2 + 1;
          if (child + 1 < heap.length && worse(heap[child + 1], heap[child]))
            child++;
          if (!worse(heap[child], heap[parent])) break;
          [heap[child], heap[parent]] = [heap[parent], heap[child]];
          parent = child;
        }
      }
    }
    return heap
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map(({ id, score }) => ({ id, score }));
  }

  private searchLegacy(query: Float32Array, topK: number) {
    const scored: Array<{ id: string; score: number }> = [];
    for (const record of this.records.values()) {
      const score = cosineSimilarity(query, record.values);
      if (score <= 0) continue;
      scored.push({ id: record.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, topK));
  }
}
