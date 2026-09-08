import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode } from "../../types";
import { defaultSettings } from "../../store/uiStore";
import { WEREAD_USER_APPENDIX_MARKER } from "./wereadConstants";
import {
  findExistingWereadNote,
  importWereadBook,
  type WereadImportRequest,
} from "./wereadImport";

const notifyVaultFileSaved = vi.fn();
const fetchBookmarkList = vi.fn();
const fetchMyReviews = vi.fn();
const fetchBookInfo = vi.fn();
const fetchBestBookmarks = vi.fn();
const downloadWereadCover = vi.fn();

vi.mock("../../services/vault/linkIndexEvents", () => ({
  notifyVaultFileSaved: (...args: unknown[]) => notifyVaultFileSaved(...args),
}));

vi.mock("./wereadApi", () => ({
  fetchBookmarkList: (...args: unknown[]) => fetchBookmarkList(...args),
  fetchMyReviews: (...args: unknown[]) => fetchMyReviews(...args),
  fetchBookInfo: (...args: unknown[]) => fetchBookInfo(...args),
  fetchBestBookmarks: (...args: unknown[]) => fetchBestBookmarks(...args),
  downloadWereadCover: (...args: unknown[]) => downloadWereadCover(...args),
}));

vi.mock("../../types/filesystem", () => ({
  getFileSystem: async () => ({
    createDirectory: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  }),
}));

const EXISTING_NOTE = `---
title: 三体
source: weread
weread_book_id: "123456"
custom: keep-me
---

# 三体

<!-- weread:bookmark:bm-old -->

> 旧划线

<!-- weread:generated-end -->
${WEREAD_USER_APPENDIX_MARKER}

我自己补的笔记
`;

function notebook() {
  return {
    bookId: "123456",
    book: {
      bookId: "123456",
      title: "三体",
      author: "刘慈欣",
      publishTime: "2008-01-01",
    },
  };
}

function files(): FileNode[] {
  return [
    {
      id: "/vault/读书/三体.md",
      name: "三体.md",
      type: "file",
      path: "/vault/读书/三体.md",
    },
  ];
}

function request(
  overrides: Partial<WereadImportRequest> = {},
): WereadImportRequest {
  return {
    notebooks: [notebook()],
    conflictMode: "merge",
    saveCover: false,
    includeHotHighlights: false,
    settings: defaultSettings,
    rootFolderPath: "/vault",
    files: files(),
    language: "zh-CN",
    readFile: async (path: string) => {
      if (path === "/vault/读书/三体.md") return EXISTING_NOTE;
      throw new Error(`missing ${path}`);
    },
    writeFile: vi.fn(async (_path: string, _content: string) => undefined),
    createFile: vi.fn(
      async (
        _fileName: string,
        _content: string,
        _folderPath?: string,
      ): Promise<FileNode | null> => ({
        id: "/vault/读书/三体.md",
        name: "三体.md",
        type: "file",
        path: "/vault/读书/三体.md",
      }),
    ),
    now: new Date("2026-09-08T00:00:00.000Z"),
    ...overrides,
  };
}

describe("findExistingWereadNote", () => {
  it("matches weread_book_id even when the filename changed", async () => {
    const found = await findExistingWereadNote({
      bookId: "123456",
      title: "三体",
      preferredPath: "/vault/读书/三体.md",
      files: [
        {
          id: "/vault/读书/旧名.md",
          name: "旧名.md",
          type: "file",
          path: "/vault/读书/旧名.md",
        },
      ],
      readFile: async (path: string) => {
        if (path !== "/vault/读书/旧名.md") {
          throw new Error("missing");
        }
        return `---
title: 三体
source: weread
weread_book_id: "123456"
---

正文
`;
      },
    });
    expect(found?.path).toBe("/vault/读书/旧名.md");
  });
});

