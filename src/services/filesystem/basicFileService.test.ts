import { describe, expect, it, vi } from "vitest";
import { openStandaloneFileByPath } from "./basicFileService";

const withErrorHandling = async <T>(fn: () => Promise<T>): Promise<T> => fn();
const getPathBasename = (path: string): string => path.split("/").pop() || path;

describe("openStandaloneFileByPath", () => {
  it("opens a markdown file from an explicit path", async () => {
    const fs = {
      createDirectory: vi.fn(),
      createFile: vi.fn(),
      openFile: vi.fn(),
      readFile: vi.fn(async () => "# note"),
      registerAllowedPath: vi.fn(async () => undefined),
    };

    const result = await openStandaloneFileByPath(
      fs,
      "/notes/example.md",
      getPathBasename,
      withErrorHandling,
    );

    expect(fs.registerAllowedPath).toHaveBeenCalledWith(
      "/notes/example.md",
      false,
    );
    expect(fs.readFile).toHaveBeenCalledWith("/notes/example.md");
    expect(result).toEqual({
      file: {
        id: "/notes/example.md",
        name: "example.md",
        type: "file",
        path: "/notes/example.md",
        isTrash: false,
      },
      content: "# note",
    });
  });

  it("rejects non-markdown files before reading", async () => {
    const fs = {
      createDirectory: vi.fn(),
      createFile: vi.fn(),
      openFile: vi.fn(),
      readFile: vi.fn(async () => "plain text"),
      registerAllowedPath: vi.fn(async () => undefined),
    };

    await expect(
      openStandaloneFileByPath(
        fs,
        "/notes/example.txt",
        getPathBasename,
        withErrorHandling,
      ),
    ).rejects.toThrow(
      "Only Markdown or Excalidraw files can be opened directly.",
    );

    expect(fs.registerAllowedPath).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});
