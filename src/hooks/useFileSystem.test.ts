import { describe, expect, it, vi } from "vitest";
import { FileSystemError } from "../utils/errorHandler";
import {
  assertTargetPathAvailable,
  isSamePathAllowingCaseChange,
} from "./useFileSystem";

describe("assertTargetPathAvailable", () => {
  it("throws FILE_EXISTS and does not treat the path as writable", async () => {
    const fileExists = vi.fn(async () => true);
    const writeFile = vi.fn();
    const rename = vi.fn();

    await expect(
      assertTargetPathAvailable({ fileExists }, "/vault/note.md"),
    ).rejects.toMatchObject({
      code: "FILE_EXISTS",
    });

    expect(fileExists).toHaveBeenCalledWith("/vault/note.md");
    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("allows the exact source path without a filesystem lookup", async () => {
    const fileExists = vi.fn(async () => true);

    await expect(
      assertTargetPathAvailable(
        { fileExists },
        "/vault/note.md",
        "/vault/note.md",
      ),
    ).resolves.toBeUndefined();

    expect(fileExists).not.toHaveBeenCalled();
  });

  it("rejects a distinct case-only target on a case-sensitive volume", async () => {
    const fileExists = vi.fn(async () => true);
    const readDirectory = vi.fn(async () => [
      {
        id: "/vault/note.md",
        path: "/vault/note.md",
        name: "note.md",
        type: "file" as const,
      },
      {
        id: "/vault/Note.md",
        path: "/vault/Note.md",
        name: "Note.md",
        type: "file" as const,
      },
    ]);

    await expect(
      assertTargetPathAvailable(
        { fileExists, readDirectory },
        "/vault/Note.md",
        "/vault/note.md",
      ),
    ).rejects.toMatchObject({ code: "FILE_EXISTS" });
  });

  it("allows case-only renames when both spellings refer to one directory entry", async () => {
    const fileExists = vi.fn(async () => true);
    const readDirectory = vi.fn(async () => [
      {
        id: "/vault/note.md",
        path: "/vault/note.md",
        name: "note.md",
        type: "file" as const,
      },
    ]);

    await expect(
      assertTargetPathAvailable(
        { fileExists, readDirectory },
        "/vault/Note.md",
        "/vault/note.md",
      ),
    ).resolves.toBeUndefined();
    expect(readDirectory).toHaveBeenCalledWith("/vault");
  });

  it("rejects moves between distinct directories whose names differ only by case", async () => {
    const fileExists = vi.fn(async () => true);
    const readDirectory = vi.fn(async () => [
      {
        id: "/vault/notes/a.md",
        path: "/vault/notes/a.md",
        name: "a.md",
        type: "file" as const,
      },
    ]);
    await expect(
      assertTargetPathAvailable(
        { fileExists, readDirectory },
        "/vault/NOTES/a.md",
        "/vault/notes/a.md",
      ),
    ).rejects.toMatchObject({ code: "FILE_EXISTS" });
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it("does not assume an existing case-only target is safe without directory evidence", async () => {
    await expect(
      assertTargetPathAvailable(
        { fileExists: async () => true },
        "/vault/Note.md",
        "/vault/note.md",
      ),
    ).rejects.toMatchObject({ code: "FILE_EXISTS" });
  });

  it("does nothing when the target does not exist", async () => {
    const fileExists = vi.fn(async () => false);

    await expect(
      assertTargetPathAvailable({ fileExists }, "/vault/new.md"),
    ).resolves.toBeUndefined();
  });

  it("throws a FileSystemError instance", async () => {
    await expect(
      assertTargetPathAvailable(
        { fileExists: async () => true },
        "/vault/dup.md",
      ),
    ).rejects.toBeInstanceOf(FileSystemError);
  });
});

describe("isSamePathAllowingCaseChange", () => {
  it("treats slash-normalized and case-only changes as the same path", () => {
    expect(isSamePathAllowingCaseChange("/vault/a.md", "/vault/a.md")).toBe(
      true,
    );
    expect(isSamePathAllowingCaseChange("/vault/A.md", "/vault/a.md")).toBe(
      true,
    );
    expect(isSamePathAllowingCaseChange("/vault/a.md", "/vault/b.md")).toBe(
      false,
    );
  });
});
