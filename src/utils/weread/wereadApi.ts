import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../types/filesystem";
import { WEREAD_SKILL_VERSION } from "./wereadConstants";
import type {
  WereadBestBookmarksResponse,
  WereadBookInfo,
  WereadBookmarkListResponse,
  WereadNotebook,
  WereadNotebooksResponse,
  WereadReviewListResponse,
  WereadReviewItem,
  WereadStoreBook,
} from "./wereadTypes";

const NOTEBOOK_PAGE_SIZE = 100;
const REVIEW_PAGE_SIZE = 50;

export class WereadGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WereadGatewayError";
  }
}

export async function wereadGateway(
  apiName: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<Record<string, unknown>> {
  if (!isTauriEnvironment()) {
    throw new WereadGatewayError(
      "WeRead import is available in the desktop app only.",
    );
  }

  const flatParams: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (key === "api_name" || key === "skill_version" || key === "params") {
      continue;
    }
    flatParams[key] = value;
  }

  try {
    return await invoke<Record<string, unknown>>("weread_gateway", {
      apiName,
      params: flatParams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WereadGatewayError(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function hasMoreFlag(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

export function notebookNoteTotal(notebook: WereadNotebook): number {
  return (
    (notebook.reviewCount ?? 0) +
    (notebook.noteCount ?? 0) +
    (notebook.bookmarkCount ?? 0)
  );
}

export function notebookTitle(notebook: WereadNotebook): string {
  return notebook.book?.title?.trim() || notebook.bookId;
}

export function notebookAuthor(notebook: WereadNotebook): string {
  return notebook.book?.author?.trim() || "";
}

function toNotebook(raw: unknown): WereadNotebook | null {
  const record = asRecord(raw);
  const book = asRecord(record.book);
  const bookId = String(record.bookId ?? book.bookId ?? "").trim();
  if (!bookId) return null;
  return {
    bookId,
    book: Object.keys(book).length > 0 ? (book as WereadBookInfo) : undefined,
    reviewCount: Number(record.reviewCount ?? 0) || 0,
    noteCount: Number(record.noteCount ?? 0) || 0,
    bookmarkCount: Number(record.bookmarkCount ?? 0) || 0,
    sort: typeof record.sort === "number" ? record.sort : undefined,
    markedStatus:
      typeof record.markedStatus === "number" ? record.markedStatus : undefined,
    readingProgress:
      typeof record.readingProgress === "number"
        ? record.readingProgress
        : undefined,
    deepLink:
      typeof record.deepLink === "string"
        ? record.deepLink
        : typeof book.deepLink === "string"
          ? book.deepLink
          : undefined,
  };
}

export async function fetchAllNotebooks(): Promise<WereadNotebook[]> {
  const books: WereadNotebook[] = [];
  let lastSort: number | undefined;
  let guard = 0;

  while (guard < 50) {
    guard += 1;
    const payload = (await wereadGateway("/user/notebooks", {
      count: NOTEBOOK_PAGE_SIZE,
      ...(lastSort !== undefined ? { lastSort } : {}),
    })) as WereadNotebooksResponse;

    const page = asArray<unknown>(payload.books)
      .map(toNotebook)
      .filter((item): item is WereadNotebook => Boolean(item));
    books.push(...page);

    if (!hasMoreFlag(payload.hasMore) || page.length === 0) {
      break;
    }
    const nextSort = page[page.length - 1]?.sort;
    if (typeof nextSort !== "number") {
      break;
    }
    lastSort = nextSort;
  }

  return books.sort((a, b) => notebookNoteTotal(b) - notebookNoteTotal(a));
}

let notebookCache: { at: number; books: WereadNotebook[] } | null = null;
const NOTEBOOK_CACHE_MS = 60_000;

export async function fetchAllNotebooksCached(
  force = false,
): Promise<WereadNotebook[]> {
  if (
    !force &&
    notebookCache &&
    Date.now() - notebookCache.at < NOTEBOOK_CACHE_MS
  ) {
    return notebookCache.books;
  }
  const books = await fetchAllNotebooks();
  notebookCache = { at: Date.now(), books };
  return books;
}

export function clearWereadNotebookCache(): void {
  notebookCache = null;
}

export async function fetchBookmarkList(
  bookId: string,
): Promise<WereadBookmarkListResponse> {
  return (await wereadGateway("/book/bookmarklist", {
    bookId,
  })) as WereadBookmarkListResponse;
}

export async function fetchMyReviews(
  bookId: string,
): Promise<WereadReviewListResponse> {
  const reviews: WereadReviewItem[] = [];
  let synckey = 0;
  let guard = 0;
  let totalCount = 0;

  while (guard < 80) {
    guard += 1;
    const payload = (await wereadGateway("/review/list/mine", {
      bookid: bookId,
      synckey,
      count: REVIEW_PAGE_SIZE,
    })) as WereadReviewListResponse;
    const page = asArray<WereadReviewItem>(payload.reviews);
    reviews.push(...page);
    totalCount = payload.totalCount ?? reviews.length;
    if (!hasMoreFlag(payload.hasMore) || page.length === 0) {
      break;
    }
    const nextKey = payload.synckey;
    if (typeof nextKey !== "number" || nextKey === synckey) {
      break;
    }
    synckey = nextKey;
  }

  return { reviews, totalCount, hasMore: 0, synckey };
}

export async function fetchBookInfo(bookId: string): Promise<WereadBookInfo> {
  return (await wereadGateway("/book/info", { bookId })) as WereadBookInfo;
}

export async function fetchBestBookmarks(
  bookId: string,
): Promise<WereadBestBookmarksResponse> {
  return (await wereadGateway("/book/bestbookmarks", {
    bookId,
    chapterUid: 0,
  })) as WereadBestBookmarksResponse;
}

export function extractStoreSearchBooks(payload: unknown): WereadStoreBook[] {
  const root = asRecord(payload);
  const results = asArray<Record<string, unknown>>(root.results);
  const books: WereadStoreBook[] = [];
  const seen = new Set<string>();

  for (const group of results) {
    for (const item of asArray<Record<string, unknown>>(group.books)) {
      const info = asRecord(item.bookInfo);
      const bookId = String(info.bookId ?? item.bookId ?? "").trim();
      const title = String(info.title ?? item.title ?? "").trim();
      if (!bookId || !title || seen.has(bookId)) continue;
      seen.add(bookId);
      books.push({
        bookId,
        title,
        author: String(info.author ?? "").trim() || undefined,
        cover: String(info.cover ?? "").trim() || undefined,
        publisher: String(info.publisher ?? "").trim() || undefined,
        deepLink: String(info.deepLink ?? "").trim() || undefined,
      });
    }
  }

  return books;
}

export async function searchStoreBooks(
  keyword: string,
): Promise<WereadStoreBook[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const payload = await wereadGateway("/store/search", {
    keyword: trimmed,
    scope: 10,
    count: 15,
  });
  return extractStoreSearchBooks(payload);
}

export async function downloadWereadCover(
  url: string,
  destPath: string,
): Promise<string> {
  if (!isTauriEnvironment()) {
    throw new WereadGatewayError(
      "WeRead import is available in the desktop app only.",
    );
  }
  try {
    return await invoke<string>("weread_download_cover", {
      url,
      destPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WereadGatewayError(message);
  }
}

export { WEREAD_SKILL_VERSION };
