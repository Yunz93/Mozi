import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearIndexStorage,
  readIndexJson,
  writeIndexJson,
  mergeAskHistoryItems,
  ASK_HISTORY_FILE,
} from "./indexStorage";

const { files, writeTextFile, rename, invoke } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writeTextFile: vi.fn<(path: string, value: string) => Promise<void>>(),
  rename: vi.fn<(from: string, to: string) => Promise<void>>(),
  invoke: vi.fn(),
}));

vi.mock("../../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app-data",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => files.has(path),
  readTextFile: async (path: string) => files.get(path),
  writeTextFile,
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename,
  remove: async (path: string) => {
    files.delete(path);
  },
}));

beforeEach(() => {
  files.clear();
  invoke.mockReset().mockResolvedValue(undefined);
  writeTextFile.mockReset().mockImplementation(async (path, value) => {
    files.set(path, value);
  });
  rename.mockReset().mockImplementation(async (from, to) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  });
});

describe("index persistence failure safety", () => {
  it("通过后端合并跨窗口历史，成功后不让旧内存快照遮住磁盘", async () => {
    const current = { id: "current", at: 2 };
    const otherWindow = { id: "other", at: 1 };
    invoke.mockImplementation(async (command: string) =>
      command === "merge_ask_vault_history"
        ? [current, otherWindow]
        : undefined,
    );
    const saved = await mergeAskHistoryItems("/history-native", [current]);
    expect(saved).toEqual([current, otherWindow]);
    const mergeCall = invoke.mock.calls.find(
      ([command]) => command === "merge_ask_vault_history",
    );
    expect(mergeCall).toBeDefined();
    expect(mergeCall![1]).toMatchObject({
      vaultRoot: "/history-native",
      items: [current],
    });
    const target = mergeCall![1].path;
    files.set(
      target,
      JSON.stringify({
        version: 2,
        vaultRoot: "/history-native",
        items: [otherWindow],
      }),
    );
    await expect(
      readIndexJson("/history-native", ASK_HISTORY_FILE, "ask-history"),
    ).resolves.toMatchObject({ items: [otherWindow] });
  });

  it("原生历史合并失败时保留磁盘与待重试记录，不退回盲写", async () => {
    const root = "/history-native-failure";
    const old = { id: "old", at: 1 };
    const newest = { id: "newest", at: 2 };
    await writeIndexJson(
      root,
      ASK_HISTORY_FILE,
      { version: 2, vaultRoot: root, items: [old] },
      "ask-history",
    );
    const [target, raw] = [...files.entries()][0];
    invoke.mockRejectedValueOnce(new Error("disk failure"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(mergeAskHistoryItems(root, [newest, old])).resolves.toEqual([
        newest,
        old,
      ]);
      expect(files.get(target)).toBe(raw);
      await expect(
        readIndexJson(root, ASK_HISTORY_FILE, "ask-history"),
      ).resolves.toMatchObject({ items: [newest, old] });
      invoke.mockResolvedValueOnce([newest, old]);
      await expect(mergeAskHistoryItems(root, [old])).resolves.toEqual([
        newest,
        old,
      ]);
      expect(invoke).toHaveBeenLastCalledWith(
        "merge_ask_vault_history",
        expect.objectContaining({ items: [newest, old] }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("Windows路径别名共享写失败后的最新内存值，也可按别名清理", async () => {
    rename.mockRejectedValueOnce(new Error("disk unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeIndexJson("C:/Notes/Work", "alias.json", { text: "newest" });
      await expect(
        readIndexJson("c:\\notes\\work", "alias.json"),
      ).resolves.toEqual({ text: "newest" });
      await clearIndexStorage("c:/notes/work");
      await expect(
        readIndexJson("C:/Notes/Work", "alias.json"),
      ).resolves.toBeNull();
    } finally {
      warning.mockRestore();
    }
  });
  it("保留已落盘原件，替换失败后从内存返回最新副本而不截断旧文件", async () => {
    await writeIndexJson(
      "/persist-failure",
      "history.json",
      { text: "old" },
      "ask-history",
    );
    const target = [...files.keys()][0];
    rename.mockRejectedValueOnce(new Error("disk failure"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeIndexJson(
        "/persist-failure",
        "history.json",
        { text: "new" },
        "ask-history",
      );
      expect(JSON.parse(files.get(target)!)).toEqual({ text: "old" });
      expect(writeTextFile.mock.calls.some(([path]) => path === target)).toBe(
        false,
      );
      await expect(
        readIndexJson("/persist-failure", "history.json", "ask-history"),
      ).resolves.toEqual({ text: "new" });
      expect(files.size).toBe(1);
    } finally {
      warning.mockRestore();
    }
  });

  it("成功替换后读取磁盘，不保留另一份完整内存缓存", async () => {
    await writeIndexJson("/persist-success", "index.json", { text: "first" });
    const target = [...files.keys()][0];
    files.set(target, JSON.stringify({ text: "disk authoritative" }));
    await expect(
      readIndexJson("/persist-success", "index.json"),
    ).resolves.toEqual({ text: "disk authoritative" });
  });
});
