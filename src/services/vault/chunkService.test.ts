import { describe, expect, it, vi } from "vitest";
import { chunkMarkdownFile, diffChunks, hashText } from "./chunkService";

describe("chunkService", () => {
  it("keeps multiline window line numbers and text unchanged for LF and CRLF", () => {
    for (const newline of ["\n", "\r\n"]) {
      const content = `line with enough plain content${newline}`
        .repeat(90)
        .trim();
      const chunks = chunkMarkdownFile({
        path: "/vault/plain.md",
        vaultRoot: "/vault",
        content,
      });
      const expected = [];
      for (let offset = 0; offset < content.length; offset += 620) {
        const end = Math.min(content.length, offset + 700);
        const text = content.slice(offset, end).trim();
        if (text.length >= 40) {
          const startLine = content.slice(0, offset).split(/\r?\n/).length;
          expected.push({
            text,
            startLine,
            endLine: startLine + text.split(/\r?\n/).length - 1,
          });
        }
        if (end === content.length) break;
      }
      expect(
        chunks.map(({ text, startLine, endLine }) => ({
          text,
          startLine,
          endLine,
        })),
      ).toEqual(expected);
    }
  });

  it("does not repeatedly split growing prefixes while indexing a large multiline note", () => {
    const content = "plain multiline paragraph\n".repeat(4000);
    const original = String.prototype.split;
    let scanned = 0;
    const split = vi
      .spyOn(String.prototype, "split")
      .mockImplementation(function (this: string, ...args: unknown[]) {
        scanned += String(this).length;
        return Reflect.apply(original, this, args) as string[];
      });
    let chunks;
    try {
      chunks = chunkMarkdownFile({
        path: "/vault/large.md",
        vaultRoot: "/vault",
        content,
      });
    } finally {
      split.mockRestore();
    }
    expect(chunks.length).toBeGreaterThan(100);
    expect(scanned).toBeLessThan(content.length * 12);
  });
  it("chunks by headings and keeps anchors", () => {
    const content = `---
title: Demo
---

# Intro

Intro paragraph with enough characters to keep.

## Details

Details paragraph with enough characters to keep as well.
`;
    const chunks = chunkMarkdownFile({
      path: "/vault/Demo.md",
      vaultRoot: "/vault",
      content,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.titlePath[0]).toBe("Demo");
    expect(chunks.some((chunk) => chunk.headingAnchor === "intro")).toBe(true);
    expect(chunks.every((chunk) => chunk.contentHash.length > 0)).toBe(true);
  });

  it("falls back to window chunks without headings", () => {
    const body = "字".repeat(1200);
    const chunks = chunkMarkdownFile({
      path: "/vault/plain.md",
      vaultRoot: "/vault",
      content: body,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.relPath).toBe("plain.md");
  });

  it("diffs chunks by content hash", () => {
    const a = chunkMarkdownFile({
      path: "/vault/a.md",
      vaultRoot: "/vault",
      content: "# A\n\nhello world content for chunking tests here.\n",
    });
    const b = chunkMarkdownFile({
      path: "/vault/a.md",
      vaultRoot: "/vault",
      content: "# A\n\nhello world content changed for chunking tests.\n",
    });
    const diff = diffChunks(a, b);
    expect(diff.upsert.length).toBeGreaterThan(0);
    expect(hashText("x")).not.toBe(hashText("y"));
  });
});
