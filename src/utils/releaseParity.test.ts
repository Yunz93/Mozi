/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShikiHighlighter } from "../hooks/useShikiHighlighter";
import { shouldUseAsyncPreviewEnhancement } from "../components/editor/preview/previewRenderCore";
import { clearMarkdownCache, renderMarkdown } from "./markdown";

const fixturePath = resolve(
  import.meta.dirname,
  "__fixtures__/release-parity-markdown.md",
);

function createMockHighlighter() {
  const codeToHtml = vi.fn(
    (code: string) =>
      `<pre class="shiki markdown-press-light"><code><span>${code}</span></code></pre>`,
  );
  const highlighter: ShikiHighlighter = {
    codeToHtml,
    getLoadedLanguages: () => ["typescript"],
    supportsLanguage: () => true,
  };
  return { codeToHtml, highlighter };
}

describe("release parity fixture", () => {
  beforeEach(() => {
    clearMarkdownCache();
    (globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ = true;
  });

  it("renders release-critical preview invariants from the fixture markdown", () => {
    const markdown = readFileSync(fixturePath, "utf8");
    const { highlighter } = createMockHighlighter();
    const html = renderMarkdown(markdown, { highlighter });

    expect(html).toContain('class="shiki');
    expect(html).toContain("const answer = 42;");

    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD");

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');

    expect(html).toContain("data-wikilink");
    expect(html).toContain("markdown-wikilink");
    expect(html).toContain("Other Note");

    expect(html).toContain('data-wiki-embed="true"');
    expect(html).toContain('data-wiki-width="320"');
    expect(html).toContain('data-wiki-width="480"');
    expect(html).toContain('data-wiki-height="640"');
    expect(html).toContain("report.pdf");

    expect(html).toContain("attachments/archive.zip");
    expect(shouldUseAsyncPreviewEnhancement(html, true)).toBe(true);
  });

  it("pins the same Node major for CI and release builds", () => {
    const versions = ["ci.yml", "release.yml"].flatMap((name) => {
      const workflow = readFileSync(
        resolve(import.meta.dirname, "../../.github/workflows", name),
        "utf8",
      );
      const matches = [
        ...workflow.matchAll(/node-version:\s*["']?([^\s"']+)/g),
      ];
      expect(matches.length).toBeGreaterThan(0);
      return matches.map((match) => match[1]);
    });
    expect(versions.every((version) => /^\d+$/.test(version))).toBe(true);
    expect(new Set(versions).size).toBe(1);
  });
});
