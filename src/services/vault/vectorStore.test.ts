import { describe, expect, it } from "vitest";
import {
  packVectorSnapshot,
  unpackVectorSnapshot,
  type VectorStoreSnapshot,
} from "./vectorStore";

function buildSnapshot(): VectorStoreSnapshot {
  return {
    version: 1,
    vaultRoot: "/vault",
    model: "builtin:test-model",
    dims: 4,
    builtAt: 1720000000000,
    records: [
      {
        id: "notes/a.md#0",
        contentHash: "hash-a",
        values: [0.25, -0.5, 1.125, 0],
      },
      {
        id: "notes/b.md#1",
        contentHash: "hash-b",
        values: [0.1, 0.2, -0.3, 0.4],
      },
    ],
  };
}

describe("packVectorSnapshot / unpackVectorSnapshot", () => {
  it("round-trips records through the packed base64 form", () => {
    const snapshot = buildSnapshot();
    const packed = packVectorSnapshot(snapshot);

    expect(packed.encoding).toBe("f32-b64");
    expect(packed.records).toHaveLength(2);
    expect(typeof packed.records[0]!.v).toBe("string");

    const unpacked = unpackVectorSnapshot(packed);
    expect(unpacked).not.toBeNull();
    expect(unpacked!.vaultRoot).toBe(snapshot.vaultRoot);
    expect(unpacked!.model).toBe(snapshot.model);
    expect(unpacked!.dims).toBe(snapshot.dims);
    expect(unpacked!.builtAt).toBe(snapshot.builtAt);

    for (let i = 0; i < snapshot.records.length; i += 1) {
      const original = snapshot.records[i]!;
      const restored = unpacked!.records[i]!;
      expect(restored.id).toBe(original.id);
      expect(restored.contentHash).toBe(original.contentHash);
      expect(restored.values).toHaveLength(original.values.length);
      for (let dim = 0; dim < original.values.length; dim += 1) {
        expect(restored.values[dim]).toBeCloseTo(original.values[dim]!, 6);
      }
    }
  });

  it("survives a JSON serialization round-trip", () => {
    const snapshot = buildSnapshot();
    const raw = JSON.parse(JSON.stringify(packVectorSnapshot(snapshot)));

    const unpacked = unpackVectorSnapshot(raw);
    expect(unpacked).not.toBeNull();
    expect(unpacked!.records[0]!.values[2]).toBeCloseTo(1.125, 6);
  });

  it("accepts the legacy plain-array snapshot format", () => {
    const legacy = buildSnapshot();
    const unpacked = unpackVectorSnapshot(JSON.parse(JSON.stringify(legacy)));

    expect(unpacked).not.toBeNull();
    expect(unpacked!.records).toEqual(legacy.records);
  });

  it("rejects unrecognizable payloads", () => {
    expect(unpackVectorSnapshot(null)).toBeNull();
    expect(unpackVectorSnapshot("junk")).toBeNull();
    expect(unpackVectorSnapshot({ version: 2, records: [] })).toBeNull();
    expect(
      unpackVectorSnapshot({
        version: 1,
        records: [{ id: "a", contentHash: "h" }],
      }),
    ).toBeNull();
    expect(
      unpackVectorSnapshot({
        version: 1,
        records: [{ id: 42, v: "AAAA" }],
      }),
    ).toBeNull();
  });

  it("packs large vectors above the base64 chunking threshold", () => {
    const values = Array.from({ length: 40000 }, (_, i) => Math.sin(i / 1000));
    const snapshot: VectorStoreSnapshot = {
      version: 1,
      vaultRoot: "/vault",
      model: "builtin:test-model",
      dims: values.length,
      builtAt: 1,
      records: [{ id: "big#0", contentHash: "big", values }],
    };

    const unpacked = unpackVectorSnapshot(packVectorSnapshot(snapshot));
    expect(unpacked).not.toBeNull();
    expect(unpacked!.records[0]!.values).toHaveLength(values.length);
    expect(unpacked!.records[0]!.values[12345]).toBeCloseTo(values[12345]!, 6);
  });
});
