import { beforeEach, describe, expect, it, vi } from "vitest";

const { readBinaryFileMock, invokeMock, renameMock } = vi.hoisted(() => ({
  readBinaryFileMock: vi.fn(),
  invokeMock: vi.fn(),
  renameMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (...args: unknown[]) => readBinaryFileMock(...args),
  writeTextFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  rename: (...args: unknown[]) => renameMock(...args),
  remove: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  basename: async (path: string) => path.split("/").pop() ?? path,
  dirname: async (path: string) => path.split("/").slice(0, -1).join("/"),
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../store/appStore", () => ({
  useAppStore: {
    getState: () => ({ settings: { trashFolder: ".trash" } }),
  },
}));

import { TauriFileSystem } from "./tauriFileSystem";
import { ENCODING_UNSUPPORTED_CODE } from "./filesystem/textFileEncoding";

describe("TauriFileSystem encoding guard", () => {
  let fs: TauriFileSystem;

  beforeEach(() => {
    readBinaryFileMock.mockReset();
    invokeMock.mockReset();
    renameMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    fs = new TauriFileSystem();
  });

  it("reads UTF-8 files and allows saving, preserving BOM", async () => {
    readBinaryFileMock.mockResolvedValue(
      new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]),
    );

    const text = await fs.readFile("/notes/utf8.md");
    expect(text).toBe("hi");
    expect(fs.isNonUtf8Path("/notes/utf8.md")).toBe(false);

    await fs.writeFile("/notes/utf8.md", "hi");
    expect(invokeMock).toHaveBeenCalledWith("write_text_file_atomic", {
      path: "/notes/utf8.md",
      content: "\uFEFFhi",
    });
  });

  it("shows non-UTF-8 bytes and blocks writeFile", async () => {
    readBinaryFileMock.mockResolvedValue(
      new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]),
    );

    const text = await fs.readFile("/notes/gbk.md");
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(fs.isNonUtf8Path("/notes/gbk.md")).toBe(true);

    await expect(fs.writeFile("/notes/gbk.md", text)).rejects.toMatchObject({
      code: ENCODING_UNSUPPORTED_CODE,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("moves the non-UTF-8 mark when a file is renamed", async () => {
    readBinaryFileMock.mockResolvedValue(new Uint8Array([0xc4, 0xe3]));
    await fs.readFile("/notes/old.md");
    expect(fs.isNonUtf8Path("/notes/old.md")).toBe(true);

    const nextPath = await fs.renameFile("/notes/old.md", "new.md");
    expect(nextPath).toBe("/notes/new.md");
    expect(fs.isNonUtf8Path("/notes/old.md")).toBe(false);
    expect(fs.isNonUtf8Path("/notes/new.md")).toBe(true);
  });
});
