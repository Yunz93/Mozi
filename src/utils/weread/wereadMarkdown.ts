import { generateFrontmatter, parseFrontmatter } from "../frontmatter";
import { getRelativePath, normalizeSlashes } from "../pathHelpers";
import {
  WEREAD_BOOK_ID_KEY,
  WEREAD_GENERATED_END_MARKER,
  WEREAD_SOURCE,
  WEREAD_USER_APPENDIX_MARKER,
  wereadBookmarkMarker,
  wereadHotHighlightMarker,
  wereadReviewMarker,
} from "./wereadConstants";
import type {
  WereadBestBookmarksResponse,
  WereadBookInfo,
  WereadBookmark,
  WereadBookmarkListResponse,
  WereadChapter,
  WereadHotHighlight,
  WereadReviewBody,
  WereadReviewItem,
  WereadReviewListResponse,
} from "./wereadTypes";

export interface WereadMarkdownInput {
  bookId: string;
  book: WereadBookInfo;
  bookmarks: WereadBookmarkListResponse;
  reviews: WereadReviewListResponse;
  hotHighlights?: WereadBestBookmarksResponse | null;
  importedAt: string;
  coverRelativePath?: string | null;
  language?: "zh-CN" | "en";
}

interface ChapterBucket {
  uid: number;
  idx: number;
  title: string;
  bookmarks: WereadBookmark[];
  reviews: WereadReviewBody[];
}

const UNCHAPTERED_UID = -1;

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function reviewBody(
  item: WereadReviewItem | undefined,
): WereadReviewBody | null {
  if (!item) return null;
  if (item.review && typeof item.review === "object") {
    return item.review;
  }
  if (item.reviewId) {
    return { reviewId: item.reviewId };
  }
  return null;
}

function escapeForMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function asBlockquote(text: string): string {
  const lines = escapeForMarkdown(text).split("\n");
  if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
    return "";
  }
  return lines.map((line) => `> ${line || ""}`).join("\n");
}

