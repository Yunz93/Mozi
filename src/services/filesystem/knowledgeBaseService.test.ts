import { describe, expect, it, vi } from "vitest";
import type { FileNode } from "../../types";
import { openKnowledgeBaseWorkspace } from "./knowledgeBaseService";

function createFileNode(path: string, name: string): FileNode {
  return {
    id: path,
    path,
    name,
    type: "file",
  };
}

function createBaseParams(
  overrides: Partial<Parameters<typeof openKnowledgeBaseWorkspace>[0]> = {},
) {
  const fileNodes = [createFileNode("/vault/note.md", "note.md")];

  return {
    addTab: vi.fn(),
    clearAllCache: vi.fn(),
    beforeCommit: vi.fn(async () => true),
    findPreferredFile: vi.fn((_nodes: FileNode[], filePath: string) =>
      fileNodes.find((node) => node.path === filePath),
    ),
    fs: {
      copySampleNotes: vi.fn(),
      fileExists: vi.fn(async () => true),
      openDirectory: vi.fn(async () => "/selected"),
      readDirectory: vi.fn(async () => fileNodes),
      readFile: vi.fn(async () => "# note"),
    },
    hasOpenedKnowledgeBaseBefore: vi.fn(() => true),
    handleInitialFileError: vi.fn(),
    initializeSampleNotes: vi.fn(async () => false),
    lastOpenedFilePath: null as string | null,
    options: {
      path: "/vault",
      skipSampleNotes: true,
    },
    registerAllowedPath: vi.fn(async () => undefined),
    registerAllowedPathIfExists: vi.fn(async () => undefined),
    setCurrentFilePath: vi.fn(),
    setFiles: vi.fn(),
    setRootFolderPath: vi.fn(),
    trashFolder: ".trash",
    withErrorHandling: async <T>(fn: () => Promise<T>) => fn(),
    ...overrides,
  };
}

