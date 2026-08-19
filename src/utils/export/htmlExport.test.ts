/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { exportToHtml } from "./htmlExport";

describe("exportToHtml", () => {
  it("forwards orderedListMode to markdown rendering", async () => {
    const md = "1. first\n   indent\n3. third";
    const looseHtml = await exportToHtml(md, {
      theme: "light",
      includeProperties: false,
      orderedListMode: "loose",
    });
    const strictHtml = await exportToHtml(md, {
      theme: "light",
      includeProperties: false,
      orderedListMode: "strict",
    });

    expect(looseHtml).toMatch(/<li[^>]*value="3"/);
    expect(strictHtml).not.toMatch(/value="3"/);
  });

  it("uses zh-CN as the default document language", async () => {
    const html = await exportToHtml("# hi", {
      theme: "light",
      includeProperties: false,
    });
    expect(html).toContain('lang="zh-CN"');
  });

  it("honors English document language", async () => {
    const html = await exportToHtml("# hi", {
      theme: "light",
      includeProperties: false,
      language: "en",
    });
    expect(html).toContain('lang="en"');
  });

  it("exports Obsidian callouts with the same markup as preview", async () => {
    const html = await exportToHtml("> [!note] Hint\n> body", {
      theme: "light",
      includeProperties: false,
    });
    expect(html).toContain("mp-callout");
    expect(html).toContain("mp-callout-note");
    expect(html).toContain("mp-callout-title");
    expect(html).toContain(".mp-callout-title");
  });

  it("marks the export article as a preview document so reading-mode CSS applies", async () => {
    const html = await exportToHtml("# hi", {
      theme: "light",
      includeProperties: false,
    });
    expect(html).toContain('class="markdown-body preview-pane-document"');
  });
});
