import { describe, expect, it } from "vitest";
import { filterPaletteCommands } from "./filterCommands";

const commands = [
  {
    id: "insertTable",
    title: "插入表格",
    group: "表格",
    keywords: "table gfm",
    run: () => undefined,
  },
  {
    id: "askVault",
    title: "问库",
    group: "发布",
    keywords: "ask vault",
    run: () => undefined,
  },
  {
    id: "publish",
    title: "发布",
    group: "发布",
    run: () => undefined,
  },
];

describe("filterPaletteCommands", () => {
  it("returns all commands for a blank query", () => {
    expect(filterPaletteCommands(commands, "  ")).toHaveLength(3);
  });

  it("prefers title prefix matches", () => {
    const matches = filterPaletteCommands(commands, "插入");
    expect(matches[0]?.id).toBe("insertTable");
  });

  it("matches keywords", () => {
    const matches = filterPaletteCommands(commands, "vault");
    expect(matches.map((item) => item.id)).toEqual(["askVault"]);
  });
});