function rangeStart(range: string | undefined): number {
  const match = String(range ?? "").match(/^(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function escapeHighlightInner(text: string): string {
  return escapeForMarkdown(text).replace(/\n+/g, " ").replace(/==/g, "＝＝");
}

function highlightInsideContext(highlight: string, context?: string): string {
  const mark = escapeHighlightInner(highlight);
  if (!mark) return "";
  const paragraph = escapeForMarkdown(context ?? "").replace(/\n+/g, " ");
  if (paragraph && paragraph !== mark && paragraph.includes(mark)) {
    const index = paragraph.indexOf(mark);
    return `${paragraph.slice(0, index)}==${mark}==${paragraph.slice(index + mark.length)}`;
  }
  return `……==${mark}==……`;
}

function asExcerptCallout(
  body: string,
  language: "zh-CN" | "en",
  title?: string,
): string {
  const heading = title ?? (language === "en" ? "Excerpt" : "书摘");
  const lines = body.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return "";
  return [`> [!quote] ${heading}`, ...lines.map((line) => `> ${line}`)].join(
    "\n",
  );
}

function formatImportedAt(isoDate: string): string {
  const match = isoDate.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function chapterTitleFrom(
  chapters: WereadChapter[] | undefined,
  uid: number | undefined,
  fallbackName?: string,
): { title: string; idx: number } {
  const match = chapters?.find((chapter) => chapter.chapterUid === uid);
  if (match?.title?.trim()) {
    return {
      title: match.title.trim(),
      idx: match.chapterIdx ?? Number.MAX_SAFE_INTEGER,
    };
  }
  if (fallbackName?.trim()) {
    return { title: fallbackName.trim(), idx: Number.MAX_SAFE_INTEGER };
  }
  return { title: "未分章", idx: Number.MAX_SAFE_INTEGER };
}

function collectChapters(
  bookmarks: WereadBookmark[],
  reviews: WereadReviewBody[],
  chapterLists: Array<WereadChapter[] | undefined>,
): ChapterBucket[] {
  const chapters = chapterLists.flatMap((list) => list ?? []);
  const buckets = new Map<number, ChapterBucket>();

  const ensure = (
    uid: number | undefined,
    fallbackName?: string,
    idxHint?: number,
  ): ChapterBucket => {
    const key = typeof uid === "number" ? uid : UNCHAPTERED_UID;
    const existing = buckets.get(key);
    if (existing) return existing;
    const meta = chapterTitleFrom(
      chapters,
      typeof uid === "number" ? uid : undefined,
      fallbackName,
    );
    const created: ChapterBucket = {
      uid: key,
      idx: idxHint ?? meta.idx,
      title: meta.title,
      bookmarks: [],
      reviews: [],
    };
    buckets.set(key, created);
    return created;
  };

  for (const bookmark of bookmarks) {
    if (!textOf(bookmark.markText) && !textOf(bookmark.bookmarkId)) continue;
    ensure(bookmark.chapterUid).bookmarks.push(bookmark);
  }

  for (const review of reviews) {
    if (!textOf(review.content) && !textOf(review.reviewId)) continue;
    ensure(
      review.chapterUid,
      review.chapterName,
      review.chapterIdx,
    ).reviews.push(review);
  }

  for (const bucket of buckets.values()) {
    bucket.bookmarks.sort((a, b) => rangeStart(a.range) - rangeStart(b.range));
    bucket.reviews.sort((a, b) => rangeStart(a.range) - rangeStart(b.range));
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.uid === UNCHAPTERED_UID) return 1;
    if (b.uid === UNCHAPTERED_UID) return -1;
    return a.idx - b.idx || a.title.localeCompare(b.title, "zh-CN");
  });
}

function bookmarkMatchesReview(
  bookmark: WereadBookmark,
  review: WereadReviewBody,
): boolean {
  const bookmarkRange = textOf(bookmark.range);
  const reviewRange = textOf(review.range);
  if (bookmarkRange && reviewRange && bookmarkRange === reviewRange) {
    return true;
  }
  const markText = textOf(bookmark.markText);
  const abstract = textOf(review.abstract);
  if (!markText || !abstract) return false;
  return markText === abstract || abstract.includes(markText);
}

function paragraphContextForBookmark(
  bookmark: WereadBookmark,
  linkedReviews: WereadReviewBody[],
  mark: string,
): string | undefined {
  const candidates = [
    textOf(bookmark.context),
    textOf(bookmark.abstract),
    ...linkedReviews.map((review) => textOf(review.abstract)),
  ].filter(Boolean);
  return (
    candidates.find((value) => value !== mark && value.includes(mark)) ||
    candidates[0] ||
    undefined
  );
}

function renderBookmark(
  bookmark: WereadBookmark,
  linkedReviews: WereadReviewBody[],
  language: "zh-CN" | "en",
): string {
  const id = textOf(bookmark.bookmarkId) || textOf(bookmark.range) || "unknown";
  const mark =
    textOf(bookmark.markText) ||
    (language === "en" ? "(no highlight)" : "（无划线原文）");
  const excerpt = highlightInsideContext(
    mark,
    paragraphContextForBookmark(bookmark, linkedReviews, mark),
  );
  const parts = [wereadBookmarkMarker(id), asExcerptCallout(excerpt, language)];
  for (const review of linkedReviews) {
    const reviewId = textOf(review.reviewId);
    if (reviewId) parts.push(wereadReviewMarker(reviewId));
    const content = textOf(review.content);
    if (content) parts.push(asBlockquote(content));
  }
  return parts.filter(Boolean).join("\n\n");
}

function renderStandaloneReview(
  review: WereadReviewBody,
  language: "zh-CN" | "en",
): string {
  const id = textOf(review.reviewId) || "unknown";
  const parts = [wereadReviewMarker(id)];
  const abstract = textOf(review.abstract);
  if (abstract) {
    parts.push(asExcerptCallout(highlightInsideContext(abstract), language));
  }
  const content = textOf(review.content);
  if (content) parts.push(asBlockquote(content));
  return parts.filter(Boolean).join("\n\n");
}

function renderHotHighlights(
  items: WereadHotHighlight[],
  chapters: WereadChapter[] | undefined,
  language: "zh-CN" | "en",
): string {
  if (items.length === 0) return "";
  const heading = language === "en" ? "## Popular highlights" : "## 热门划线";
  const notice =
    language === "en"
      ? "These are popular highlights from other WeRead readers, not your own notes."
      : "以下是微信读书中他人常划的句子，不是你的个人笔记。";

  const excerptTitle = language === "en" ? "Popular excerpt" : "热门书摘";
  const lines = [heading, "", notice, ""];
  for (const item of items) {
    const id =
      textOf(item.bookmarkId) || textOf(item.range) || textOf(item.markText);
    if (id) lines.push(wereadHotHighlightMarker(id));
    const excerpt = highlightInsideContext(textOf(item.markText));
    if (excerpt) {
      lines.push(asExcerptCallout(excerpt, language, excerptTitle));
    }
    const meta: string[] = [];
    const chapter = chapterTitleFrom(chapters, item.chapterUid);
    if (chapter.title && chapter.title !== "未分章") {
      meta.push(chapter.title);
    }
    if (typeof item.totalCount === "number" && item.totalCount > 0) {
      meta.push(
        language === "en"
          ? `${item.totalCount} highlights`
          : `${item.totalCount} 人划线`,
      );
    }
    if (meta.length > 0) {
      lines.push(`— ${meta.join(" · ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function buildWereadFrontmatter(
  input: WereadMarkdownInput,
): Record<string, string | string[]> {
  const book = input.book ?? {};
  const frontmatter: Record<string, string | string[]> = {
    title: textOf(book.title) || input.bookId,
    author: textOf(book.author),
    source: WEREAD_SOURCE,
    [WEREAD_BOOK_ID_KEY]: input.bookId,
    tags: ["读书"],
    weread_imported_at: formatImportedAt(input.importedAt),
  };
  const publisher = textOf(book.publisher);
  if (publisher) frontmatter.publisher = publisher;
  const isbn = textOf(book.isbn);
  if (isbn) frontmatter.isbn = isbn;
  return frontmatter;
}

export function buildWereadGeneratedBody(input: WereadMarkdownInput): string {
  const language = input.language ?? "zh-CN";
  const book = input.book ?? {};
  const title = textOf(book.title) || input.bookId;
  const author = textOf(book.author);
  const publisher = textOf(book.publisher);
  const deepLink = textOf(book.deepLink);
  const bookmarks = (input.bookmarks.updated ?? []).filter(
    (item) => item.type !== 0,
  );
  const reviews = (input.reviews.reviews ?? [])
    .map(reviewBody)
    .filter((item): item is WereadReviewBody => Boolean(item));

  const byline = [author, publisher].filter(Boolean).join(" · ");
  const lines: string[] = [`# ${title}`, ""];
  if (byline) {
    lines.push(byline, "");
  }
  if (deepLink) {
    lines.push(
      language === "en"
        ? `[Open in WeRead](${deepLink})`
        : `[在微信读书打开](${deepLink})`,
      "",
    );
  }
  if (input.coverRelativePath) {
    lines.push(
      `![${language === "en" ? "Cover" : "封面"}](${input.coverRelativePath})`,
      "",
    );
  }

  const bookReviews = reviews.filter((review) => {
    const hasChapter =
      typeof review.chapterUid === "number" && review.chapterUid > 0;
    return !hasChapter && !textOf(review.abstract) && !textOf(review.range);
  });
  const chapterReviews = reviews.filter(
    (review) => !bookReviews.includes(review),
  );

  if (bookReviews.length > 0) {
    lines.push(language === "en" ? "## Book review" : "## 书评", "");
    for (const review of bookReviews) {
      lines.push(renderStandaloneReview(review, language), "");
    }
  }

  const chapters = collectChapters(bookmarks, chapterReviews, [
    input.bookmarks.chapters,
    input.hotHighlights?.chapters,
  ]);

  for (const chapter of chapters) {
    if (chapter.bookmarks.length === 0 && chapter.reviews.length === 0) {
      continue;
    }
    lines.push(`## ${chapter.title}`, "");
    const remaining = [...chapter.reviews];
    for (const bookmark of chapter.bookmarks) {
      const linked: WereadReviewBody[] = [];
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const review = remaining[index];
        if (bookmarkMatchesReview(bookmark, review)) {
          linked.unshift(review);
          remaining.splice(index, 1);
        }
      }
      lines.push(renderBookmark(bookmark, linked, language), "");
    }
    for (const review of remaining) {
      lines.push(renderStandaloneReview(review, language), "");
    }
  }

  if (input.hotHighlights?.items && input.hotHighlights.items.length > 0) {
    lines.push(
      renderHotHighlights(
        input.hotHighlights.items,
        input.hotHighlights.chapters ?? input.bookmarks.chapters,
        language,
      ),
      "",
    );
  }

  lines.push(WEREAD_GENERATED_END_MARKER);
  return `${lines.join("\n").trim()}\n`;
}

export function buildWereadMarkdown(input: WereadMarkdownInput): string {
  const frontmatter = generateFrontmatter(buildWereadFrontmatter(input));
  return `${frontmatter}${buildWereadGeneratedBody(input)}`;
}

export function extractWereadUserAppendix(content: string): string {
  const appendixIndex = content.indexOf(WEREAD_USER_APPENDIX_MARKER);
  if (appendixIndex >= 0) {
    return content
      .slice(appendixIndex + WEREAD_USER_APPENDIX_MARKER.length)
      .replace(/^\s+/, "");
  }
  const generatedEnd = content.indexOf(WEREAD_GENERATED_END_MARKER);
  if (generatedEnd >= 0) {
    return content
      .slice(generatedEnd + WEREAD_GENERATED_END_MARKER.length)
      .replace(/^\s+/, "");
  }
  return "";
}

export function mergeWereadMarkdown(
  existingContent: string,
  generated: WereadMarkdownInput,
): string {
  const parsed = parseFrontmatter(existingContent);
  const nextFrontmatter = {
    ...(parsed.frontmatter ?? {}),
    ...buildWereadFrontmatter(generated),
  };
  const appendix = extractWereadUserAppendix(existingContent);
  const body = buildWereadGeneratedBody(generated);
  const appendixBlock = appendix.trim()
    ? `\n${WEREAD_USER_APPENDIX_MARKER}\n\n${appendix.trim()}\n`
    : "";
  return `${generateFrontmatter(nextFrontmatter)}${body}${appendixBlock}`;
}

export function readWereadBookId(content: string): string | null {
  const parsed = parseFrontmatter(content);
  const value = parsed.frontmatter?.[WEREAD_BOOK_ID_KEY];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

export function coverMarkdownPath(
  notePath: string,
  coverAbsolutePath: string,
): string {
  const relative = getRelativePath(
    normalizeSlashes(notePath),
    normalizeSlashes(coverAbsolutePath),
  );
  return relative || coverAbsolutePath;
}
