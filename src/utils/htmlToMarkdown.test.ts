import { describe, expect, it } from "vitest";
import { convertHtmlToMarkdown } from "./htmlToMarkdown";

describe("convertHtmlToMarkdown", () => {
  it("converts basic HTML to Markdown", () => {
    expect(convertHtmlToMarkdown("<p>Hello <strong>world</strong></p>")).toBe(
      "Hello **world**",
    );
  });

  it("strips script tags before converting", () => {
    expect(
      convertHtmlToMarkdown(
        '<p>Safe</p><script>alert("x")</script><p>Text</p>',
      ),
    ).toContain("Safe");
    expect(
      convertHtmlToMarkdown(
        '<p>Safe</p><script>alert("x")</script><p>Text</p>',
      ),
    ).not.toContain("alert");
  });

  it("returns an empty string for blank input", () => {
    expect(convertHtmlToMarkdown("   ")).toBe("");
  });

  it("converts HTML tables to GFM pipe tables", () => {
    const markdown = convertHtmlToMarkdown(
      "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(markdown).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("uses the first Excel-like td row as the header", () => {
    const markdown = convertHtmlToMarkdown(
      "<table><tr><td>Name</td><td>Age</td></tr><tr><td>Ada</td><td>36</td></tr></table>",
    );
    expect(markdown).toBe("| Name | Age |\n| --- | --- |\n| Ada | 36 |");
  });

  it("escapes pipes inside cells", () => {
    const markdown = convertHtmlToMarkdown(
      "<table><tr><th>A</th><th>B</th></tr><tr><td>a|b</td><td>c</td></tr></table>",
    );
    expect(markdown).toBe("| A | B |\n| --- | --- |\n| a\\|b | c |");
  });

  it("converts Word StartFragment wrapped tables", () => {
    const markdown = convertHtmlToMarkdown(
      `<html><body><!--StartFragment--><table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table><!--EndFragment--></body></html>`,
    );
    expect(markdown).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("does not emit a nested table as a second GFM table", () => {
    const markdown = convertHtmlToMarkdown(
      "<table><tr><th>Outer</th></tr><tr><td>keep<table><tr><td>inner</td></tr></table></td></tr></table>",
    );
    expect(markdown).toContain("| Outer |");
    expect(markdown).not.toContain("| inner |");
  });
});
