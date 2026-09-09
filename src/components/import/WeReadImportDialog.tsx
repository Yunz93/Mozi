import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useI18n } from "../../hooks/useI18n";
import { notebookNoteTotal, notebookTitle } from "../../utils/weread/wereadApi";
import type {
  WereadConflictMode,
  WereadNotebook,
  WereadStoreBook,
} from "../../utils/weread/wereadTypes";
import type { WereadImportBookResult } from "../../utils/weread/wereadImport";

interface WeReadImportDialogProps {
  isOpen: boolean;
  isImporting: boolean;
  initialQuery?: string;
  preselectedBookIds?: string[];
  defaultSaveCover: boolean;
  defaultIncludeHotHighlights: boolean;
  onClose: () => void;
  onLoadNotebooks: (force?: boolean) => Promise<WereadNotebook[]>;
  onSearchStore: (keyword: string) => Promise<WereadStoreBook[]>;
  onImport: (options: {
    notebooks: WereadNotebook[];
    conflictMode: WereadConflictMode;
    saveCover: boolean;
    includeHotHighlights: boolean;
  }) => Promise<WereadImportBookResult[]>;
}

function storeBookToNotebook(book: WereadStoreBook): WereadNotebook {
  return {
    bookId: book.bookId,
    book: {
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      cover: book.cover,
      publisher: book.publisher,
      deepLink: book.deepLink,
    },
    reviewCount: 0,
    noteCount: 0,
    bookmarkCount: 0,
  };
}

