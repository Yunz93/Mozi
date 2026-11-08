import { afterEach, expect, it, vi } from "vitest";
import { VectorStore, type VectorStoreSnapshot } from "./vectorStore";

afterEach(() => vi.restoreAllMocks());
function legacy(
  snapshot: VectorStoreSnapshot,
  query: Float32Array,
  topK: number,
) {
  return snapshot.records
    .map((record) => {
      const values = Float32Array.from(record.values);
      let dot = 0,
        a = 0,
        b = 0;
      for (let d = 0; d < Math.min(values.length, query.length); d++) {
        dot += values[d] * query[d];
        a += query[d] * query[d];
        b += values[d] * values[d];
      }
      return {
        id: record.id,
        score: a === 0 || b === 0 ? 0 : dot / (Math.sqrt(a) * Math.sqrt(b)),
      };
    })
    .filter((r) => !(r.score <= 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));
}
function fixture(): VectorStoreSnapshot {
  let seed = 42;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
  return {
    version: 1,
    vaultRoot: "/vault",
    model: "fixture",
    dims: 32,
    builtAt: 123,
    records: Array.from({ length: 1200 }, (_, i) => ({
      id: `n${i}`,
      contentHash: `h${i}`,
      values: Array.from({ length: i % 23 === 0 ? 13 : 32 }, next),
    })),
  };
}
it("matches stable full-sort results for seeded, ragged vectors and all legacy K counts", () => {
  const snapshot = fixture();
  snapshot.records.push(
    { id: "tie-a", contentHash: "a", values: [1, 0] },
    { id: "tie-b", contentHash: "b", values: [1, 0] },
    { id: "zero", contentHash: "z", values: [0, 0] },
  );
  const store = new VectorStore();
  store.load(snapshot);
  for (const query of [
    Float32Array.from([1, 0]),
    Float32Array.from({ length: 32 }, (_, i) => Math.sin(i)),
    new Float32Array(32),
  ]) {
    for (const k of [1, 3, 10, 0, -1, 2.5, NaN, Infinity, 2000])
      expect(store.search(query, k)).toEqual(legacy(snapshot, query, k));
  }
  store.remove(["n0", "tie-a"]);
  store.remapIds({ "tie-b": "tie-renamed", n1: "renamed" });
  for (const k of [1, 10, 2000])
    expect(store.search(Float32Array.from([1, 0]), k)).toEqual(
      legacy(store.toSnapshot(), Float32Array.from([1, 0]), k),
    );
});
it("converts vectors only at load/upsert boundaries and owns its input buffers", () => {
  const store = new VectorStore();
  const input = Float32Array.from([1, 0]);
  store.upsert([{ id: "a", contentHash: "hash", values: input }]);
  input[0] = -1;
  const from = vi.spyOn(Float32Array, "from");
  for (let i = 0; i < 20; i++)
    expect(store.search(new Float32Array([1, 0]), 1)[0].id).toBe("a");
  expect(from).not.toHaveBeenCalled();
  expect(store.getContentHash("a")).toBe("hash");
  expect([...store.ids()]).toEqual(["a"]);
  const snapshot = store.toSnapshot();
  snapshot.records[0].values[0] = -1;
  expect(store.get("a")?.values).toEqual([1, 0]);
});
it("preserves the rare legacy non-finite comparator behavior", () => {
  const snapshot = fixture();
  snapshot.records[2].values[0] = NaN;
  const store = new VectorStore();
  store.load(snapshot);
  const query = Float32Array.from([1, 0, 1]);
  expect(store.search(query, 10)).toEqual(legacy(snapshot, query, 10));
  store.load(null);
  expect(store.search(query, 10)).toEqual([]);
});
