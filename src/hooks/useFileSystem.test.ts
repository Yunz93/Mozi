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

  it("allows overwrite when the target is the source path", async () => {
    const fileExists = vi.fn(async () => true);

    await expect(
      assertTargetPathAvailable(
        { fileExists },
        "/vault/Note.md",
        "/vault/note.md",
      ),
    ).resolves.toBeUndefined();

    expect(fileExists).not.toHaveBeenCalled();
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
