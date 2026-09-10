export interface WereadBookInfo {
  bookId?: string;
  title?: string;
  author?: string;
  cover?: string;
  publisher?: string;
  publishTime?: string | number;
  isbn?: string;
  translator?: string;
  intro?: string;
  category?: string;
  deepLink?: string;
}

export interface WereadNotebook {
  bookId: string;
  book?: WereadBookInfo;
  reviewCount?: number;
  noteCount?: number;
  bookmarkCount?: number;
  sort?: number;
  markedStatus?: number;
  readingProgress?: number;
  deepLink?: string;
}

export interface WereadNotebooksResponse {
  books?: WereadNotebook[];
  totalBookCount?: number;
  totalNoteCount?: number;
  hasMore?: number | boolean;
}

export interface WereadChapter {
  chapterUid?: number;
  chapterIdx?: number;
  title?: string;
}

export interface WereadBookmark {
  bookmarkId?: string;
  bookId?: string;
  chapterUid?: number;
  markText?: string;
  /** Surrounding paragraph when the gateway includes it. */
  context?: string;
  abstract?: string;
  createTime?: number;
  type?: number;
  range?: string;
  colorStyle?: number;
}

export interface WereadBookmarkListResponse {
  updated?: WereadBookmark[];
  chapters?: WereadChapter[];
  book?: WereadBookInfo;
}

export interface WereadReviewBody {
  reviewId?: string;
  content?: string;
  abstract?: string;
  range?: string;
  chapterUid?: number;
  chapterIdx?: number;
  chapterName?: string;
  createTime?: number;
  star?: number;
  isFinish?: number;
}

export interface WereadReviewItem {
  review?: WereadReviewBody;
  reviewId?: string;
}

export interface WereadReviewListResponse {
  reviews?: WereadReviewItem[];
  totalCount?: number;
  hasMore?: number | boolean;
  synckey?: number;
}

export interface WereadHotHighlight {
  bookmarkId?: string;
  bookId?: string;
  chapterUid?: number;
  range?: string;
  markText?: string;
  totalCount?: number;
}

export interface WereadBestBookmarksResponse {
  items?: WereadHotHighlight[];
  chapters?: WereadChapter[];
  totalCount?: number;
}

export interface WereadStoreBook {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  publisher?: string;
  deepLink?: string;
}

export type WereadConflictMode = "skip" | "overwrite" | "merge";
