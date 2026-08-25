import { describe, it, expect } from "vitest";
import {
  parseWikiLinkReference,
  extractWikiNoteFragment,
  resolveWikiLinkFile,
  buildWikiReferenceTarget,
  splitObsidianImageAlt,
} from "./wikiLinks";
import type { FileNode } from "../types";

describe("parseWikiLinkReference", () => {
  it("parses simple wiki link", () => {
    const result = parseWikiLinkReference("My Note");
    expect(result.path).toBe("My Note");
    expect(result.subpath).toBe("");
    expect(result.subpathType).toBeNull();
    expect(result.displayText).toBe("My Note");
  });

  it("parses wiki link with alias", () => {
    const result = parseWikiLinkReference("My Note|display text");
    expect(result.path).toBe("My Note");
    expect(result.displayText).toBe("display text");
  });

  it("parses wiki link with heading subpath", () => {
    const result = parseWikiLinkReference("My Note#Section");
    expect(result.path).toBe("My Note");
    expect(result.subpath).toBe("Section");
    expect(result.subpathType).toBe("heading");
  });

  it("parses wiki link with block reference", () => {
    const result = parseWikiLinkReference("My Note#^block-id");
    expect(result.path).toBe("My Note");
    expect(result.subpath).toBe("^block-id");
    expect(result.subpathType).toBe("block");
  });

  it("parses heading-only reference", () => {
    const result = parseWikiLinkReference("#Section");
    expect(result.path).toBe("");
    expect(result.subpath).toBe("Section");
    expect(result.subpathType).toBe("heading");
  });

  it("strips markdown extension from display text", () => {
    const result = parseWikiLinkReference("notes/My Note.md");
    expect(result.displayText).toBe("My Note");
  });

  it("parses embed with size dimensions", () => {
    const result = parseWikiLinkReference("image.png|300x200", { embed: true });
    expect(result.embedSize).toEqual({ width: 300, height: 200 });
  });

  it("parses embed with width-only dimension", () => {
    const result = parseWikiLinkReference("image.png|300", { embed: true });
    expect(result.embedSize).toEqual({ width: 300, height: undefined });
  });

  it("does not parse size for non-embed links", () => {
    const result = parseWikiLinkReference("note|300x200");
    expect(result.embedSize).toBeNull();
    expect(result.displayText).toBe("300x200");
  });
});

describe("splitObsidianImageAlt", () => {
  it("parses width-only size from markdown image alt", () => {
    expect(splitObsidianImageAlt("墨知正式版-1787670846943|300")).toEqual({
      label: "墨知正式版-1787670846943",
      width: 300,
      height: undefined,
    });
  });

  it("parses width and height from markdown image alt", () => {
    expect(splitObsidianImageAlt("cover|300x200")).toEqual({
      label: "cover",
      width: 300,
      height: 200,
    });
  });

  it("keeps alt unchanged when the pipe segment is not a size", () => {
    expect(splitObsidianImageAlt("foo|bar")).toEqual({
      label: "foo|bar",
    });
  });

  it("parses size-only alt", () => {
    expect(splitObsidianImageAlt("|240")).toEqual({
      label: "",
      width: 240,
      height: undefined,
    });
  });
});

describe("extractWikiNoteFragment", () => {
  const sampleContent = `---
title: Test
---

# Introduction

This is the intro.

## Details

Some details here.

## Summary

Final summary.`;

  it("extracts full body without subpath", () => {
    const result = extractWikiNoteFragment(sampleContent, "Test");
    expect(result.markdown).toContain("# Introduction");
    expect(result.markdown).toContain("## Summary");
  });

  it("extracts heading section", () => {
    const result = extractWikiNoteFragment(sampleContent, "Test#Details");
    expect(result.markdown).toContain("Details");
    expect(result.markdown).toContain("Some details here.");
    expect(result.markdown).not.toContain("Final summary");
  });

  it("returns null for non-existent heading", () => {
    const result = extractWikiNoteFragment(sampleContent, "Test#NonExistent");
    expect(result.markdown).toBeNull();
  });

  it("builds title from heading subpath", () => {
    const result = extractWikiNoteFragment(sampleContent, "Test#Details");
    expect(result.title).toBe("Details");
  });

  it("builds title from first heading when no path or subpath", () => {
    const content = `---
title: Test
---

# First Heading

Some content.`;
    const result = extractWikiNoteFragment(content, "#");
    expect(result.title).toBe("First Heading");
  });

  it("builds title from path when no subpath", () => {
    const content = `---
title: Test
---

Some content without heading.`;
    const result = extractWikiNoteFragment(content, "My Note.md");
    expect(result.title).toBe("My Note");
  });

  it("falls back to Embedded note when no heading, path, or subpath", () => {
    const content = `---
title: Test
---

Just some plain text.`;
    const result = extractWikiNoteFragment(content, "#");
    expect(result.title).toBe("Embedded note");
  });
});

