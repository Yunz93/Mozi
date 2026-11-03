/** @vitest-environment happy-dom */

import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectParagraphMatches } from "./useSidebarSearch";

afterEach(() => vi.restoreAllMocks());

describe("sidebar keyword snippets", () => {
  it.each([
    ["？", "为什么？", "为什么？"],
    ["。", "完整段落。", "完整段落。"],
    ["ＡＩ", "全角ＡＩ内容", "全角ＡＩ内容"],
    ["「产品」", "讨论「产品」功能", "讨论「产品」功能"],
    [" 中文 ", "一段中文内容", "一段中文内容"],
    ["a  b", "a b 不匹配\na  b 保留连续空格", "a  b 保留连续空格"],
  ])(
    "matches literal query %j without losing its source offsets",
    (query, line, expected) => {
      const content = `前言\n  ${line}\n结尾`;
      // 同步死循环必须由 VM 中断，避免旧实现冻结整个测试进程。
      const snippets = runInNewContext(
        "collectParagraphMatches(content, query)",
        { collectParagraphMatches, content, query },
        { timeout: 100 },
      ) as ReturnType<typeof collectParagraphMatches>;

      expect(snippets).toHaveLength(1);
      expect(snippets[0].text).toBe(expected);
      expect(content.slice(snippets[0].start, snippets[0].end)).toBe(expected);
      expect(snippets[0].line).toBe(
        content.slice(0, snippets[0].start).split("\n").length,
      );
    },
  );

  it.each(["", " ", "\t\n　"])(
    "returns no snippets for empty query %j",
    (query) => {
      expect(
        runInNewContext(
          "collectParagraphMatches(content, query)",
          { collectParagraphMatches, content: "正文", query },
          { timeout: 100 },
        ),
      ).toEqual([]);
    },
  );

  it("stops after three distinct paragraphs and skips repeated hits on a long line", () => {
    const content = [
      "target ".repeat(10_000),
      "target second",
      "target third",
      "target fourth",
    ].join("\n");
    const indexOf = vi.spyOn(String.prototype, "indexOf");
    const snippets = collectParagraphMatches(content, "TARGET");
    const matchCalls = indexOf.mock.calls.filter(
      ([query]) => query === "target",
    );

    expect(snippets).toHaveLength(3);
    expect(snippets.map(({ line }) => line)).toEqual([1, 2, 3]);
    expect(matchCalls).toHaveLength(3);
  });
});