export const WeReadImportDialog: React.FC<WeReadImportDialogProps> = ({
  isOpen,
  isImporting,
  initialQuery = "",
  preselectedBookIds = [],
  defaultSaveCover,
  defaultIncludeHotHighlights,
  onClose,
  onLoadNotebooks,
  onSearchStore,
  onImport,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [notebooks, setNotebooks] = useState<WereadNotebook[]>([]);
  const [storeBooks, setStoreBooks] = useState<WereadStoreBook[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [conflictMode, setConflictMode] = useState<WereadConflictMode>("merge");
  const [saveCover, setSaveCover] = useState(defaultSaveCover);
  const [includeHotHighlights, setIncludeHotHighlights] = useState(
    defaultIncludeHotHighlights,
  );
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState("");
  const onLoadNotebooksRef = useRef(onLoadNotebooks);
  const onSearchStoreRef = useRef(onSearchStore);
  onLoadNotebooksRef.current = onLoadNotebooks;
  onSearchStoreRef.current = onSearchStore;
  const preselectedKey = preselectedBookIds.join("\0");

  useEffect(() => {
    if (!isOpen) return;
    setQuery(initialQuery);
    setConflictMode("merge");
    setSaveCover(defaultSaveCover);
    setIncludeHotHighlights(defaultIncludeHotHighlights);
    setStoreBooks([]);
    setLoadError("");
    setLoading(true);
    const selected = preselectedKey ? preselectedKey.split("\0") : [];
    void onLoadNotebooksRef
      .current()
      .then((items) => {
        setNotebooks(items);
        const next = new Set(selected.filter(Boolean));
        if (next.size === 0 && items.length === 1 && items[0]) {
          next.add(items[0].bookId);
        }
        setSelectedIds(next);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoading(false));
  }, [
    defaultIncludeHotHighlights,
    defaultSaveCover,
    initialQuery,
    isOpen,
    preselectedKey,
  ]);

  const filteredNotebooks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return notebooks;
    return notebooks.filter((item) => {
      const haystack =
        `${notebookTitle(item)} ${item.book?.author ?? ""} ${item.bookId}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [notebooks, query]);

  useEffect(() => {
    if (!isOpen) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setStoreBooks([]);
      return;
    }
    if (filteredNotebooks.length > 0) {
      setStoreBooks([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void onSearchStoreRef
        .current(needle)
        .then((items) => {
          if (!cancelled) setStoreBooks(items);
        })
        .catch(() => {
          if (!cancelled) setStoreBooks([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filteredNotebooks.length, isOpen, query]);

  const visibleStoreBooks = useMemo(() => {
    const known = new Set(notebooks.map((item) => item.bookId));
    return storeBooks.filter((book) => !known.has(book.bookId));
  }, [notebooks, storeBooks]);

  const toggleId = (bookId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const visibleIds = [
        ...filteredNotebooks.map((item) => item.bookId),
        ...visibleStoreBooks.map((item) => item.bookId),
      ];
      const allSelected = visibleIds.every((id) => next.has(id));
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleImport = async () => {
    const fromNotebooks = notebooks.filter((item) =>
      selectedIds.has(item.bookId),
    );
    const fromStore = visibleStoreBooks
      .filter((item) => selectedIds.has(item.bookId))
      .map(storeBookToNotebook);
    const selected = [...fromNotebooks, ...fromStore];
    if (selected.length === 0) return;
    const results = await onImport({
      notebooks: selected,
      conflictMode,
      saveCover,
      includeHotHighlights,
    });
    if (results.some((result) => result.status !== "failed")) {
      onClose();
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("wereadImport_title")}
      className="max-w-2xl h-[min(88vh,720px)]"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
      contentScroll={false}
      closable={!isImporting}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
          {t("wereadImport_desc")}
        </p>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("wereadImport_searchPlaceholder")}
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm transition-all focus:border-accent-DEFAULT focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 dark:border-white/10 dark:bg-white/5"
        />

        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            {loading
              ? t("common_loading")
              : t("wereadImport_listCount", {
                  count: filteredNotebooks.length,
                })}
          </span>
          <button
            type="button"
            onClick={handleSelectAllVisible}
            className="text-accent-DEFAULT hover:underline"
          >
            {t("wereadImport_toggleVisible")}
          </button>
        </div>

        <div className="min-h-[220px] max-h-[42vh] overflow-y-auto rounded-2xl border border-gray-200/70 dark:border-white/10">
          {loadError ? (
            <p className="px-4 py-6 text-sm text-red-500">{loadError}</p>
          ) : filteredNotebooks.length === 0 &&
            visibleStoreBooks.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
              {searching
                ? t("wereadImport_searching")
                : t("wereadImport_empty")}
            </p>
          ) : (
            <ul className="divide-y divide-gray-200/70 dark:divide-white/10">
              {filteredNotebooks.map((item) => {
                const checked = selectedIds.has(item.bookId);
                return (
                  <li key={item.bookId}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleId(item.bookId)}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
                          {notebookTitle(item)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
                          {[
                            item.book?.author,
                            t("wereadImport_stats", {
                              notes: item.noteCount ?? 0,
                              reviews: item.reviewCount ?? 0,
                              bookmarks: item.bookmarkCount ?? 0,
                              total: notebookNoteTotal(item),
                            }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {visibleStoreBooks.map((item) => (
                <li key={`store-${item.bookId}`}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.bookId)}
                      onChange={() => toggleId(item.bookId)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
                        {[item.author, t("wereadImport_fromStore")]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("wereadImport_conflictLabel")}
          </legend>
          {(
            [
              ["merge", "wereadImport_conflictMerge"],
              ["skip", "wereadImport_conflictSkip"],
              ["overwrite", "wereadImport_conflictOverwrite"],
            ] as const
          ).map(([value, key]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="weread-conflict"
                checked={conflictMode === value}
                onChange={() => setConflictMode(value)}
              />
              {t(key)}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={saveCover}
            onChange={(event) => setSaveCover(event.target.checked)}
          />
          {t("wereadImport_saveCover")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeHotHighlights}
            onChange={(event) => setIncludeHotHighlights(event.target.checked)}
          />
          {t("wereadImport_includeHot")}
        </label>
      </div>

      <div className="flex justify-end gap-3 border-t border-gray-200/50 px-6 py-4 dark:border-white/10">
        <button
          type="button"
          onClick={onClose}
          disabled={isImporting}
          className="inline-flex items-center rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {t("common_cancel")}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleImport();
          }}
          disabled={isImporting || selectedIds.size === 0}
          className="inline-flex items-center rounded-xl bg-black px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {isImporting
            ? t("wereadImport_importing")
            : t("wereadImport_submit", { count: selectedIds.size })}
        </button>
      </div>
    </Dialog>
  );
};
