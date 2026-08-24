// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { AskVaultHistoryItem } from "./askVaultService";
import {
  appendAskVaultHistory,
  askVaultHistoryLocalStorageKey,
  loadAskVaultHistory,
  parseAskVaultHistory,
} from "./askVaultService";
import {
  clearIndexStorage,
  hashVaultId,
  LINK_INDEX_FILE,
  writeIndexJson,
} from "./indexStorage";

function historyItem(
  overrides: Partial<AskVaultHistoryItem> = {},
): AskVaultHistoryItem {
  return {
    id: "1",
    question: "上次发布结论是什么？",
    at: 1_700_000_000_000,
    answer: {
      answerMarkdown: "先跑完整测试再打 tag。",
      citations: [],
      usedChunkIds: [],
      model: "gemini",
      retrievedAt: 1_700_000_000_000,
    },
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("小知助手 history persistence", () => {
  it("round-trips an answered question", async () => {
    const item = historyItem();
    await appendAskVaultHistory("/vault-roundtrip", item);
    await expect(loadAskVaultHistory("/vault-roundtrip")).resolves.toEqual([
      item,
    ]);
  });

  it("keeps a webview localStorage copy so closing the panel cannot drop Q&A", async () => {
    const item = historyItem({ id: "local-1" });
    await appendAskVaultHistory("/notes", item);
    const vaultId = await hashVaultId("/notes");
    const stored = JSON.parse(
      localStorage.getItem(askVaultHistoryLocalStorageKey(vaultId)) ?? "[]",
    ) as AskVaultHistoryItem[];
    expect(stored[0]?.question).toBe(item.question);
  });

  it("does not wipe Q&A when the retrievable index cache is cleared", async () => {
    const item = historyItem({ id: "keep-me" });
    await appendAskVaultHistory("/vault-keep", item);
    await writeIndexJson("/vault-keep", LINK_INDEX_FILE, { version: 1 });
    await clearIndexStorage("/vault-keep");
    await expect(loadAskVaultHistory("/vault-keep")).resolves.toEqual([item]);
  });

  it("ignores corrupt history payloads", () => {
    expect(parseAskVaultHistory(null)).toEqual([]);
    expect(parseAskVaultHistory([{ question: "bad" }])).toEqual([]);
    expect(parseAskVaultHistory([historyItem()])).toEqual([historyItem()]);
  });
});
