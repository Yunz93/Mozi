import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readBinaryFileMock,
  invokeMock,
  renameMock,
  readDirMock,
  joinMock,
  platformPath,
} = vi.hoisted(() => ({
  readBinaryFileMock: vi.fn(),
  invokeMock: vi.fn(),
  renameMock: vi.fn(),
  readDirMock: vi.fn(),
  joinMock: vi.fn(),
  platformPath: { separator: "/" },
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
  readDir: readDirMock,
  rename: (...args: unknown[]) => renameMock(...args),
  remove: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  sep: () => platformPath.separator,
  basename: async (path: string) => path.split("/").pop() ?? path,
  dirname: async (path: string) => path.split("/").slice(0, -1).join("/"),
  join: joinMock,
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
    readDirMock.mockReset();
    platformPath.separator = "/";
    joinMock
      .mockReset()
      .mockImplementation(async (...parts: string[]) => parts.join("/"));
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

  it("keeps background reads from replacing an open document's BOM and line endings", async () => {
    readBinaryFileMock.mockResolvedValue(
      new TextEncoder().encode("\uFEFFfirst\r\nsecond"),
    );
    await fs.readFile("/notes/a.md");
    readBinaryFileMock.mockResolvedValue(
      new TextEncoder().encode("external\nchange"),
    );
    expect(await fs.readFileUncached("/notes/a.md")).toBe("external\nchange");
    await fs.writeFile("/notes/a.md", "saved\nchange");
    expect(invokeMock).toHaveBeenCalledWith("write_text_file_atomic", {
      path: "/notes/a.md",
      content: "\uFEFFsaved\r\nchange",
    });
  });

  it("decodes background reads without creating editor format state or clearing an encoding guard", async () => {
    readBinaryFileMock.mockResolvedValue(
      new TextEncoder().encode("\uFEFFindex\r\ntext"),
    );
    expect(await fs.readFileUncached("/notes/a.md")).toBe("index\r\ntext");
    await fs.writeFile("/notes/a.md", "plain\ntext");
    expect(invokeMock).toHaveBeenCalledWith("write_text_file_atomic", {
      path: "/notes/a.md",
      content: "plain\ntext",
    });
    readBinaryFileMock.mockResolvedValue(new Uint8Array([0xc4, 0xe3]));
    await fs.readFile("/notes/gbk.md");
    readBinaryFileMock.mockResolvedValue(new TextEncoder().encode("now utf8"));
    await fs.readFileUncached("/notes/gbk.md");
    await expect(fs.writeFile("/notes/gbk.md", "save")).rejects.toMatchObject({
      code: ENCODING_UNSUPPORTED_CODE,
    });
  });

  it.each([
    [
      "/vault",
      "/",
      "/vault",
      "name\\with-backslash.md",
      "/vault/name\\with-backslash.md",
    ],
    ["/", "/", "/", "名字.md", "/名字.md"],
    ["C:/Vault/", "\\", "C:\\Vault", "名字.md", "C:\\Vault\\名字.md"],
    [
      "\\\\server\\share\\",
      "\\",
      "\\\\server\\share\\",
      "a.md",
      "\\\\server\\share\\a.md",
    ],
  ])(
    "joins directory entries locally after one native normalization: %s",
    async (root, separator, normalized, name, expected) => {
      platformPath.separator = separator;
      joinMock.mockResolvedValue(normalized);
      readDirMock.mockResolvedValue(
        Array.from({ length: 1000 }, () => ({
          name,
          isDirectory: false,
          isSymlink: false,
        })),
      );
      const nodes = await fs.readDirectory(root);
      expect(nodes).toHaveLength(1000);
      expect(
        nodes.every((node) => node.path === expected && node.id === expected),
      ).toBe(true);
      expect(joinMock).toHaveBeenCalledExactlyOnceWith(root);
    },
  );
});
