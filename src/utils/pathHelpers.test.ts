import { describe, it, expect } from "vitest";
import {
  getPathSeparator,
  joinFsPath,
  normalizeSlashes,
  canonicalizePath,
  sanitizeResourceFolder,
  getPathBasename,
  getRelativePath,
  getPathDirname,
  decodeUserFacingPath,
} from "./pathHelpers";

describe("getPathSeparator", () => {
  it("returns backslash for Windows paths", () => {
    expect(getPathSeparator("C:\\Users\\test")).toBe("\\");
  });

  it("returns forward slash for Unix paths", () => {
    expect(getPathSeparator("/home/user/test")).toBe("/");
  });

  it("returns forward slash for bare filenames", () => {
    expect(getPathSeparator("file.txt")).toBe("/");
  });
});

describe("joinFsPath", () => {
  it("joins Unix paths", () => {
    expect(joinFsPath("/home/user", "docs", "file.md")).toBe(
      "/home/user/docs/file.md",
    );
  });

  it("joins Windows paths", () => {
    expect(joinFsPath("C:\\Users\\test", "docs")).toBe("C:\\Users\\test\\docs");
  });

  it("handles trailing separator", () => {
    expect(joinFsPath("/home/user/", "file.md")).toBe("/home/user/file.md");
  });

  it("skips empty segments", () => {
    expect(joinFsPath("/home", "", "file.md")).toBe("/home/file.md");
  });
});

describe("normalizeSlashes", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizeSlashes("C:\\Users\\test")).toBe("C:/Users/test");
  });

  it("strips trailing slashes", () => {
    expect(normalizeSlashes("/home/user/")).toBe("/home/user");
    expect(normalizeSlashes("/home/user///")).toBe("/home/user");
  });

  it("handles already normalized paths", () => {
    expect(normalizeSlashes("/home/user/file.md")).toBe("/home/user/file.md");
  });
});

describe("canonicalizePath", () => {
  it("NFC-normalizes Unicode filenames so NFD matches NFC", () => {
    const nfc = "截图 café.png";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(canonicalizePath(`/vault/${nfd}`)).toBe(`/vault/${nfc}`);
  });
});

describe("sanitizeResourceFolder", () => {
  it("trims whitespace and normalizes slashes", () => {
    expect(sanitizeResourceFolder("  resources  ")).toBe("resources");
    expect(sanitizeResourceFolder("path\\to\\folder")).toBe("path/to/folder");
  });

  it("strips leading/trailing slashes", () => {
    expect(sanitizeResourceFolder("/resources/")).toBe("resources");
    expect(sanitizeResourceFolder("///resources///")).toBe("resources");
  });

  it("strips leading ./", () => {
    expect(sanitizeResourceFolder("./resources")).toBe("resources");
  });

  it("throws on path traversal with ..", () => {
    expect(() => sanitizeResourceFolder("../etc")).toThrow("Path traversal");
    expect(() => sanitizeResourceFolder("resources/../etc")).toThrow(
      "Path traversal",
    );
    expect(() => sanitizeResourceFolder("foo/../../etc")).toThrow(
      "Path traversal",
    );
  });

  it("allows dots in folder names that are not traversal", () => {
    expect(sanitizeResourceFolder(".hidden")).toBe(".hidden");
    expect(sanitizeResourceFolder("my.resources")).toBe("my.resources");
  });
});

describe("getPathBasename", () => {
  it("extracts basename from Unix path", () => {
    expect(getPathBasename("/home/user/file.md")).toBe("file.md");
  });

  it("extracts basename from Windows path", () => {
    expect(getPathBasename("C:\\Users\\test\\file.md")).toBe("file.md");
  });

  it("handles bare filename", () => {
    expect(getPathBasename("file.md")).toBe("file.md");
  });

  it("returns path itself for empty result", () => {
    expect(getPathBasename("")).toBe("");
  });
});

describe("getRelativePath", () => {
  it("computes relative path between sibling directories", () => {
    expect(
      getRelativePath("/vault/notes/a.md", "/vault/resources/img.png"),
    ).toBe("../resources/img.png");
  });

  it("computes relative path to a deeper directory", () => {
    expect(getRelativePath("/vault/notes/a.md", "/vault/notes/sub/b.md")).toBe(
      "sub/b.md",
    );
  });

  it("computes relative path from deeper directory", () => {
    expect(
      getRelativePath("/vault/notes/sub/a.md", "/vault/resources/img.png"),
    ).toBe("../../resources/img.png");
  });

  it("computes relative path for same directory", () => {
    expect(getRelativePath("/vault/notes/a.md", "/vault/notes/b.md")).toBe(
      "b.md",
    );
  });

  it("handles Windows-style backslashes", () => {
    expect(
      getRelativePath(
        "C:\\vault\\notes\\a.md",
        "C:\\vault\\resources\\img.png",
      ),
    ).toBe("../resources/img.png");
  });

  it("returns . when from and to are in the same directory", () => {
    expect(getRelativePath("/vault/a.md", "/vault/")).toBe(".");
  });
});

describe("getPathDirname", () => {
  it("returns parent directory of a file", () => {
    expect(getPathDirname("/vault/notes/a.md")).toBe("/vault/notes");
  });

  it("returns parent of a directory path", () => {
    expect(getPathDirname("/vault/notes")).toBe("/vault");
  });

  it("returns / for root-level files", () => {
    expect(getPathDirname("/file.md")).toBe("/");
  });

  it("normalizes backslashes", () => {
    expect(getPathDirname("C:\\Users\\vault\\file.md")).toBe("C:/Users/vault");
  });
});

describe("decodeUserFacingPath", () => {
  it("decodes percent-encoded Chinese filenames for toasts", () => {
    expect(
      decodeUserFacingPath(
        "%E5%85%B7%E8%BA%AB%E6%99%BA%E8%83%BD%E5%BC%80%E6%BA%90%E5%B9%B3%E5%8F%B0%E5%AE%8C%E6%95%B4%20PRD.md",
      ),
    ).toBe("具身智能开源平台完整 PRD.md");
  });

  it("leaves already-decoded Unicode and remote URLs unchanged", () => {
    expect(decodeUserFacingPath("具身智能开源平台完整 PRD.md")).toBe(
      "具身智能开源平台完整 PRD.md",
    );
    expect(decodeUserFacingPath("https://example.com/%E4%B8%AD.md")).toBe(
      "https://example.com/%E4%B8%AD.md",
    );
  });

  it("keeps malformed percent sequences as-is", () => {
    expect(decodeUserFacingPath("notes/%E0%A4%A.md")).toBe("notes/%E0%A4%A.md");
  });
});
