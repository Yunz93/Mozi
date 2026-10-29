import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode } from "../types";
import { clearAttachmentResolverCache } from "./attachmentResolver";
import { findUnusedAttachments } from "./attachmentCleanup";

const mocks = vi.hoisted(() => ({ readDirectory: vi.fn(), readFile: vi.fn() }));
vi.mock("../types/filesystem", () => ({
  getFileSystem: async () => ({ ...mocks, fileExists: async () => true }),
  isTauriEnvironment: () => false,
}));

function file(path: string): FileNode {
  return { id: path, path, name: path.split("/").pop()!, type: "file" };
}

describe("findUnusedAttachments reference links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAttachmentResolverCache();
  });

  it("preserves reference images while still finding an unused attachment", async () => {
    const note = file("/vault/note.md");
    const used = file("/vault/resources/cover.png");
    const unused = file("/vault/resources/unused.png");
    mocks.readDirectory.mockResolvedValue([used, unused]);
    mocks.readFile.mockResolvedValue(
      '![cover][asset]\n\n[asset]: resources/cover.png "cover"',
    );
    const result = await findUnusedAttachments({
      files: [note, used, unused],
      rootFolderPath: "/vault",
      resourceFolder: "resources",
    });
    expect(result.unusedAttachments).toEqual([unused]);
    expect(result.attachmentFiles).toEqual([used, unused]);
  });
  it("preserves images whose inline destination contains parentheses", async () => {
    const note = file("/vault/note.md");
    const used = file("/vault/resources/a(b).png");
    const unused = file("/vault/resources/unused.png");
    mocks.readDirectory.mockResolvedValue([used, unused]);
    mocks.readFile.mockResolvedValue("![diagram](resources/a(b).png)");
    const result = await findUnusedAttachments({
      files: [note, used, unused],
      rootFolderPath: "/vault",
      resourceFolder: "resources",
    });
    expect(result.unusedAttachments).toEqual([unused]);
    expect(result.attachmentFiles).toEqual([used, unused]);
  });
});
