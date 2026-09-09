/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";
import {
  buildWereadMarkdown,
  extractWereadUserAppendix,
  mergeWereadMarkdown,
  readWereadBookId,
} from "./wereadMarkdown";
import {
  WEREAD_GENERATED_END_MARKER,
  WEREAD_USER_APPENDIX_MARKER,
} from "./wereadConstants";
import type { WereadMarkdownInput } from "./wereadMarkdown";

function sampleInput(
  overrides: Partial<WereadMarkdownInput> = {},
): WereadMarkdownInput {
  return {
    bookId: "123456",
    book: {
      bookId: "123456",
      title: "三体",
      author: "刘慈欣",
      publisher: "重庆出版社",
      deepLink: "https://weread.qq.com/web/reader/abc",
    },
    bookmarks: {
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
    },
    reviews: {
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
        {
          review: {
            reviewId: "rv-book",
            content: "整本书的读后感",
            star: 5,
          },
        },
      ],
    },
    importedAt: "2026-09-08",
    ...overrides,
  };
}

describe("buildWereadMarkdown", () => {
  it("groups highlights and linked thoughts by chapter", () => {
    const markdown = buildWereadMarkdown(sampleInput());
    expect(markdown).toContain('weread_book_id: "123456"');
    expect(markdown).toContain("source: weread");
    expect(markdown).toContain("tags:");
    expect(markdown).toContain("- 读书");
    expect(markdown).toContain("# 三体");
    expect(markdown).toContain("刘慈欣 · 重庆出版社");
    expect(markdown).toContain(
      "[在微信读书打开](https://weread.qq.com/web/reader/abc)",
    );
    expect(markdown).toContain("## 书评");
    expect(markdown).toContain("整本书的读后感");
    expect(markdown).toContain("## 第一章");
    expect(markdown).toContain("<!-- weread:bookmark:bm-1 -->");
    expect(markdown).toContain("> [!quote] 书摘");
    expect(markdown).toContain("……==给岁月以文明==……");
    expect(markdown).not.toContain("> 给岁月以文明");
    expect(markdown).toContain("<!-- weread:review:rv-1 -->");
    expect(markdown).toContain("> 这句太好了");
    expect(markdown).toContain(WEREAD_GENERATED_END_MARKER);
    expect(markdown).not.toContain("weread://");
  });

  it("renders excerpts and thoughts without bookmark tags in Reading HTML", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        bookmarks: {
          chapters: [{ chapterUid: 1, chapterIdx: 1, title: "第一章" }],
          updated: [
            {
              bookmarkId: "bm-1",
              chapterUid: 1,
              markText: "给岁月以文明",
              context: "我们要给岁月以文明，而不是给文明以岁月。",
              range: "10-20",
              type: 1,
            },
          ],
        },
      }),
    );
    const html = renderMarkdown(markdown);
    const preview = document.createElement("div");
    preview.innerHTML = html;
    expect(preview.textContent).not.toContain("weread:bookmark");
    expect(preview.textContent).not.toContain("weread:review");
    expect(html).toContain("mp-callout-quote");
    expect(html).toContain("书摘");
    expect(html).toContain("markdown-highlight");
    expect(preview.textContent).toContain("给岁月以文明");
    expect(preview.textContent).toContain("这句太好了");
  });

  it("highlights the mark inside surrounding paragraph context", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        bookmarks: {
          chapters: [{ chapterUid: 1, chapterIdx: 1, title: "第一章" }],
          updated: [
            {
              bookmarkId: "bm-1",
              chapterUid: 1,
              markText: "给岁月以文明",
              context: "我们要给岁月以文明，而不是给文明以岁月。",
              range: "10-20",
              type: 1,
            },
          ],
        },
      }),
    );
    expect(markdown).toContain("我们要==给岁月以文明==，而不是给文明以岁月。");
    expect(markdown).toContain("> [!quote] 书摘");
    expect(markdown).toContain("> 这句太好了");
  });

  it("uses a longer linked-thought abstract as paragraph context", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        bookmarks: {
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
        },
        reviews: {
          reviews: [
            {
              review: {
                reviewId: "rv-1",
                content: "这句太好了",
                abstract: "我们要给岁月以文明，而不是给文明以岁月。",
                range: "10-20",
                chapterUid: 1,
              },
            },
          ],
        },
      }),
    );
    expect(markdown).toContain("我们要==给岁月以文明==，而不是给文明以岁月。");
    expect(markdown).toContain("> 这句太好了");
  });

  it("does not invent a deep link when the API omitted one", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        book: { title: "三体", author: "刘慈欣" },
      }),
    );
    expect(markdown).not.toContain("weread://");
    expect(markdown).not.toContain("在微信读书打开");
  });

  it("labels popular highlights as other readers' marks", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        hotHighlights: {
          items: [
            {
              bookmarkId: "hot-1",
              markText: "毁灭人类",
              totalCount: 128,
              chapterUid: 1,
            },
          ],
          chapters: [{ chapterUid: 1, chapterIdx: 1, title: "第一章" }],
        },
      }),
    );
    expect(markdown).toContain("## 热门划线");
    expect(markdown).toContain("不是你的个人笔记");
    expect(markdown).toContain("128 人划线");
    expect(markdown).toContain("<!-- weread:hot:hot-1 -->");
  });

  it("omits a remote cover when no local path is provided", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        book: {
          title: "三体",
          cover: "https://cdn.weread.qq.com/cover.jpg",
        },
      }),
    );
    expect(markdown).not.toContain("https://cdn.weread.qq.com/cover.jpg");
  });
});

describe("mergeWereadMarkdown", () => {
  it("keeps user appendix and refreshes generated ids", () => {
    const first = buildWereadMarkdown(sampleInput());
    const withNotes = `${first}\n${WEREAD_USER_APPENDIX_MARKER}\n\n我自己补的笔记\n`;
    const merged = mergeWereadMarkdown(
      withNotes,
      sampleInput({
        bookmarks: {
          chapters: [{ chapterUid: 1, chapterIdx: 1, title: "第一章" }],
          updated: [
            {
              bookmarkId: "bm-1",
              chapterUid: 1,
              markText: "给岁月以文明",
              range: "10-20",
              type: 1,
            },
            {
              bookmarkId: "bm-2",
              chapterUid: 1,
              markText: "新划线",
              range: "30-40",
              type: 1,
            },
          ],
        },
      }),
    );
    expect(merged).toContain("<!-- weread:bookmark:bm-2 -->");
    expect(merged).toContain("新划线");
    expect(merged).toContain(WEREAD_USER_APPENDIX_MARKER);
    expect(merged).toContain("我自己补的笔记");
    expect(readWereadBookId(merged)).toBe("123456");
  });

  it("treats body after generated-end as appendix when the marker is missing", () => {
    const generated = buildWereadMarkdown(sampleInput());
    const withoutAppendixMarker = generated.replace(
      WEREAD_GENERATED_END_MARKER,
      WEREAD_GENERATED_END_MARKER,
    );
    const existing = `${withoutAppendixMarker}\n\n手写附录\n`;
    expect(extractWereadUserAppendix(existing)).toContain("手写附录");
  });
});
