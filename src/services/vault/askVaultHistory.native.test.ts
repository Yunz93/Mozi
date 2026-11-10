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
