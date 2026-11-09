import { describe, expect, it, vi } from "vitest";
import { importDroppedFiles } from "./importDroppedFiles";

function createMemoryFs(existing: string[] = []) {
  const files = new Map<string, Uint8Array>();
  for (const path of existing) {
    files.set(path, new Uint8Array());
  }
  const directories = new Set<string>();

  return {
    files,
    directories,
    fs: {
      fileExists: async (path: string) => files.has(path),
      createDirectory: async (path: string) => {
        directories.add(path);
      },
      writeBinaryFile: async (path: string, content: Uint8Array) => {
        files.set(path, content);
      },
      writeFile: async (path: string, content: string) => {
        files.set(path, new TextEncoder().encode(content));
      },
    },
  };
}

describe("importDroppedFiles", () => {
  it.each([
    ["large.pdf", 1024 * 1024 * 1024],
    ["presentation.ppt", 900_000_000],
    ["presentation.pptx", 900_000_000],
  ])(
    "passes %s directly to the bounded blob writer without materializing its full buffer",
    async (name, size) => {
      const { fs } = createMemoryFs();
      const file = new File(["fixture"], name);
      Object.defineProperty(file, "size", { value: size });
      const wholeRead = vi
        .spyOn(file, "arrayBuffer")
        .mockRejectedValue(new Error("Whole-file read must not happen"));
      const writeBlobFile = vi.fn(async () => {});
      const result = await importDroppedFiles({
        files: [file],
        targetFolderPath: "/vault",
        fs: { ...fs, writeBlobFile },
      });
      expect(result.failed).toEqual([]);
      expect(writeBlobFile).toHaveBeenCalledWith(`/vault/${name}`, file);
      expect(wholeRead).not.toHaveBeenCalled();
      expect(result.imported[0]).toMatchObject({
        path: `/vault/${name}`,
        size: file.size,
      });
    },
  );
  it("writes dropped files into the target folder", async () => {
    const { fs, files } = createMemoryFs();
    const note = new File(["hello"], "hello.md", { type: "text/markdown" });

    const result = await importDroppedFiles({
      files: [note],
      targetFolderPath: "/vault",
      fs,
    });

    expect(result.imported).toEqual([
      { path: "/vault/hello.md", name: "hello.md", size: note.size },
    ]);
    expect(new TextDecoder().decode(files.get("/vault/hello.md"))).toBe(
      "hello",
    );
  });

  it("renames when the destination already exists", async () => {
    const { fs } = createMemoryFs(["/vault/hello.md"]);
    const note = new File(["copy"], "hello.md", { type: "text/markdown" });

    const result = await importDroppedFiles({
      files: [note],
      targetFolderPath: "/vault",
      fs,
    });

    expect(result.imported[0]?.name).toBe("hello (1).md");
  });

  it("does not attempt an unbounded read when a legacy file system cannot stream a large file", async () => {
    const { fs } = createMemoryFs();
    const file = new File(["fixture"], "large.bin");
    Object.defineProperty(file, "size", { value: 1024 * 1024 * 1024 });
    const wholeRead = vi.spyOn(file, "arrayBuffer");
    const result = await importDroppedFiles({
      files: [file],
      targetFolderPath: "/vault",
      fs,
    });
    expect(result.failed).toHaveLength(1);
    expect(wholeRead).not.toHaveBeenCalled();
    expect(result.imported).toEqual([]);
  });

  it("recreates folder structure from webkitRelativePath", async () => {
    const { fs, directories, files } = createMemoryFs();
    const nested = new File(["img"], "shot.png", { type: "image/png" });
    Object.defineProperty(nested, "webkitRelativePath", {
      value: "Assets/shot.png",
    });

    const result = await importDroppedFiles({
      files: [nested],
      targetFolderPath: "/vault",
      fs,
    });

    expect(directories.has("/vault/Assets")).toBe(true);
    expect(result.imported[0]?.path).toBe("/vault/Assets/shot.png");
    expect(files.has("/vault/Assets/shot.png")).toBe(true);
  });

  it("skips Finder metadata files", async () => {
    const { fs } = createMemoryFs();
    const junk = new File([""], ".DS_Store");

    const result = await importDroppedFiles({
      files: [junk],
      targetFolderPath: "/vault",
      fs,
    });

    expect(result.imported).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it("renames colliding files within the same drop", async () => {
    const { fs } = createMemoryFs();
    const first = new File(["one"], "hello.md", { type: "text/markdown" });
    const second = new File(["two"], "hello.md", { type: "text/markdown" });

    const result = await importDroppedFiles({
      files: [first, second],
      targetFolderPath: "/vault",
      fs,
    });

    expect(result.imported.map((file) => file.name)).toEqual([
      "hello.md",
      "hello (1).md",
    ]);
  });
});