describe("importWereadBook", () => {
  beforeEach(() => {
    notifyVaultFileSaved.mockReset();
    fetchBookmarkList.mockReset();
    fetchMyReviews.mockReset();
    fetchBookInfo.mockReset();
    fetchBestBookmarks.mockReset();
    downloadWereadCover.mockReset();
    fetchBookmarkList.mockResolvedValue({
      chapters: [{ chapterUid: 1, chapterIdx: 1, title: "第一章" }],
      updated: [
        {
          bookmarkId: "bm-1",
          chapterUid: 1,
          markText: "给岁月以文明",
          range: "10-20",
          type: 1,
        },
      ],
    });
    fetchMyReviews.mockResolvedValue({
      reviews: [
        {
          review: {
            reviewId: "rv-1",
            content: "这句太好了",
            abstract: "给岁月以文明",
            range: "10-20",
            chapterUid: 1,
          },
        },
      ],
    });
    fetchBookInfo.mockResolvedValue({
      bookId: "123456",
      title: "三体",
      author: "刘慈欣",
      deepLink: "https://weread.qq.com/web/reader/abc",
    });
    fetchBestBookmarks.mockResolvedValue({ items: [] });
  });

  it("skips an existing weread_book_id without calling the book APIs", async () => {
    const result = await importWereadBook(
      notebook(),
      request({ conflictMode: "skip" }),
    );
    expect(result).toMatchObject({
      status: "skipped",
      path: "/vault/读书/三体.md",
    });
    expect(fetchBookmarkList).not.toHaveBeenCalled();
    expect(notifyVaultFileSaved).not.toHaveBeenCalled();
  });

  it("merges new bookmark ids and keeps the user appendix", async () => {
    const writeFile = vi.fn(
      async (_path: string, _content: string) => undefined,
    );
    const result = await importWereadBook(
      notebook(),
      request({ conflictMode: "merge", writeFile }),
    );
    expect(result.status).toBe("merged");
    expect(writeFile).toHaveBeenCalledOnce();
    const content = String(writeFile.mock.calls[0]?.[1] ?? "");
    expect(content).toContain("<!-- weread:bookmark:bm-1 -->");
    expect(content).toContain("给岁月以文明");
    expect(content).toContain("<!-- weread:review:rv-1 -->");
    expect(content).not.toContain("<!-- weread:bookmark:bm-old -->");
    expect(content).toContain(WEREAD_USER_APPENDIX_MARKER);
    expect(content).toContain("我自己补的笔记");
    expect(content).toContain("custom: keep-me");
    expect(notifyVaultFileSaved).toHaveBeenCalledWith(
      "/vault/读书/三体.md",
      content,
    );
  });

  it("overwrites the whole note and drops the appendix", async () => {
    const writeFile = vi.fn(
      async (_path: string, _content: string) => undefined,
    );
    const result = await importWereadBook(
      notebook(),
      request({ conflictMode: "overwrite", writeFile }),
    );
    expect(result.status).toBe("overwritten");
    const content = String(writeFile.mock.calls[0]?.[1] ?? "");
    expect(content).toContain("<!-- weread:bookmark:bm-1 -->");
    expect(content).not.toContain("我自己补的笔记");
    expect(content).not.toContain(WEREAD_USER_APPENDIX_MARKER);
  });

  it("creates one markdown file and reports the written path", async () => {
    const createFile = vi.fn(
      async (
        _fileName: string,
        _content: string,
        _folderPath?: string,
      ): Promise<FileNode | null> => ({
        id: "/vault/读书/三体.md",
        name: "三体.md",
        type: "file",
        path: "/vault/读书/三体.md",
      }),
    );
    const result = await importWereadBook(
      notebook(),
      request({
        conflictMode: "merge",
        files: [],
        createFile,
        readFile: async () => {
          throw new Error("missing");
        },
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({
      status: "created",
      path: "/vault/读书/三体.md",
    });
    expect(createFile).toHaveBeenCalledOnce();
    const createdContent = String(createFile.mock.calls[0]?.[1] ?? "");
    expect(createdContent).toContain('weread_book_id: "123456"');
    expect(notifyVaultFileSaved).toHaveBeenCalledWith(
      "/vault/读书/三体.md",
      createdContent,
    );
  });
});
