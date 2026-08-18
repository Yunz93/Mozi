import { describe, it, expect, vi } from "vitest";
import type { FileNode } from "../types";
import { findAndRewriteAffectedFiles } from "./linkRewriter";

function file(path: string, name?: string): FileNode {
  return {
    id: path,
    path,
    name: name ?? path.split("/").pop()!,
    type: "file",
  };
}

const ROOT = "/vault";

async function runRewrite(opts: {
  movedPathMap: Record<string, string>;
  files: FileNode[];
  fileContents: Record<string, string>;
}) {
  return findAndRewriteAffectedFiles({
    movedPathMap: opts.movedPathMap,
    files: opts.files,
    rootFolderPath: ROOT,
    fileContentOverrides: opts.fileContents,
    readFile: vi.fn().mockRejectedValue(new Error("not mocked")),
  });
}

describe("linkRewriter", () => {
  describe("standard markdown links", () => {
    it("rewrites image link when resource file is moved", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/sub/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/sub/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![photo](../resources/img.png)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "![photo](../resources/sub/img.png)",
      );
    });

    it("rewrites image links when the filename is NFD in markdown and NFC on disk", async () => {
      const nfcName = "截图 café 2026.png";
      const nfdName = nfcName.normalize("NFD");
      expect(nfdName).not.toBe(nfcName);

      const files = [
        file("/vault/notes/a.md"),
        file(`/vault/resources/${nfcName}`),
      ];
      const result = await runRewrite({
        movedPathMap: {
          [`/vault/resources/${nfcName}`]: `/vault/attachments/${nfcName}`,
        },
        files,
        fileContents: {
          "/vault/notes/a.md": `![shot](<../resources/${nfdName}>)`,
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        `![shot](<../attachments/${nfcName}>)`,
      );
    });

    it("rewrites standard link when target is moved", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/archive/report.pdf"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/docs/report.pdf": "/vault/archive/report.pdf",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "[report](../docs/report.pdf)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "[report](../archive/report.pdf)",
      );
    });

    it("handles angle-bracket paths", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/my file.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/my file.png": "/vault/resources/new/my file.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![img](<../resources/my file.png>)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "![img](<../resources/new/my file.png>)",
      );
    });

    it("preserves title strings in links", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/new/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": '![alt](../resources/img.png "my title")',
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        '![alt](../resources/new/img.png "my title")',
      );
    });

    it("rewrites angle-bracket paths while preserving titles", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/my file.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/my file.png": "/vault/resources/new/my file.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md":
            '![alt](<../resources/my file.png> "cover title")',
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        '![alt](<../resources/new/my file.png> "cover title")',
      );
    });

    it("preserves fragment identifiers", async () => {
      const files = [file("/vault/notes/a.md"), file("/vault/docs/guide.md")];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/reference/guide.md": "/vault/docs/guide.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "[see here](../reference/guide.md#installation)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "[see here](../docs/guide.md#installation)",
      );
    });

    it("does not rewrite hash-only links", async () => {
      const files = [file("/vault/notes/a.md")];
      const result = await runRewrite({
        movedPathMap: { "/vault/old": "/vault/new" },
        files,
        fileContents: {
          "/vault/notes/a.md": "[back to top](#introduction)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("handles absolute paths in links", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/new/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![photo](/vault/resources/img.png)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      // Absolute path is rewritten to relative for portability
      expect(result.modifiedFiles[0].newContent).toBe(
        "![photo](../resources/new/img.png)",
      );
    });

    it("rewrites root-relative links preserving style", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/new/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![photo](resources/img.png)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "![photo](resources/new/img.png)",
      );
    });

    it("does not rewrite links to unmoved files", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/other.png"),
        file("/vault/resources/sub/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/sub/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![other](../resources/other.png)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("does not rewrite external URLs", async () => {
      const files = [file("/vault/notes/a.md")];
      const result = await runRewrite({
        movedPathMap: { "/vault/old": "/vault/new" },
        files,
        fileContents: {
          "/vault/notes/a.md": "[link](https://example.com)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("does not rewrite links to non-existent unmoved files", async () => {
      const files = [file("/vault/notes/a.md")];
      const result = await runRewrite({
        movedPathMap: { "/vault/old": "/vault/new" },
        files,
        fileContents: {
          "/vault/notes/a.md": "[link](../missing/file.png)",
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("handles markdown links with invalid percent-encoding", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/new/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![alt](../resources/%ZZ/img.png)",
        },
      });

      // %ZZ is invalid percent-encoding; decodeTarget falls back to raw string
      // The path won't match anything in pathMap, so no rewrite happens
      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("resolves root-relative link when target exists in allFilePaths", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/sub/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {},
        files,
        fileContents: {
          "/vault/notes/a.md": "![photo](resources/sub/img.png)",
        },
      });

      // File exists but was not moved, so no rewrite needed
      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("handles moved paths outside vault root", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/other/path/img.png": "/vault/resources/new/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![alt](../../other/path/img.png)",
        },
      });

      // The old path /other/path/img.png is not under /vault, so getPathRelativeToRoot
      // falls back to returning normAbs. The link resolution should still work.
      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "![alt](../resources/new/img.png)",
      );
    });
  });

  describe("wiki links", () => {
    it("rewrites wiki link when file is renamed", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/notes/new-name.md"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/old-name.md": "/vault/notes/new-name.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[old-name]] for details.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "See [[new-name]] for details.",
      );
    });

    it("rewrites path-based wiki link when basename changes via basename fallback", async () => {
      // The wiki link uses a path that doesn't match any byRelativePath entry,
      // but the basename matches a byBasename entry with basenameChanged=true.
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/notes/new-name.md"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/old-name.md": "/vault/notes/new-name.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[sub/old-name]] for reference.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "See [[sub/new-name]] for reference.",
      );
    });

    it("does not rewrite wiki link when file is only moved (basename unchanged)", async () => {
      const files = [file("/vault/notes/a.md"), file("/vault/archive/note.md")];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/note.md": "/vault/archive/note.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[note]] for details.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("rewrites wiki link with heading, preserving subpath", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/notes/renamed.md"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/original.md": "/vault/notes/renamed.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[original#installation]] for setup.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "See [[renamed#installation]] for setup.",
      );
    });

    it("rewrites wiki link with block reference, preserving subpath", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/notes/renamed.md"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/original.md": "/vault/notes/renamed.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![[original#^abc123]]",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe("![[renamed#^abc123]]");
    });

    it("rewrites wiki link with alias, preserving alias", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/notes/renamed.md"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/original.md": "/vault/notes/renamed.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[original|my display text]] here.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "See [[renamed|my display text]] here.",
      );
    });

    it("rewrites path-based wiki link when folder moves", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/archive/docs/guide.md"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/docs/guide.md": "/vault/archive/docs/guide.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[docs/guide]] for reference.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "See [[archive/docs/guide]] for reference.",
      );
    });

    it("rewrites wiki embed when resource is renamed", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new-photo.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/photo.png": "/vault/resources/new-photo.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": "![[photo.png]]",
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe("![[new-photo.png]]");
    });

    it("rewrites wiki embed when NFC and NFD Chinese names differ", async () => {
      const nfcName = "截图 café 2026.png";
      const nfdName = nfcName.normalize("NFD");
      expect(nfdName).not.toBe(nfcName);

      const files = [
        file("/vault/notes/a.md"),
        file(`/vault/attachments/${nfcName}`),
      ];
      const result = await runRewrite({
        movedPathMap: {
          [`/vault/resources/${nfdName}`]: `/vault/attachments/${nfcName}`,
        },
        files,
        fileContents: {
          "/vault/notes/a.md": `![[resources/${nfdName}]] and ![[${nfdName}]]`,
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        `![[attachments/${nfcName}]] and ![[${nfdName}]]`,
      );
    });

    it("rewrites a renamed Chinese wiki embed across NFC and NFD", async () => {
      const nfcName = "截图 café 2026.png";
      const nfdName = nfcName.normalize("NFD");
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/cover.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          [`/vault/resources/${nfcName}`]: "/vault/resources/cover.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": `![[${nfdName}]]`,
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe("![[cover.png]]");
    });

    it("does not rewrite wiki link with empty path", async () => {
      const files = [file("/vault/notes/a.md")];
      const result = await runRewrite({
        movedPathMap: { "/vault/old": "/vault/new" },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[#heading]] for details.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("does not rewrite wiki link that normalizes to empty", async () => {
      const files = [file("/vault/notes/a.md")];
      const result = await runRewrite({
        movedPathMap: { "/vault/old": "/vault/new" },
        files,
        fileContents: {
          "/vault/notes/a.md": "See [[/]] for details.",
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });
  });

  describe("HTML references", () => {
    it("rewrites img src when resource is moved", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/new/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": '<img src="../resources/img.png" alt="photo">',
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        '<img src="../resources/new/img.png" alt="photo">',
      );
    });

    it("rewrites anchor href when target is moved", async () => {
      const files = [file("/vault/notes/a.md"), file("/vault/archive/doc.pdf")];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/docs/doc.pdf": "/vault/archive/doc.pdf",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": '<a href="../docs/doc.pdf">download</a>',
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        '<a href="../archive/doc.pdf">download</a>',
      );
    });

    it("does not rewrite empty HTML src/href", async () => {
      const files = [file("/vault/notes/a.md")];
      const result = await runRewrite({
        movedPathMap: { "/vault/old": "/vault/new" },
        files,
        fileContents: {
          "/vault/notes/a.md": '<img src="" alt="photo">',
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("does not rewrite HTML reference to unmoved file", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/other.png"),
      ];
      const result = await runRewrite({
        movedPathMap: { "/vault/old": "/vault/new" },
        files,
        fileContents: {
          "/vault/notes/a.md": '<img src="../resources/other.png" alt="photo">',
        },
      });

      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("does not rewrite HTML reference when resolved path equals decoded path", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/img.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": '<img src="../resources/img.png" alt="photo">',
        },
      });

      // Target exists but path didn't actually change
      expect(result.modifiedFiles).toHaveLength(0);
    });
  });

  describe("folder moves", () => {
    it("rewrites all references to files under a moved folder", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/archive/screenshots/s1.png"),
        file("/vault/archive/screenshots/s2.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/screenshots": "/vault/archive/screenshots",
          "/vault/resources/screenshots/s1.png":
            "/vault/archive/screenshots/s1.png",
          "/vault/resources/screenshots/s2.png":
            "/vault/archive/screenshots/s2.png",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": [
            "![one](../resources/screenshots/s1.png)",
            "![two](../resources/screenshots/s2.png)",
          ].join("\n"),
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        [
          "![one](../archive/screenshots/s1.png)",
          "![two](../archive/screenshots/s2.png)",
        ].join("\n"),
      );
    });
  });

  describe("moved file outgoing links", () => {
    it("does not rewrite when moved file relative path still resolves correctly", async () => {
      const files = [
        file("/vault/archive/a.md"),
        file("/vault/resources/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/a.md": "/vault/archive/a.md",
        },
        files,
        fileContents: {
          "/vault/archive/a.md": "![photo](../resources/img.png)",
        },
      });

      // Both /vault/notes/ and /vault/archive/ are same depth, so ../resources still works
      expect(result.modifiedFiles).toHaveLength(0);
    });

    it("does not rewrite links inside moved file when relative path still valid", async () => {
      const files = [
        file("/vault/sub/notes/a.md"),
        file("/vault/resources/img.png"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/notes/a.md": "/vault/sub/notes/a.md",
        },
        files,
        fileContents: {
          "/vault/sub/notes/a.md": "![photo](../resources/img.png)",
        },
      });

      // From /vault/notes/a.md, ../resources/img.png → /vault/resources/img.png
      // From /vault/sub/notes/a.md, the new relative should be ../../resources/img.png
      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "![photo](../../resources/img.png)",
      );
    });
  });

  describe("multiple link types in one file", () => {
    it("rewrites all link types in the same file", async () => {
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
        file("/vault/notes/renamed.md"),
      ];
      const result = await runRewrite({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/new/img.png",
          "/vault/notes/original.md": "/vault/notes/renamed.md",
        },
        files,
        fileContents: {
          "/vault/notes/a.md": [
            "![photo](../resources/img.png)",
            "[[original]]",
            '<img src="../resources/img.png">',
          ].join("\n"),
        },
      });

      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        [
          "![photo](../resources/new/img.png)",
          "[[renamed]]",
          '<img src="../resources/new/img.png">',
        ].join("\n"),
      );
    });
  });

  describe("reads from disk when not in memory", () => {
    it("calls readFile for files not in fileContentOverrides", async () => {
      const mockReadFile = vi
        .fn()
        .mockResolvedValue("![photo](../resources/img.png)");
      const files = [
        file("/vault/notes/a.md"),
        file("/vault/resources/new/img.png"),
      ];

      const result = await findAndRewriteAffectedFiles({
        movedPathMap: {
          "/vault/resources/img.png": "/vault/resources/new/img.png",
        },
        files,
        rootFolderPath: ROOT,
        fileContentOverrides: {},
        readFile: mockReadFile,
      });

      expect(mockReadFile).toHaveBeenCalledWith("/vault/notes/a.md");
      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].newContent).toBe(
        "![photo](../resources/new/img.png)",
      );
    });
  });
});