describe("resolveWikiLinkFile", () => {
  const files: FileNode[] = [
    {
      id: "/root/notes/hello.md",
      name: "hello.md",
      path: "/root/notes/hello.md",
      type: "file",
    },
    {
      id: "/root/notes/world.md",
      name: "world.md",
      path: "/root/notes/world.md",
      type: "file",
    },
    {
      id: "/root/folder",
      name: "folder",
      path: "/root/folder",
      type: "folder",
      children: [
        {
          id: "/root/folder/deep.md",
          name: "deep.md",
          path: "/root/folder/deep.md",
          type: "file",
        },
      ],
    },
  ];

  it("resolves by basename", () => {
    const result = resolveWikiLinkFile(files, "hello", "/root");
    expect(result?.name).toBe("hello.md");
  });

  it("resolves by relative path", () => {
    const result = resolveWikiLinkFile(files, "notes/hello", "/root");
    expect(result?.name).toBe("hello.md");
  });

  it("resolves nested file by basename", () => {
    const result = resolveWikiLinkFile(files, "deep", "/root");
    expect(result?.name).toBe("deep.md");
  });

  it("resolves by relative path from current file", () => {
    const result = resolveWikiLinkFile(
      files,
      "world",
      "/root",
      "/root/notes/hello.md",
    );
    expect(result?.name).toBe("world.md");
  });

  it("handles rootPath with trailing slash", () => {
    const result = resolveWikiLinkFile(files, "hello", "/root/");
    expect(result?.name).toBe("hello.md");
  });

  it("handles path with backslashes", () => {
    const result = resolveWikiLinkFile(files, "hello", "\\root\\");
    expect(result?.name).toBe("hello.md");
  });

  it("returns null for non-existent file", () => {
    const result = resolveWikiLinkFile(files, "nonexistent", "/root");
    expect(result).toBeNull();
  });

  it("returns null for heading-only target with empty path", () => {
    const result = resolveWikiLinkFile(files, "#Section", "/root");
    expect(result).toBeNull();
  });

  it("handles currentFilePath outside rootFolderPath", () => {
    const result = resolveWikiLinkFile(
      files,
      "notes/hello",
      "/root",
      "/other/path/file.md",
    );
    expect(result?.name).toBe("hello.md");
  });

  it("strips .md extension from target", () => {
    const result = resolveWikiLinkFile(files, "hello.md", "/root");
    expect(result?.name).toBe("hello.md");
  });

  it("handles heading subpath in target", () => {
    const result = resolveWikiLinkFile(files, "hello#Section", "/root");
    expect(result?.name).toBe("hello.md");
  });

  it("resolves targets with literal spaces and percent-encoded spaces", () => {
    const spacedFiles: FileNode[] = [
      {
        id: "/vault/resources/05-模型广场模块 PRD-1.png",
        name: "05-模型广场模块 PRD-1.png",
        path: "/vault/resources/05-模型广场模块 PRD-1.png",
        type: "file",
      },
      {
        id: "/vault/docs/完整 PRD.md",
        name: "完整 PRD.md",
        path: "/vault/docs/完整 PRD.md",
        type: "file",
      },
    ];

    expect(
      resolveWikiLinkFile(
        spacedFiles,
        "resources/05-模型广场模块 PRD-1.png",
        "/vault",
      )?.path,
    ).toBe("/vault/resources/05-模型广场模块 PRD-1.png");

    expect(
      resolveWikiLinkFile(
        spacedFiles,
        "resources/05-模型广场模块%20PRD-1.png",
        "/vault",
      )?.path,
    ).toBe("/vault/resources/05-模型广场模块 PRD-1.png");

    expect(
      resolveWikiLinkFile(spacedFiles, "docs/完整%20PRD", "/vault")?.path,
    ).toBe("/vault/docs/完整 PRD.md");
  });

  it("returns null when basename matches multiple files", () => {
    const ambiguousFiles: FileNode[] = [
      {
        id: "/root/a/duplicate.md",
        name: "duplicate.md",
        path: "/root/a/duplicate.md",
        type: "file",
      },
      {
        id: "/root/b/duplicate.md",
        name: "duplicate.md",
        path: "/root/b/duplicate.md",
        type: "file",
      },
    ];
    const result = resolveWikiLinkFile(ambiguousFiles, "duplicate", "/root");
    expect(result).toBeNull();
  });

  it("returns null when path suffix matches multiple files", () => {
    const ambiguousFiles: FileNode[] = [
      {
        id: "/root/a/hello.md",
        name: "hello.md",
        path: "/root/a/hello.md",
        type: "file",
      },
      {
        id: "/root/b/hello.md",
        name: "hello.md",
        path: "/root/b/hello.md",
        type: "file",
      },
    ];
    const result = resolveWikiLinkFile(ambiguousFiles, "hello", "/root");
    expect(result).toBeNull();
  });
});

