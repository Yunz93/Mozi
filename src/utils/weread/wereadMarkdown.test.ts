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
    expect(markdown).toContain("> 书评");
    expect(markdown).toContain("整本书的读后感");
    expect(markdown).toContain("## 第一章");
    expect(markdown).toContain("<!-- weread:bookmark:bm-1 -->");
    expect(markdown).toContain("<!-- weread:review:rv-1 -->");
    expect(markdown).toContain("> 书评");
    expect(markdown).toContain("==给岁月以文明==");
    expect(markdown).toContain("> 这句太好了");
    expect(markdown).not.toContain("……==给岁月以文明==……");
    expect(markdown).not.toContain("> [!quote] 书摘");
    expect(markdown).not.toContain("> 给岁月以文明");
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
    expect(html).not.toContain("mp-callout-comment");
    expect(preview.textContent).toContain("书评");
    expect(html).not.toContain("mp-callout-quote");
    expect(html).not.toContain("书摘");
    expect(html).toContain("markdown-highlight");
    expect(preview.textContent).toContain(
      "我们要给岁月以文明，而不是给文明以岁月。",
    );
    expect(preview.textContent).toContain("这句太好了");
    const thoughts = [...preview.querySelectorAll("blockquote")];
    const thought = thoughts.find((node) =>
      (node.textContent ?? "").includes("这句太好了"),
    );
    expect(thought?.textContent).not.toContain("给岁月以文明");
    expect(thought?.textContent).toContain("书评");
    expect(thought?.textContent).toContain("这句太好了");
  });

  it("does not invent excerpt context when the API only returned the mark", () => {
    const markdown = buildWereadMarkdown(sampleInput());
    const html = renderMarkdown(markdown);
    const preview = document.createElement("div");
    preview.innerHTML = html;
    expect(markdown).toContain("==给岁月以文明==");
    expect(markdown).toContain("> 这句太好了");
    expect(markdown).not.toContain("……");
    expect(html).not.toContain("mp-callout-quote");
    expect(html).not.toContain("mp-callout-comment");
    expect(preview.textContent).toContain("书评");
    expect(preview.textContent).not.toContain("书摘");
    expect(html).toContain("markdown-highlight");
    const thoughts = [...preview.querySelectorAll("blockquote")];
    const thought = thoughts.find((node) =>
      (node.textContent ?? "").includes("这句太好了"),
    );
    expect(thought?.textContent).not.toContain("给岁月以文明");
    expect(thought?.textContent).toContain("书评");
    expect(thought?.textContent).toContain("这句太好了");
  });

  it("keeps a highlight-only note as a mark without a thought card", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        reviews: { reviews: [] },
      }),
    );
    expect(markdown).toContain("==给岁月以文明==");
    expect(markdown).not.toContain("> 书评");
    expect(markdown).not.toContain("> [!quote] 书摘");
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
    expect(markdown).toContain("> 书评");
    expect(markdown).toContain("> 这句太好了");
    expect(markdown).not.toContain("> [!quote] 书摘");
  });

  it("uses context returned with the linked review when the bookmark has none", () => {
    const input = sampleInput();
    input.reviews.reviews![0].review!.context =
      "我们要给岁月以文明，而不是给文明以岁月。";
    expect(buildWereadMarkdown(input)).toContain(
      "我们要==给岁月以文明==，而不是给文明以岁月。\n\n> 书评\n>\n> 这句太好了",
    );
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
    expect(markdown).toContain("> 书评");
    expect(markdown).toContain("> 这句太好了");
    expect(markdown).not.toContain("> [!quote] 书摘");
  });

  it("keeps paragraph context outside review blockquotes when there is no review", () => {
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
        reviews: { reviews: [] },
      }),
    );
    expect(markdown).not.toContain("> [!quote] 书摘");
    expect(markdown).toContain("我们要==给岁月以文明==，而不是给文明以岁月。");
    expect(markdown).not.toContain("> 书评");
  });

  it("links repeated excerpts to reviews by their actual range", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        bookmarks: {
          chapters: [{ chapterUid: 1, title: "第一章" }],
          updated: [
            {
              bookmarkId: "early",
              chapterUid: 1,
              markText: "重复句子",
              range: "10-14",
              type: 1,
            },
            {
              bookmarkId: "later",
              chapterUid: 1,
              markText: "重复句子",
              context: "另一个段落中出现重复句子。",
              range: "30-34",
              type: 1,
            },
          ],
        },
        reviews: {
          reviews: [
            {
              review: {
                reviewId: "later-review",
                chapterUid: 1,
                abstract: "重复句子",
                range: "30-34",
                content: "只评论后一处",
              },
            },
          ],
        },
      }),
    );
    const early = markdown.slice(
      markdown.indexOf("<!-- weread:bookmark:early -->"),
      markdown.indexOf("<!-- weread:bookmark:later -->"),
    );
    expect(early).toContain("==重复句子==");
    expect(early).not.toContain("只评论后一处");
    expect(
      markdown.slice(markdown.indexOf("<!-- weread:bookmark:later -->")),
    ).toContain("另一个段落中出现==重复句子==。");
    expect(
      markdown.slice(markdown.indexOf("<!-- weread:bookmark:later -->")),
    ).toContain("> 书评\n>\n> 只评论后一处");
  });

  it("keeps several reviews next to their excerpt and quotes every review line", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        reviews: {
          reviews: [
            {
              review: {
                reviewId: "first",
                chapterUid: 1,
                range: "10-20",
                content: "第一条\n\n继续评论",
              },
            },
            {
              review: {
                reviewId: "second",
                chapterUid: 1,
                range: "10-20",
                content: "第二条",
              },
            },
          ],
        },
      }),
    );
    expect(markdown).toContain(
      "==给岁月以文明==\n\n> 书评\n>\n> 第一条\n>\n> 继续评论\n\n> 书评\n>\n> 第二条",
    );
    const html = document.createElement("div");
    html.innerHTML = renderMarkdown(markdown);
    expect(
      [...html.querySelectorAll("blockquote")].map((node) => node.textContent),
    ).toEqual([
      expect.stringContaining("第一条"),
      expect.stringContaining("第二条"),
    ]);
    expect(html.querySelectorAll(".markdown-highlight")).toHaveLength(1);
  });

  it("uses review context for an excerpt that has no separate bookmark", () => {
    const markdown = buildWereadMarkdown(
      sampleInput({
        bookmarks: { updated: [] },
        reviews: {
          reviews: [
            {
              review: {
                reviewId: "standalone",
                chapterUid: 1,
                abstract: "目标句",
                context: "段落开头，目标句，段落结尾。",
                content: "针对这句的评论",
              },
            },
          ],
        },
      }),
    );
    expect(markdown).toContain(
      "段落开头，==目标句==，段落结尾。\n\n> 书评\n>\n> 针对这句的评论",
    );
  });

  it("uses an English review label without changing quote structure", () => {
    expect(buildWereadMarkdown(sampleInput({ language: "en" }))).toContain(
      "> Review\n>\n> 这句太好了",
    );
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
