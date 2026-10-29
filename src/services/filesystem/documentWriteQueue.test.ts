import { describe, expect, it, vi } from "vitest";
import { acquireDocumentWrite, writeDocumentFile } from "./documentWriteQueue";

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("../../types/filesystem", () => ({
  getFileSystem: async () => ({ writeFile }),
}));

describe("document write ordering", () => {
  it("serializes the same path while allowing other documents to save", async () => {
    const releaseA = await acquireDocumentWrite("/a.md");
    let secondStarted = false;
    const second = acquireDocumentWrite("/a.md").then((release) => {
      secondStarted = true;
      release();
    });
    const releaseB = await acquireDocumentWrite("/b.md");
    expect(secondStarted).toBe(false);
    releaseB();
    releaseA();
    await second;
    expect(secondStarted).toBe(true);
  });

  it("releases a failed write so the next save can complete", async () => {
    writeFile
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    await expect(writeDocumentFile("/retry.md", "old")).rejects.toThrow(
      "disk full",
    );
    await expect(
      writeDocumentFile("/retry.md", "new"),
    ).resolves.toBeUndefined();
    expect(writeFile.mock.calls).toEqual([
      ["/retry.md", "old"],
      ["/retry.md", "new"],
    ]);
  });
});