describe("extractWikiNoteFragment - block section", () => {
  const blockContent = `---
title: Test
---

# Introduction

This is the intro.

Some block content here.
^block-id-1

## Details

More details.
^block-id-2

Another paragraph.
^block-id-3

## Summary

Final summary.`;

  it("extracts block section by id", () => {
    const result = extractWikiNoteFragment(blockContent, "Test#^block-id-1");
    expect(result.markdown).toBe("Some block content here.");
    expect(result.title).toBe("block-id-1");
  });

  it("extracts block section when preceded by heading", () => {
    const result = extractWikiNoteFragment(blockContent, "Test#^block-id-2");
    expect(result.markdown).toBe("More details.");
    expect(result.title).toBe("block-id-2");
  });

  it("extracts block section with multiple lines", () => {
    const result = extractWikiNoteFragment(blockContent, "Test#^block-id-3");
    expect(result.markdown).toBe("Another paragraph.");
    expect(result.title).toBe("block-id-3");
  });

  it("returns null for non-existent block id", () => {
    const result = extractWikiNoteFragment(blockContent, "Test#^nonexistent");
    expect(result.markdown).toBeNull();
    expect(result.title).toBe("nonexistent");
  });

  it("extracts block at start of body (no preceding content)", () => {
    const content = `---
title: Test
---
^first-block

Some other text.`;
    const result = extractWikiNoteFragment(content, "Test#^first-block");
    expect(result.markdown).toBeNull();
    expect(result.title).toBe("first-block");
  });

  it("stops at empty line when scanning backwards for block start", () => {
    const content = `---
title: Test
---

Line one.
Line two.

^block-id

Next paragraph.`;
    const result = extractWikiNoteFragment(content, "Test#^block-id");
    expect(result.markdown).toBeNull();
    expect(result.title).toBe("block-id");
  });

  it("stops at heading when scanning backwards for block start", () => {
    const content = `---
title: Test
---

# Heading

Text under heading.
^block-id

Next paragraph.`;
    const result = extractWikiNoteFragment(content, "Test#^block-id");
    expect(result.markdown).toBe("Text under heading.");
    expect(result.title).toBe("block-id");
  });

  it("stops at heading when text is directly under heading with no blank line", () => {
    const content = `---
title: Test
---

# Heading
Text under heading.
^block-id

Next paragraph.`;
    const result = extractWikiNoteFragment(content, "Test#^block-id");
    expect(result.markdown).toBe("Text under heading.");
    expect(result.title).toBe("block-id");
  });

  it("handles block id with underscore and hyphen", () => {
    const content = `---
title: Test
---

Paragraph with id.
^block_id-2

Next paragraph.`;
    const result = extractWikiNoteFragment(content, "Test#^block_id-2");
    expect(result.markdown).toBe("Paragraph with id.");
    expect(result.title).toBe("block_id-2");
  });
});

describe("buildWikiReferenceTarget", () => {
  it("returns null for empty subpath", () => {
    const result = buildWikiReferenceTarget({ subpath: "", subpathType: null });
    expect(result).toBeNull();
  });

  it("returns null for whitespace-only subpath", () => {
    const result = buildWikiReferenceTarget({
      subpath: "   ",
      subpathType: "heading",
    });
    expect(result).toBeNull();
  });

  it("formats block subpath with caret prefix", () => {
    const result = buildWikiReferenceTarget({
      subpath: "^abc123",
      subpathType: "block",
    });
    expect(result).toBe("^abc123");
  });

  it("formats block subpath without caret prefix", () => {
    const result = buildWikiReferenceTarget({
      subpath: "abc123",
      subpathType: "block",
    });
    expect(result).toBe("^abc123");
  });

  it("trims block subpath", () => {
    const result = buildWikiReferenceTarget({
      subpath: "  abc123  ",
      subpathType: "block",
    });
    expect(result).toBe("^abc123");
  });

  it("returns heading subpath as-is", () => {
    const result = buildWikiReferenceTarget({
      subpath: "My Heading",
      subpathType: "heading",
    });
    expect(result).toBe("My Heading");
  });

  it("trims heading subpath", () => {
    const result = buildWikiReferenceTarget({
      subpath: "  My Heading  ",
      subpathType: "heading",
    });
    expect(result).toBe("My Heading");
  });
});
