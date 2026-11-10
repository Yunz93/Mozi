import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readBinaryFileMock,
  invokeMock,
  renameMock,
  readDirMock,
  joinMock,
  platformPath,
  writeBinaryMock,
  existsMock,
  removeMock,
} = vi.hoisted(() => ({
  readBinaryFileMock: vi.fn(),
  invokeMock: vi.fn(),
  renameMock: vi.fn(),
  readDirMock: vi.fn(),
  joinMock: vi.fn(),
  platformPath: { separator: "/" },
  writeBinaryMock: vi.fn(),
  existsMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (...args: unknown[]) => readBinaryFileMock(...args),
  writeTextFile: vi.fn(),
  writeFile: (...args: unknown[]) => writeBinaryMock(...args),
  exists: (...args: unknown[]) => existsMock(...args),
  mkdir: vi.fn(),
  readDir: readDirMock,
  rename: (...args: unknown[]) => renameMock(...args),
  remove: (...args: unknown[]) => removeMock(...args),
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
import { writeTextFile } from "@tauri-apps/plugin-fs";

describe("TauriFileSystem encoding guard", () => {
  let fs: TauriFileSystem;

  beforeEach(() => {
    readBinaryFileMock.mockReset();
    invokeMock.mockReset();
    vi.mocked(writeTextFile).mockReset();
    renameMock.mockReset();
    readDirMock.mockReset();
    writeBinaryMock.mockReset().mockResolvedValue(undefined);
    existsMock.mockReset().mockResolvedValue(false);
    removeMock.mockReset().mockResolvedValue(undefined);
    platformPath.separator = "/";
    joinMock
      .mockReset()
      .mockImplementation(async (...parts: string[]) => parts.join("/"));
    invokeMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    fs = new TauriFileSystem();
  });

  it("preserves the original file when atomic save fails instead of truncating it", async () => {
    const error = new Error("No space left on device");
    invokeMock.mockRejectedValueOnce(error);
    await expect(fs.writeFile("/notes/a.md", "new text")).rejects.toBe(error);
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("uses native compare-and-write while preserving the expected snapshot", async () => {
    invokeMock.mockResolvedValueOnce(false);
    expect(
      await fs.writeFileIfUnchanged(
        "/notes/a.md",
        "new\ntext",
        "\uFEFFold\r\ntext",
      ),
    ).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("write_text_file_atomic", {
      path: "/notes/a.md",
      content: "new\ntext",
      expectedContent: "\uFEFFold\r\ntext",
    });
    invokeMock.mockResolvedValueOnce(true);
    expect(
      await fs.writeFileIfUnchanged("/notes/a.md", "new text", "old text"),
    ).toBe(true);
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("imports blobs in bounded chunks and publishes the file only after every write completes", async () => {
    const chunk = 256 * 1024;
    const content = new Uint8Array(chunk * 2 + 17).fill(91);
    const blob = new Blob([content]);
    const wholeRead = vi
      .spyOn(blob, "arrayBuffer")
      .mockRejectedValue(new Error("Whole blob read"));
    await fs.writeBlobFile("/vault/large.pdf", blob);
    expect(wholeRead).not.toHaveBeenCalled();
    const writes = writeBinaryMock.mock.calls;
    expect(writes).toHaveLength(4);
    const temporary = writes[0][0];
    expect(temporary).toMatch(/^\/vault\/mozi-import-[\w-]+\.tmp$/);
    expect(writes[0][2]).toMatchObject({ createNew: true });
    const pieces = writes.slice(1).map((call) => call[1] as Uint8Array);
    expect(pieces.map((bytes) => bytes.byteLength)).toEqual([chunk, chunk, 17]);
    expect(new Uint8Array(Buffer.concat(pieces))).toEqual(content);
    expect(writes.every((call) => call[0] === temporary)).toBe(true);
    expect(renameMock).toHaveBeenCalledWith(temporary, "/vault/large.pdf");
    expect(writeBinaryMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      renameMock.mock.invocationCallOrder[0],
    );
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("imports many files using existing directory permissions without registering temporary paths", async () => {
    for (let index = 0; index < 12; index += 1) {
      await fs.writeBlobFile(`/vault/file-${index}.pdf`, new Blob(["data"]));
    }
    const registrations = invokeMock.mock.calls.filter(
      ([command]) => command === "register_allowed_path",
    );
    expect(registrations).toEqual([]);
    expect(new Set(writeBinaryMock.mock.calls.map(([path]) => path)).size).toBe(
      12,
    );
  });

  it("hides only reserved import files from the tree while retaining ordinary attachments", async () => {
    const temporary = "mozi-import-01234567-89ab-4cde-8fab-0123456789ab.tmp";
    readDirMock.mockResolvedValue(
      [
        temporary,
        "mozi-import-not-a-uuid.tmp",
        "document.md",
        "backup.tmp",
      ].map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      })),
    );
    const nodes = await fs.readDirectory("/vault");
    expect(nodes.map((node) => node.name)).toEqual([
      "mozi-import-not-a-uuid.tmp",
      "document.md",
      "backup.tmp",
    ]);
    fs.setDisplayOptions({ showHidden: true });
    expect(
      (await fs.readDirectory("/vault")).some(
        (node) => node.name === temporary,
      ),
    ).toBe(false);
  });

  it("waits for the native chunk write before reading the next source chunk", async () => {
    const blob = new Blob([new Uint8Array(256 * 1024 * 2 + 1)]);
    const slices = vi.spyOn(blob, "slice");
    let release!: () => void;
    writeBinaryMock.mockResolvedValueOnce(undefined).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    const importing = fs.writeBlobFile("/vault/large.bin", blob);
    await vi.waitFor(() => expect(writeBinaryMock).toHaveBeenCalledTimes(2));
    expect(slices).toHaveBeenCalledTimes(1);
    expect(renameMock).not.toHaveBeenCalled();
    release();
    await importing;
    expect(slices).toHaveBeenCalledTimes(3);
  });

  it("cleans only its own incomplete file after a chunk failure", async () => {
    writeBinaryMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(
      fs.writeBlobFile("/vault/large.pdf", new Blob(["data"])),
    ).rejects.toThrow("disk full");
    expect(renameMock).not.toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledWith(writeBinaryMock.mock.calls[0][0]);
    expect(removeMock).not.toHaveBeenCalledWith("/vault/large.pdf");
  });

  it("preserves a destination created while importing and a temporary file it did not create", async () => {
    existsMock.mockResolvedValue(true);
    await expect(
      fs.writeBlobFile("/vault/existing.pdf", new Blob(["data"])),
    ).rejects.toThrow("already exists");
    expect(renameMock).not.toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledTimes(1);
    removeMock.mockClear();
    writeBinaryMock.mockRejectedValueOnce(new Error("temp exists"));
    await expect(
      fs.writeBlobFile("/vault/other.pdf", new Blob()),
    ).rejects.toThrow("temp exists");
    expect(removeMock).not.toHaveBeenCalled();
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
