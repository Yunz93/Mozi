import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
function siblingRelations(css: string) {
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    if (
      rule.selector.includes(".preview-pane-document") &&
      /:has\(\s*\+/.test(rule.selector)
    )
      found.push(rule.selector);
  });
  return found;
}
describe("preview scroll style cost", () => {
  it("does not use sibling :has selectors on the large preview subtree", () => {
    expect(
      siblingRelations(
        ".preview-pane-document > :has(+ .preview-source-blank-line) { margin: 0; }",
      ),
    ).toHaveLength(1);
    const css = readFileSync(resolve(__dirname, "preview.css"), "utf8");
    expect(css).toContain(".preview-pane-document");
    expect(siblingRelations(css)).toEqual([]);
  });
});
