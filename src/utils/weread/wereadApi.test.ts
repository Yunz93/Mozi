import { describe, expect, it } from "vitest";
import {
  classifyWereadError,
  extractWereadApiMessage,
  extractWereadUpgradeMessage,
} from "./wereadErrors";
import { extractStoreSearchBooks } from "./wereadApi";
import { WEREAD_SKILL_VERSION } from "./wereadConstants";

describe("classifyWereadError", () => {
  it("maps a missing API key", () => {
    expect(classifyWereadError("WeRead API key is required.")).toBe("apiKey");
  });

  it("stops on skill upgrade_info", () => {
    expect(
      classifyWereadError("WeRead skill upgrade required: 请升级到 1.0.5"),
    ).toBe("upgrade");
    expect(
      extractWereadUpgradeMessage(
        "WeRead skill upgrade required: 请升级到 1.0.5",
      ),
    ).toBe("请升级到 1.0.5");
  });

  it("keeps the Chinese API errmsg", () => {
    expect(extractWereadApiMessage("WeRead API error -2012: 登录超时")).toBe(
      "登录超时",
    );
    expect(classifyWereadError("WeRead API error -2012: 登录超时")).toBe(
      "auth",
    );
  });
});

describe("extractStoreSearchBooks", () => {
  it("reads bookInfo from grouped store results", () => {
    const books = extractStoreSearchBooks({
      results: [
        {
          title: "电子书",
          scope: 17,
          books: [
            {
              bookInfo: {
                bookId: "3300029226",
                title: "三体",
                author: "刘慈欣",
                deepLink: "https://weread.qq.com/web/reader/abc",
              },
            },
          ],
        },
      ],
    });
    expect(books).toEqual([
      {
        bookId: "3300029226",
        title: "三体",
        author: "刘慈欣",
        cover: undefined,
        publisher: undefined,
        deepLink: "https://weread.qq.com/web/reader/abc",
      },
    ]);
  });
});

describe("WEREAD_SKILL_VERSION", () => {
  it("pins the official skill version", () => {
    expect(WEREAD_SKILL_VERSION).toBe("1.0.4");
  });
});
