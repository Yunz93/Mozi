import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("usePreviewRenderer wiki embed sizing", () => {
  it("stores bare numbers in data-wiki-embed-w/h for typed CSS attr(... px)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../preview/previewMedia.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /setAttribute\(["']data-wiki-embed-w["'],\s*String\(width\)\)/,
    );
    expect(source).toMatch(
      /setAttribute\(["']data-wiki-embed-h["'],\s*String\(height\)\)/,
    );
    expect(source).not.toMatch(
      /setAttribute\(['"]data-wiki-embed-w['"],\s*`\$\{width\}px`\)/,
    );
    expect(source).not.toMatch(
      /setAttribute\(['"]data-wiki-embed-h['"],\s*`\$\{height\}px`\)/,
    );
  });
});
