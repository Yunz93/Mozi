import { describe, expect, it } from "vitest";
import { NoneEmbeddingProvider } from "./embeddingProvider";
import { keywordSearchChunks, retrieve } from "./retrieveService";
import { chunkMarkdownFile } from "./chunkService";
import { VectorStore } from "./vectorStore";
import type { ChunkIndexSnapshot } from "../../types/vaultIndex";

describe("retrieveService", () => {
  const chunk = chunkMarkdownFile({
    path: "/vault/alpha.md",
    vaultRoot: "/vault",
    content:
      "# Alpha\n\nThis note talks about knowledge base retrieval quality.\n",
  })[0]!;

  const snapshot: ChunkIndexSnapshot = {
    version: 1,
    vaultRoot: "/vault",
    builtAt: Date.now(),
    byPath: { "/vault/alpha.md": [chunk] },
  };

  it("finds keyword hits", () => {
    const hits = keywordSearchChunks([chunk], "knowledge base", 5);
    expect(hits.length).toBe(1);
    expect(hits[0]?.chunk.path).toBe("/vault/alpha.md");
  });

  it("falls back to keyword when embeddings are unavailable", async () => {
    const hits = await retrieve({
      query: "retrieval",
      chunkIndex: snapshot,
      vectorStore: new VectorStore(),
      embeddingProvider: new NoneEmbeddingProvider(),
      retrieve: { mode: "hybrid", topK: 5 },
    });
    expect(hits[0]?.chunk.path).toBe("/vault/alpha.md");
  });

  it("excludes glob-matched notes from keyword retrieve", async () => {
    const trash = chunkMarkdownFile({
      path: "/vault/.trash/old.md",
      vaultRoot: "/vault",
      content:
        "# Old\n\nThis note talks about knowledge base retrieval quality.\n",
    })[0]!;
    const snapshotWithTrash: ChunkIndexSnapshot = {
      ...snapshot,
      byPath: {
        ...snapshot.byPath,
        "/vault/.trash/old.md": [trash],
      },
    };
    const hits = await retrieve({
      query: "retrieval",
      chunkIndex: snapshotWithTrash,
      vectorStore: new VectorStore(),
      embeddingProvider: new NoneEmbeddingProvider(),
      retrieve: {
        mode: "keyword",
        topK: 5,
        excludeGlobs: [".trash/**"],
      },
    });
    expect(hits.map((hit) => hit.chunk.path)).toEqual(["/vault/alpha.md"]);
  });
});

describe("vectorStore", () => {
  it("stores and searches vectors", () => {
    const store = new VectorStore();
    store.vaultRoot = "/vault";
    store.model = "test";
    store.upsert([
      {
        id: "a",
        contentHash: "1",
        values: Float32Array.from([1, 0, 0]),
      },
      {
        id: "b",
        contentHash: "2",
        values: Float32Array.from([0.9, 0.1, 0]),
      },
    ]);
    const hits = store.search(Float32Array.from([1, 0, 0]), 2);
    expect(hits[0]?.id).toBe("a");
    expect(store.size()).toBe(2);
  });
});
