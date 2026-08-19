import { describe, expect, it } from "vitest";
import { buildAskVaultPrompt } from "../ai/prompts";
import {
  citationEditorRange,
  estimateLineOffset,
  hitsToPreviewSnippets,
  resolveAskVaultSubmitKind,
} from "./askVaultService";
import { remapPathsInChunkIndex } from "./chunkIndexService";
import { chunkMarkdownFile } from "./chunkService";
import { keywordSearchChunks, tokenizeSearchQuery } from "./retrieveService";
import { VectorStore } from "./vectorStore";
import type { ChunkIndexSnapshot } from "../../types/vaultIndex";

describe("askVault prompts", () => {
  it("includes numbered excerpts and question", () => {
    const prompt = buildAskVaultPrompt("What is RAG?", [
      {
        index: 1,
        path: "notes/rag.md",
        titlePath: ["RAG"],
        startLine: 1,
        endLine: 4,
        text: "RAG retrieves documents before generation.",
      },
    ]);
    expect(prompt).toContain("What is RAG?");
    expect(prompt).toContain("[1] notes/rag.md");
    expect(prompt).toContain("citationIndexes");
  });
});

describe("estimateLineOffset", () => {
  it("maps 1-based lines to offsets for LF", () => {
    const content = "a\nbc\ndef";
    expect(estimateLineOffset(content, 1)).toBe(0);
    expect(estimateLineOffset(content, 2)).toBe(2);
    expect(estimateLineOffset(content, 3)).toBe(5);
  });

  it("maps 1-based lines to offsets for CRLF", () => {
    const content = "a\r\nbc\r\ndef";
    expect(estimateLineOffset(content, 1)).toBe(0);
    expect(estimateLineOffset(content, 2)).toBe(3);
    expect(estimateLineOffset(content, 3)).toBe(7);
  });
});

describe("hitsToPreviewSnippets", () => {
  it("numbers snippets for pre-send preview", () => {
    const chunk = chunkMarkdownFile({
      path: "/vault/a.md",
      vaultRoot: "/vault",
      content: "# A\n\nHello retrieval world for vault ask.\n",
    })[0]!;
    const snippets = hitsToPreviewSnippets([
      { chunk, score: 1, source: "keyword" },
    ]);
    expect(snippets[0]).toContain("[1] a.md");
    expect(snippets[0]).toContain("Hello retrieval");
  });
});

describe("citationEditorRange", () => {
  it("lands on the chunk text so citation clicks can scroll to the source", () => {
    const content = `---
title: 发布
---

# 发布

上次发布流程的结论是先跑完整测试再打 tag，并且同步更新 changelog 文档。
`;
    const chunk = chunkMarkdownFile({
      path: "/vault/03-发布与问库.md",
      vaultRoot: "/vault",
      content,
    })[0]!;
    expect(chunk).toBeTruthy();
    const range = citationEditorRange(content, chunk.startLine, chunk.endLine);
    expect(content.slice(range.start, range.end)).toContain(
      "上次发布流程的结论",
    );
  });
});

describe("resolveAskVaultSubmitKind", () => {
  it("answers a new question in one generate click", () => {
    expect(
      resolveAskVaultSubmitKind({
        question: "上次关于发布流程的结论是什么",
        lastPreviewedQuestion: null,
        pendingHitCount: 0,
      }),
    ).toBe("retrieveThenGenerate");
  });

  it("reuses hits after retrieve-only for the same question", () => {
    expect(
      resolveAskVaultSubmitKind({
        question: "上次关于发布流程的结论是什么",
        lastPreviewedQuestion: "上次关于发布流程的结论是什么",
        pendingHitCount: 2,
      }),
    ).toBe("reuseHits");
  });

  it("retrieves again when the question or hits no longer match", () => {
    expect(
      resolveAskVaultSubmitKind({
        question: "另一个问题",
        lastPreviewedQuestion: "上次关于发布流程的结论是什么",
        pendingHitCount: 2,
      }),
    ).toBe("retrieveThenGenerate");
    expect(
      resolveAskVaultSubmitKind({
        question: "上次关于发布流程的结论是什么",
        lastPreviewedQuestion: "上次关于发布流程的结论是什么",
        pendingHitCount: 0,
      }),
    ).toBe("retrieveThenGenerate");
  });
});

describe("keyword tokenization", () => {
  it("matches multi-term and CJK queries without requiring the full sentence", () => {
    const chunk = chunkMarkdownFile({
      path: "/vault/release.md",
      vaultRoot: "/vault",
      content:
        "# 发布\n\n上次发布流程的结论是先跑完整测试再打 tag，并且同步更新 changelog 文档。\n",
    })[0]!;
    expect(chunk).toBeTruthy();
    expect(tokenizeSearchQuery("发布流程结论").length).toBeGreaterThan(0);
    const hits = keywordSearchChunks(
      [chunk],
      "上次关于发布流程的结论是什么",
      5,
    );
    expect(hits.length).toBe(1);
  });
});

describe("remapPathsInChunkIndex", () => {
  it("remaps paths and chunk ids for vector continuity", () => {
    const chunk = chunkMarkdownFile({
      path: "/vault/old.md",
      vaultRoot: "/vault",
      content: "# Old\n\nContent about remapping chunk ids after rename.\n",
    })[0]!;
    const snapshot: ChunkIndexSnapshot = {
      version: 1,
      vaultRoot: "/vault",
      builtAt: Date.now(),
      byPath: { "/vault/old.md": [chunk] },
    };
    const { snapshot: next, idMap } = remapPathsInChunkIndex(snapshot, {
      "/vault/old.md": "/vault/new.md",
    });
    expect(next.byPath["/vault/new.md"]?.[0]?.path).toBe("/vault/new.md");
    expect(next.byPath["/vault/new.md"]?.[0]?.relPath).toBe("new.md");
    expect(idMap[chunk.id]).toBe("new.md#0");

    const store = new VectorStore();
    store.upsert([
      {
        id: chunk.id,
        contentHash: chunk.contentHash,
        values: Float32Array.from([1, 0]),
      },
    ]);
    store.remapIds(idMap);
    expect(store.get("new.md#0")?.contentHash).toBe(chunk.contentHash);
    expect(store.get(chunk.id)).toBeUndefined();
  });
});
