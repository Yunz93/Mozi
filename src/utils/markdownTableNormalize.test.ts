import { describe, expect, it } from "vitest";
import { normalizeMarkdownTablesForRender } from "./markdownTableNormalize";

describe("normalizeMarkdownTablesForRender blank lines", () => {
  it("collapses a blank line next to a table separator", () => {
    const src = ["| a | b |", "", "| --- | --- |", "| 1 | 2 |"].join("\n");
    expect(normalizeMarkdownTablesForRender(src)).toBe(
      ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
    );
  });

  it("does not collapse blank lines between ordinary pipe-like paragraphs", () => {
    const src = ["绝对值 |x| 与 |y| 的和", "", "cat a | grep b | wc -l"].join(
      "\n",
    );
    expect(normalizeMarkdownTablesForRender(src)).toBe(src);
  });
});
