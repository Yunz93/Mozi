// @vitest-environment happy-dom

import { beforeEach, expect, it, vi } from "vitest";

const { files, invoke, failMerge } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  invoke: vi.fn(),
  failMerge: { current: true },
}));

vi.mock("../../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app-data",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => files.has(path),
  readTextFile: async (path: string) => files.get(path),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  files.clear();
  failMerge.current = true;
  invoke.mockReset().mockImplementation(async (command: string, args) => {
    if (command !== "merge_ask_vault_history") return;
    if (failMerge.current) throw new Error("disk unavailable");
    files.set(
      args.path,
      JSON.stringify({
        version: 2,
        vaultRoot: args.vaultRoot,
        items: args.items,
      }),
    );
    return args.items;
  });
});

it("写失败后重启仍从同库本地副本找回未落盘历史，再合并到旧磁盘", async () => {
  const root = "/history-restart";
  const item = (id: string, at: number) => ({
    id,
    at,
    question: id,
    answer: {
      answerMarkdown: id,
      citations: [],
      usedChunkIds: [],
      model: "fixture",
      retrievedAt: at,
    },
  });
  const old = item("old", 1);
  const newest = item("newest", 2);
  const storage = await import("./indexStorage");
  const path = `/app-data/MarkdownPress/ask-history/${await storage.hashVaultId(root)}/${storage.ASK_HISTORY_FILE}`;
  files.set(
    path,
    JSON.stringify({ version: 2, vaultRoot: root, items: [old] }),
  );
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const service = await import("./askVaultService");
    await service.appendAskVaultHistory(root, newest);
    expect(JSON.parse(files.get(path)!).items).toEqual([old]);
    // 重载模块清空窗口内存，保留磁盘与 WebView 的持久化本地副本。
    vi.resetModules();
    failMerge.current = false;
    const restarted = await import("./askVaultService");
    await expect(restarted.loadAskVaultHistory(root)).resolves.toEqual([
      newest,
      old,
    ]);
    expect(JSON.parse(files.get(path)!).items).toEqual([newest, old]);
  } finally {
    warning.mockRestore();
  }
});

it.each([
  { count: 1, reuseId: false },
  { count: 55, reuseId: false },
  { count: 1, reuseId: true },
])(
  "旧窗口延迟响应保留另一窗口写失败的恢复记录（$count条，同ID=$reuseId）",
  async ({ count, reuseId }) => {
    const root = "/history-cross-window-recovery";
    const item = (id: string, at: number) => ({
      id,
      at,
      question: id,
      answer: {
        answerMarkdown: id,
        citations: [],
        usedChunkIds: [],
        model: "fixture",
        retrievedAt: at,
      },
    });
    const old = item("old-window", 1);
    const pendingItems = Array.from({ length: count }, (_, index) =>
      item(reuseId ? old.id : `failed-window-${index}`, index + 2),
    );
    let response!: () => void;
    let started!: () => void;
    const firstWritten = new Promise<void>((resolve) => {
      started = resolve;
    });
    let delayFirst = true;
    let rejectNewest = true;
    invoke.mockImplementation(async (command: string, args) => {
      if (command !== "merge_ask_vault_history") return;
      if (
        rejectNewest &&
        args.items.some((entry: typeof old) => entry.at > old.at)
      ) {
        throw new Error("disk unavailable");
      }
      const previous = JSON.parse(files.get(args.path) ?? '{"items":[]}')
        .items as (typeof old)[];
      const unique = new Map<string, typeof old>(
        previous.map((entry) => [entry.id, entry]),
      );
      for (const entry of args.items as (typeof old)[])
        unique.set(entry.id, entry);
      const saved = [...unique.values()]
        .sort((left, right) => right.at - left.at)
        .slice(0, 50);
      files.set(
        args.path,
        JSON.stringify({ version: 2, vaultRoot: root, items: saved }),
      );
      if (delayFirst) {
        delayFirst = false;
        started();
        return new Promise((resolve) => {
          response = () => resolve(saved);
        });
      }
      return saved;
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const firstRenderer = await import("./askVaultService");
      const pendingReply = firstRenderer.appendAskVaultHistory(root, old);
      await firstWritten;
      // 模块隔离代表两个 WebView；磁盘和 localStorage 仍是共享介质。
      vi.resetModules();
      const otherRenderer = await import("./askVaultService");
      for (const newest of pendingItems)
        await otherRenderer.appendAskVaultHistory(root, newest);
      response();
      await pendingReply;
      vi.resetModules();
      rejectNewest = false;
      const restarted = await import("./askVaultService");
      const expected = [...pendingItems, ...(reuseId ? [] : [old])]
        .sort((left, right) => right.at - left.at)
        .slice(0, 50);
      await expect(restarted.loadAskVaultHistory(root)).resolves.toEqual(
        expected,
      );
      expect(
        [...files.values()].some(
          (raw) => JSON.parse(raw).items[0]?.id === expected[0].id,
        ),
      ).toBe(true);
      const recoveryRecords = Object.values(localStorage)
        .map((raw) => JSON.parse(raw))
        .filter((value) => value.version === 3 && value.item);
      expect(recoveryRecords).toHaveLength(expected.length);
    } finally {
      warning.mockRestore();
    }
  },
);
