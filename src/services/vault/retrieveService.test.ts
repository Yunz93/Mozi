import { describe, expect, it } from "vitest";
import { NoneEmbeddingProvider } from "./embeddingProvider";
import {
  diversifyHits,
  expandNeighborChunks,
  expandSearchQueries,
  isFollowUpQuestion,
  keywordSearchChunks,
  retrieve,
  stripSearchFillers,
} from "./retrieveService";
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

describe("ask-vault retrieve helpers", () => {
  it("strips polite wrappers and trailing 是什么", () => {
    expect(stripSearchFillers("请问上次关于发布流程的结论是什么？")).toBe(
      "上次关于发布流程的结论",
    );
  });

  it("treats short questions as follow-ups and blends the previous turn", () => {
    expect(isFollowUpQuestion("那封面图呢")).toBe(true);
    expect(
      expandSearchQueries("那封面图呢", "上次关于发布流程的结论是什么"),
    ).toEqual(["那封面图呢", "那封面图", "上次关于发布流程的结论 那封面图"]);
  });

  it("does not blend a full new question with the previous turn", () => {
    const queries = expandSearchQueries(
      "Markdown 粗体 斜体 删除线",
      "上次关于发布流程的结论是什么",
    );
    expect(queries[0]).toBe("Markdown 粗体 斜体 删除线");
    expect(queries.some((query) => query.includes("发布流程"))).toBe(false);
  });

  it("caps chunks per note then fills from the overflow", () => {
    const makeHit = (path: string, id: string, score: number) => ({
      chunk: {
        id,
        path,
        relPath: path.replace("/vault/", ""),
        titlePath: [],
        headingAnchor: null,
        startLine: 1,
        endLine: 2,
        text: id,
        contentHash: id,
      },
      score,
      source: "keyword" as const,
    });
    const hits = diversifyHits(
      [
        makeHit("/vault/a.md", "a-1", 1),
        makeHit("/vault/a.md", "a-2", 0.9),
        makeHit("/vault/a.md", "a-3", 0.8),
        makeHit("/vault/b.md", "b-1", 0.7),
      ],
      3,
      2,
    );
    expect(hits.map((hit) => hit.chunk.id)).toEqual(["a-1", "a-2", "b-1"]);
  });

  it("pulls neighboring chunks from the same note", () => {
    const chunks = chunkMarkdownFile({
      path: "/vault/long.md",
      vaultRoot: "/vault",
      content: `# One\n\n${"alpha retrieval ".repeat(40)}\n\n# Two\n\n${"beta neighbor ".repeat(40)}\n`,
    });
    expect(chunks.length).toBeGreaterThan(1);
    const snapshot: ChunkIndexSnapshot = {
      version: 1,
      vaultRoot: "/vault",
      builtAt: Date.now(),
      byPath: { "/vault/long.md": chunks },
    };
    const expanded = expandNeighborChunks(
      [{ chunk: chunks[0]!, score: 1, source: "keyword" }],
      snapshot,
      4,
    );
    expect(expanded.map((hit) => hit.chunk.id)).toContain(chunks[1]!.id);
  });
});
