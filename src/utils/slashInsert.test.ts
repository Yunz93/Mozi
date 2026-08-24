import { describe, expect, it } from "vitest";
import {
  buildFootnoteInsert,
  buildSlashInsertSnippet,
  nextFootnoteLabel,
  resolveSlashInsert,
} from "./slashInsert";

describe("resolveSlashInsert", () => {
  it("lists the core inserts on a bare slash", () => {
    const ids = resolveSlashInsert("").map((item) => item.id);
    expect(ids).toEqual([
      "table-picker",
      "callout-note",
      "todo",
      "mermaid-flowchart",
      "mermaid-sequence",
      "math-block",
      "code-fence",
      "wiki-embed",
      "footnote",
    ]);
  });

  it("inserts a sized table from 3x4 queries", () => {
    expect(resolveSlashInsert("3x4")).toEqual([
      {
        id: "table-sized",
        labelKey: "table_insertSized",
        tableSize: { visualRows: 3, cols: 4 },
      },
    ]);
    expect(resolveSlashInsert("表格 5×2")[0]?.id).toBe("table-sized");
  });

  it("filters commands by alias", () => {
    expect(resolveSlashInsert("说明").map((item) => item.id)).toEqual([
      "callout-note",
    ]);
    expect(resolveSlashInsert("警告").map((item) => item.id)).toEqual([]);
    expect(resolveSlashInsert("待办").map((item) => item.id)).toEqual(["todo"]);
    expect(resolveSlashInsert("流程").map((item) => item.id)).toEqual([
      "mermaid-flowchart",
    ]);
    expect(resolveSlashInsert("mermaid").map((item) => item.id)).toEqual([
      "mermaid-flowchart",
      "mermaid-sequence",
    ]);
    expect(resolveSlashInsert("heading")).toEqual([]);
  });
});

describe("buildSlashInsertSnippet", () => {
  it("builds a note callout with the body selected", () => {
    const snippet = buildSlashInsertSnippet("callout-note", "zh-CN");
    expect(snippet.text).toBe("> [!note] 说明\n> 内容");
    expect(
      snippet.text.slice(snippet.cursor, snippet.cursor + snippet.select),
    ).toBe("内容");
  });

  it("builds a task item with the body selected", () => {
    const snippet = buildSlashInsertSnippet("todo", "zh-CN");
    expect(snippet.text).toBe("- [ ] 内容");
    expect(
      snippet.text.slice(snippet.cursor, snippet.cursor + snippet.select),
    ).toBe("内容");
  });

  it("builds mermaid, math, code, and wiki templates", () => {
    const flow = buildSlashInsertSnippet("mermaid-flowchart", "zh-CN");
    expect(flow.text).toContain("```mermaid");
    expect(flow.text).toContain("flowchart LR");
    expect(flow.text.slice(flow.cursor, flow.cursor + flow.select)).toBe(
      "步骤",
    );

    const math = buildSlashInsertSnippet("math-block", "zh-CN");
    expect(math.text).toBe("$$\n\n$$");
    expect(math.cursor).toBe(3);

    const code = buildSlashInsertSnippet("code-fence", "zh-CN");
    expect(code.text).toBe("```\n\n```");

    const embed = buildSlashInsertSnippet("wiki-embed", "zh-CN");
    expect(embed.text).toBe("![[]]");
    expect(embed.cursor).toBe(3);
  });
});

describe("footnotes", () => {
  it("increments numeric footnote labels", () => {
    expect(nextFootnoteLabel("Hello[^1] and [^3].")).toBe("4");
    expect(nextFootnoteLabel("no notes")).toBe("1");
  });

  it("replaces the slash query and appends a definition", () => {
    const insert = buildFootnoteInsert("/脚注", 0, 3);
    expect(insert.ref).toBe("[^1]");
    expect(insert.definition).toBe("\n\n[^1]: ");
    expect(insert.definitionInsertFrom).toBe(3);
  });
});
