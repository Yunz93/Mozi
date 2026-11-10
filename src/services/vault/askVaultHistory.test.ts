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
  hashLegacyVaultId,
  ASK_HISTORY_FILE,
  LEGACY_ASK_HISTORY_FILE,
  LINK_INDEX_FILE,
  readIndexJson,
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
  it("旧磁盘历史满额时仍先合并更新的本地备份，再按时间截取50条", async () => {
    const root = "/legacy-capacity";
    const owned = (id: string, at: number) => {
      const item = historyItem({ id, at });
      item.answer.citations = [
        {
          index: 1,
          path: `${root}/a.md`,
          relPath: "a.md",
          titlePath: [],
          snippet: "",
          startLine: 1,
          endLine: 1,
          headingAnchor: null,
        },
      ];
      return item;
    };
    await writeIndexJson(
      root,
      LEGACY_ASK_HISTORY_FILE,
      Array.from({ length: 50 }, (_, index) => owned(`old-${index}`, index)),
      "ask-history",
    );
    const newest = owned("newest-local", 100);
    localStorage.setItem(
      `markdown-press.ask-history.${await hashLegacyVaultId(root)}`,
      JSON.stringify([newest]),
    );
    const history = await loadAskVaultHistory(root);
    expect(history).toHaveLength(50);
    expect(history[0]).toEqual(newest);
  });

  it("并发追加保留所有记录，并按时间排序和按ID去重", async () => {
    const root = "/history-concurrent";
    const first = historyItem({ id: "first", at: 1 });
    const second = historyItem({ id: "second", at: 2 });
    await Promise.all([
      appendAskVaultHistory(root, first),
      appendAskVaultHistory(root, second),
    ]);
    await expect(loadAskVaultHistory(root)).resolves.toEqual([second, first]);
    const updated = { ...first, question: "更新的问题", at: 3 };
    await appendAskVaultHistory(root, updated);
    await expect(loadAskVaultHistory(root)).resolves.toEqual([updated, second]);
  });

  it("隔离大小写不同的POSIX知识库历史", async () => {
    const item = historyItem({ id: "case-sensitive" });
    expect(await hashVaultId("/vault/Work")).not.toBe(
      await hashVaultId("/vault/work"),
    );
    await appendAskVaultHistory("/vault/Work", item);
    await expect(loadAskVaultHistory("/vault/work")).resolves.toEqual([]);
  });

  it("Windows盘符路径大小写与分隔符仍指向同一知识库身份", async () => {
    expect(await hashVaultId("C:\\Notes\\Work")).toBe(
      await hashVaultId("c:/notes/work"),
    );
  });
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
    ) as { version: number; vaultRoot: string; items: AskVaultHistoryItem[] };
    expect(stored.version).toBe(2);
    expect(stored.vaultRoot).toBe("/notes");
    expect(stored.items[0]?.question).toBe(item.question);
  });

  it("只迁移引用能确定归属的旧历史，保留原始数组", async () => {
    const owned = historyItem({ id: "old-owned" });
    owned.answer = {
      ...owned.answer,
      citations: [
        {
          index: 1,
          path: "/legacy/Work/a.md",
          relPath: "a.md",
          titlePath: [],
          snippet: "old",
          startLine: 1,
          endLine: 2,
          headingAnchor: null,
        },
      ],
    };
    const unknown = historyItem({ id: "unknown-owner" });
    const wrong = {
      ...owned,
      id: "other-vault",
      answer: {
        ...owned.answer,
        citations: [
          { ...owned.answer.citations[0], path: "/legacy/work/a.md" },
        ],
      },
    };
    const raw = JSON.stringify([owned, unknown, wrong]);
    const legacyKey = `markdown-press.ask-history.${await hashLegacyVaultId("/legacy/Work")}`;
    localStorage.setItem(legacyKey, raw);
    await expect(loadAskVaultHistory("/legacy/Work")).resolves.toEqual([owned]);
    expect(localStorage.getItem(legacyKey)).toBe(raw);
    expect(
      await readIndexJson("/legacy/Work", ASK_HISTORY_FILE, "ask-history"),
    ).toEqual({ version: 2, vaultRoot: "/legacy/Work", items: [owned] });
  });

  it("拒绝归属不符的新历史，并且空历史不会从旧文件复活", async () => {
    await writeIndexJson(
      "/history-owned",
      ASK_HISTORY_FILE,
      { version: 2, vaultRoot: "/another", items: [historyItem()] },
      "ask-history",
    );
    await expect(loadAskVaultHistory("/history-owned")).resolves.toEqual([]);
    const item = historyItem({ id: "old-disk" });
    await writeIndexJson(
      "/history-empty",
      LEGACY_ASK_HISTORY_FILE,
      [item],
      "ask-history",
    );
    await writeIndexJson(
      "/history-empty",
      ASK_HISTORY_FILE,
      { version: 2, vaultRoot: "/history-empty", items: [] },
      "ask-history",
    );
    await expect(loadAskVaultHistory("/history-empty")).resolves.toEqual([]);
    await expect(
      readIndexJson("/history-empty", LEGACY_ASK_HISTORY_FILE, "ask-history"),
    ).resolves.toEqual([item]);
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