describe("openKnowledgeBaseWorkspace", () => {
  it("checks the latest old workspace after directory reads before clearing it", async () => {
    let latest = "before read";
    const saved: string[] = [];
    const params = createBaseParams({
      beforeCommit: vi.fn(async () => {
        saved.push(latest);
        return true;
      }),
    });
    vi.mocked(params.fs.readDirectory).mockImplementation(async () => {
      latest = "typed while reading the directory";
      return [];
    });
    vi.mocked(params.clearAllCache).mockImplementation(() => {
      expect(saved).toEqual([latest]);
    });
    await openKnowledgeBaseWorkspace(params);
    expect(params.beforeCommit).toHaveBeenCalledOnce();
    expect(params.setRootFolderPath).toHaveBeenCalledWith("/vault");
  });

  it("preserves the old workspace when saving or ownership validation rejects the commit", async () => {
    const params = createBaseParams({ beforeCommit: vi.fn(async () => false) });
    expect(await openKnowledgeBaseWorkspace(params)).toBeNull();
    expect(params.clearAllCache).not.toHaveBeenCalled();
    expect(params.setFiles).not.toHaveBeenCalled();
    expect(params.setRootFolderPath).not.toHaveBeenCalled();
  });

  it("opens an existing knowledge base path after registering fs scope without auto-opening a file", async () => {
    const params = createBaseParams();

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.registerAllowedPath).toHaveBeenCalledWith("/vault", true);
    expect(params.fs.fileExists).toHaveBeenCalledWith("/vault");
    expect(params.fs.readDirectory).toHaveBeenCalledWith("/vault");
    expect(params.setRootFolderPath).toHaveBeenCalledWith("/vault");
    expect(params.addTab).not.toHaveBeenCalled();
    expect(params.setCurrentFilePath).toHaveBeenCalledWith(null);
    expect(result?.dirPath).toBe("/vault");
    expect(result?.initialFile).toBeNull();
  });

  it("does not restore lastOpenedFilePath unless restoreLastOpenedFile is enabled", async () => {
    const params = createBaseParams({
      lastOpenedFilePath: "/vault/note.md",
      options: {
        path: "/vault",
        skipSampleNotes: true,
        restoreLastOpenedFile: false,
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.addTab).not.toHaveBeenCalled();
    expect(result?.initialFile).toBeNull();
  });

  it("restores lastOpenedFilePath when restoreLastOpenedFile is enabled and the file exists", async () => {
    const params = createBaseParams({
      lastOpenedFilePath: "/vault/note.md",
      options: {
        path: "/vault",
        skipSampleNotes: true,
        restoreLastOpenedFile: true,
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.addTab).toHaveBeenCalledWith("/vault/note.md", "# note");
    expect(params.setCurrentFilePath).toHaveBeenCalledWith("/vault/note.md");
    expect(result?.initialFile?.path).toBe("/vault/note.md");
  });

  it.each([
    ["C:\\vault\\note.md", "\\\\?\\C:\\vault\\note.md"],
    ["\\\\?\\C:\\vault\\note.md", "C:\\vault\\note.md"],
    ["\\\\server\\share\\note.md", "\\\\?\\UNC\\server\\share\\note.md"],
  ])(
    "restores the same Windows file across native path spellings (%s)",
    async (treePath, savedPath) => {
      const file = createFileNode(treePath, "note.md");
      const params = createBaseParams({
        lastOpenedFilePath: savedPath,
        options: {
          path: "C:\\vault",
          skipSampleNotes: true,
          restoreLastOpenedFile: true,
        },
        findPreferredFile: vi.fn((_nodes, path) =>
          path === treePath ? file : undefined,
        ),
      });
      vi.mocked(params.fs.readDirectory).mockResolvedValue([file]);
      const result = await openKnowledgeBaseWorkspace(params);
      expect(result?.initialFile).toEqual(file);
      expect(params.addTab).toHaveBeenCalledWith(treePath, "# note");
      expect(params.fs.readFile).toHaveBeenCalledWith(treePath);
    },
  );

  it.each([
    ["/vault/note.md", "/vault/Note.md"],
    ["/vault/a/b.md", "/vault/a\\b.md"],
    ["C:\\vault\\note.md", "C:\\other\\note.md"],
    ["C:\\vault\\note.md", "C:\\vault\\Note.md"],
  ])(
    "does not restore a different file through path normalization (%s)",
    async (treePath, savedPath) => {
      const params = createBaseParams({
        lastOpenedFilePath: savedPath,
        options: {
          path: "/vault",
          skipSampleNotes: true,
          restoreLastOpenedFile: true,
        },
        findPreferredFile: vi.fn((_nodes, path) =>
          path === treePath ? createFileNode(treePath, "note.md") : undefined,
        ),
      });
      vi.mocked(params.fs.readDirectory).mockResolvedValue([
        createFileNode(treePath, "note.md"),
      ]);
      const result = await openKnowledgeBaseWorkspace(params);
      expect(result?.initialFile).toBeNull();
      expect(params.addTab).not.toHaveBeenCalled();
    },
  );

  it("does not fall back to the first file when opening a folder with 未命名.md", async () => {
    const untitled = createFileNode("/vault/未命名.md", "未命名.md");
    const params = createBaseParams({
      lastOpenedFilePath: null,
      findPreferredFile: vi.fn(() => undefined),
      fs: {
        copySampleNotes: vi.fn(),
        fileExists: vi.fn(async () => true),
        openDirectory: vi.fn(async () => "/selected"),
        readDirectory: vi.fn(async () => [untitled]),
        readFile: vi.fn(async () => "# untitled"),
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.addTab).not.toHaveBeenCalled();
    expect(result?.initialFile).toBeNull();
  });

  it("returns null for a missing restored knowledge base path", async () => {
    const params = createBaseParams({
      fs: {
        copySampleNotes: vi.fn(),
        fileExists: vi.fn(async () => false),
        openDirectory: vi.fn(async () => "/selected"),
        readDirectory: vi.fn(async () => [
          createFileNode("/vault/note.md", "note.md"),
        ]),
        readFile: vi.fn(async () => "# note"),
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.registerAllowedPath).toHaveBeenCalledWith("/vault", true);
    expect(params.fs.fileExists).toHaveBeenCalledWith("/vault");
    expect(params.registerAllowedPathIfExists).not.toHaveBeenCalled();
    expect(params.fs.readDirectory).not.toHaveBeenCalled();
    expect(params.setFiles).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("continues opening when fileExists is unavailable", async () => {
    const params = createBaseParams({
      fs: {
        copySampleNotes: vi.fn(),
        openDirectory: vi.fn(async () => "/selected"),
        readDirectory: vi.fn(async () => [
          createFileNode("/vault/note.md", "note.md"),
        ]),
        readFile: vi.fn(async () => "# note"),
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.registerAllowedPath).toHaveBeenCalledWith("/vault", true);
    expect(params.fs.readDirectory).toHaveBeenCalledWith("/vault");
    expect(result?.dirPath).toBe("/vault");
    expect(params.addTab).not.toHaveBeenCalled();
  });

  it("opens a restored PDF preview without reading it as text", async () => {
    const pdfNodes = [createFileNode("/vault/archive.pdf", "archive.pdf")];
    const params = createBaseParams({
      findPreferredFile: vi.fn((_nodes: FileNode[], filePath: string) =>
        pdfNodes.find((node) => node.path === filePath),
      ),
      lastOpenedFilePath: "/vault/archive.pdf",
      options: {
        path: "/vault",
        skipSampleNotes: true,
        restoreLastOpenedFile: true,
      },
      fs: {
        copySampleNotes: vi.fn(),
        fileExists: vi.fn(async () => true),
        openDirectory: vi.fn(async () => "/selected"),
        readDirectory: vi.fn(async () => pdfNodes),
        readFile: vi.fn(async () => {
          throw new Error("PDF should not be read as text");
        }),
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.fs.readFile).not.toHaveBeenCalled();
    expect(params.addTab).toHaveBeenCalledWith("/vault/archive.pdf");
    expect(params.setCurrentFilePath).toHaveBeenCalledWith(
      "/vault/archive.pdf",
    );
    expect(result?.openedPreviewOnly).toBe(true);
  });

  it("opens a restored image preview without reading it as text", async () => {
    const imageNodes = [createFileNode("/vault/poster.png", "poster.png")];
    const params = createBaseParams({
      findPreferredFile: vi.fn((_nodes: FileNode[], filePath: string) =>
        imageNodes.find((node) => node.path === filePath),
      ),
      lastOpenedFilePath: "/vault/poster.png",
      options: {
        path: "/vault",
        skipSampleNotes: true,
        restoreLastOpenedFile: true,
      },
      fs: {
        copySampleNotes: vi.fn(),
        fileExists: vi.fn(async () => true),
        openDirectory: vi.fn(async () => "/selected"),
        readDirectory: vi.fn(async () => imageNodes),
        readFile: vi.fn(async () => {
          throw new Error("Image should not be read as text");
        }),
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.fs.readFile).not.toHaveBeenCalled();
    expect(params.addTab).toHaveBeenCalledWith("/vault/poster.png");
    expect(result?.openedPreviewOnly).toBe(true);
  });

  it("reads restored HTML into the tab and marks preview-only on success", async () => {
    const htmlNodes = [createFileNode("/vault/page.html", "page.html")];
    const params = createBaseParams({
      findPreferredFile: vi.fn((_nodes: FileNode[], filePath: string) =>
        htmlNodes.find((node) => node.path === filePath),
      ),
      lastOpenedFilePath: "/vault/page.html",
      options: {
        path: "/vault",
        skipSampleNotes: true,
        restoreLastOpenedFile: true,
      },
      fs: {
        copySampleNotes: vi.fn(),
        fileExists: vi.fn(async () => true),
        openDirectory: vi.fn(async () => "/selected"),
        readDirectory: vi.fn(async () => htmlNodes),
        readFile: vi.fn(async () => "<p>hello</p>"),
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.fs.readFile).toHaveBeenCalledWith("/vault/page.html");
    expect(params.addTab).toHaveBeenCalledWith(
      "/vault/page.html",
      "<p>hello</p>",
    );
    expect(result?.openedPreviewOnly).toBe(true);
  });

  it("does not mark preview-only when the initial HTML read fails", async () => {
    const htmlNodes = [createFileNode("/vault/page.html", "page.html")];
    const params = createBaseParams({
      findPreferredFile: vi.fn((_nodes: FileNode[], filePath: string) =>
        htmlNodes.find((node) => node.path === filePath),
      ),
      lastOpenedFilePath: "/vault/page.html",
      options: {
        path: "/vault",
        skipSampleNotes: true,
        restoreLastOpenedFile: true,
      },
      fs: {
        copySampleNotes: vi.fn(),
        fileExists: vi.fn(async () => true),
        openDirectory: vi.fn(async () => "/selected"),
        readDirectory: vi.fn(async () => htmlNodes),
        readFile: vi.fn(async () => {
          throw new Error("read failed");
        }),
      },
    });

    const result = await openKnowledgeBaseWorkspace(params);

    expect(params.addTab).not.toHaveBeenCalled();
    expect(params.setCurrentFilePath).not.toHaveBeenCalledWith(
      "/vault/page.html",
    );
    expect(params.handleInitialFileError).toHaveBeenCalled();
    expect(result?.openedPreviewOnly).toBe(false);
  });
});
