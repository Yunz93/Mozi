/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import {
  normalizeAskVaultCitationMarkers,
  protectAskVaultCitations,
  renderAskVaultAnswerHtml,
  restoreAskVaultCitations,
} from "./askVaultAnswerCitations";

describe("askVaultAnswerCitations", () => {
  it("normalizes wiki-like numeric citations to [n]", () => {
    expect(normalizeAskVaultCitationMarkers("见[[4]]与[[[7]]]")).toBe(
      "见[4]与[7]",
    );
  });

  it("keeps full [n] brackets for consecutive citations in HTML", () => {
    const html = renderAskVaultAnswerHtml(
      "已注册[4][7]。可用[1][4]，OSAgent[3]。",
      (md) => renderMarkdown(md, { themeMode: "light" }),
    );
    expect(html).toContain('data-ask-cite="4"');
    expect(html).toContain('data-ask-cite="7"');
    expect(html).toContain(">[4]<");
    expect(html).toContain(">[7]<");
    expect(html).toContain(">[1]<");
    expect(html).toContain(">[3]<");
    expect(html).not.toContain("markdown-wikilink");
  });

  it("does not let wiki parsing strip brackets from [[n]]", () => {
    const html = renderAskVaultAnswerHtml("见[[4]][[7]]。", (md) =>
      renderMarkdown(md, { themeMode: "light" }),
    );
    expect(html).toContain(">[4]<");
    expect(html).toContain(">[7]<");
    expect(html).not.toMatch(/data-wikilink="4"/);
  });

  it("does not let [[[n]]] render as half-bracket wikilinks", () => {
    const html = renderAskVaultAnswerHtml("见[[[4]]][[[7]]]。", (md) =>
      renderMarkdown(md, { themeMode: "light" }),
    );
    expect(html).toContain(">[4]<");
    expect(html).toContain(">[7]<");
    expect(html).not.toContain("data-wikilink");
  });

  it("survives markdown reference definitions that would eat [n][m]", () => {
    const md =
      "注册[4][7]后可用[1][4]，OSAgent[3]。\n\n[1]: s1\n[3]: s3\n[4]: s4\n[7]: s7";
    const html = renderAskVaultAnswerHtml(md, (text) =>
      renderMarkdown(text, { themeMode: "light" }),
    );
    expect(html).toContain(">[4]<");
    expect(html).toContain(">[7]<");
    expect(html).toContain(">[1]<");
    expect(html).toContain(">[3]<");
    // Should not collapse [4][7] into a single <a>4</a>
    expect(html).not.toMatch(/<a href="s7">4<\/a>/);
  });

  it("leaves [n] inside fenced code alone", () => {
    const protectedText = protectAskVaultCitations(
      "正文[1]\n\n```\ncode[2]\n```\n后[3]",
    );
    expect(protectedText).toContain("code[2]");
    expect(protectedText).not.toMatch(/code\uE0002\uE001/);
    expect(restoreAskVaultCitations(protectedText)).toContain(
      'data-ask-cite="1"',
    );
    expect(restoreAskVaultCitations(protectedText)).toContain(
      'data-ask-cite="3"',
    );
  });
});
