import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  classifyWereadError,
  extractWereadApiMessage,
  extractWereadUpgradeMessage,
} from "./wereadErrors";
import {
  clearWereadNotebookCache,
  extractStoreSearchBooks,
  fetchAllNotebooksCached,
  updateWereadSkill,
} from "./wereadApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../types/filesystem", () => ({ isTauriEnvironment: () => true }));

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

describe("updateWereadSkill", () => {
  it("updates through the native backend without sending an API key", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1.0.5");
    await expect(updateWereadSkill()).resolves.toBe("1.0.5");
    expect(invoke).toHaveBeenCalledWith("weread_update_skill");
  });
});

describe("WeRead notebook account cache", () => {
  beforeEach(() => {
    clearWereadNotebookCache();
    vi.mocked(invoke).mockReset();
  });

  const page = (bookId: string) => ({
    books: [{ bookId, book: { title: bookId } }],
    hasMore: 0,
  });

  it("reuses results only for the same account", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(page("A"))
      .mockResolvedValueOnce(page("B"));
    expect((await fetchAllNotebooksCached(false, "account-a"))[0].bookId).toBe(
      "A",
    );
    expect((await fetchAllNotebooksCached(false, "account-a"))[0].bookId).toBe(
      "A",
    );
    expect((await fetchAllNotebooksCached(false, "account-b"))[0].bookId).toBe(
      "B",
    );
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not let an old account request replace the new account cache", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const oldRequest = fetchAllNotebooksCached(false, "account-a");
    vi.mocked(invoke).mockResolvedValueOnce(page("B"));
    await fetchAllNotebooksCached(false, "account-b");
    finish(page("A"));
    await oldRequest;
    expect((await fetchAllNotebooksCached(false, "account-b"))[0].bookId).toBe(
      "B",
    );
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not refill a cleared cache from an older request", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = fetchAllNotebooksCached(false, "account-a");
    clearWereadNotebookCache();
    finish(page("OLD"));
    await pending;
    vi.mocked(invoke).mockResolvedValueOnce(page("NEW"));
    expect((await fetchAllNotebooksCached(false, "account-a"))[0].bookId).toBe(
      "NEW",
    );
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
