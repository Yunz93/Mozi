import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearIndexStorage,
  readIndexJson,
  writeIndexJson,
} from "./indexStorage";

const { files, writeTextFile, rename } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writeTextFile: vi.fn<(path: string, value: string) => Promise<void>>(),
  rename: vi.fn<(from: string, to: string) => Promise<void>>(),
}));

vi.mock("../../types/filesystem", () => ({ isTauriEnvironment: () => true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
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
  writeTextFile.mockReset().mockImplementation(async (path, value) => {
    files.set(path, value);
  });
  rename.mockReset().mockImplementation(async (from, to) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  });
});

describe("index persistence failure safety", () => {
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
