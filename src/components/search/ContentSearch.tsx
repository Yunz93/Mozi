import React, { useState, useCallback, useEffect, useRef } from "react";
import { useAppStore, selectContent } from "../../store/appStore";
import {
  focusEditorRangeByOffset,
  getActiveEditorView,
} from "../../utils/editorSelectionBridge";
import { useI18n } from "../../hooks/useI18n";
import { isLargeFile } from "../../utils/performance";
import { ViewMode } from "../../types";
import { isImeComposingEvent, isPlainEnterKey } from "../../utils/imeKeyboard";

interface ContentSearchProps {
  onClose: () => void;
}

export interface SearchMatch {
  index: number;
  length: number;
}

export const MAX_MATCHES = 5000;

export function buildSearchRegex(
  text: string,
  options: { caseSensitive: boolean; useRegex: boolean; wholeWord: boolean },
): RegExp | null {
  let pattern = options.useRegex
    ? text
    : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }
  try {
    return new RegExp(pattern, options.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/** 在文档中查找匹配，不做逐匹配的 split("\\n")，避免大文档卡死。 */
export function findContentSearchMatches(
  content: string,
  searchText: string,
  options: { caseSensitive: boolean; useRegex: boolean; wholeWord: boolean },
): { matches: SearchMatch[]; truncated: boolean } {
  if (!searchText || !content) return { matches: [], truncated: false };

  const regex = buildSearchRegex(searchText, options);
  if (!regex) return { matches: [], truncated: false };

  const matches: SearchMatch[] = [];
  let truncated = false;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }

    matches.push({
      index: match.index,
      length: match[0].length,
    });

    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
  }

  return { matches, truncated };
}

/** 内容变化后保留最接近旧 offset 的匹配下标。 */
export function findClosestMatchIndex(
  matches: SearchMatch[],
  targetOffset: number,
): number {
  if (matches.length === 0) return 0;
  let best = 0;
  let bestDist = Math.abs(matches[0].index - targetOffset);
  for (let i = 1; i < matches.length; i++) {
    const dist = Math.abs(matches[i].index - targetOffset);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Content search component with find and replace functionality
 */
export const ContentSearch: React.FC<ContentSearchProps> = ({ onClose }) => {
  const { t } = useI18n();
  const content = useAppStore(selectContent);
  const { setContent, activeTabId } = useAppStore();
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [resultsTruncated, setResultsTruncated] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigationSourceRef = useRef<"search" | "nav" | null>(null);
  const prevSearchIdentityRef = useRef("");
  const currentMatchIndexRef = useRef(0);
  const matchesRef = useRef<SearchMatch[]>([]);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Ensure the editor pane is visible so match selection is not hidden.
  useEffect(() => {
    const state = useAppStore.getState();
    if (state.viewMode === ViewMode.PREVIEW) {
      state.setViewMode(ViewMode.LIVE, "direct");
    }
    // Only on open — avoid fighting other view-mode controllers while searching.
  }, []);

  currentMatchIndexRef.current = currentMatchIndex;
  matchesRef.current = matches;

  // Update matches when search text / content / options change
  useEffect(() => {
    const searchIdentity = `${searchText}\0${caseSensitive}\0${useRegex}\0${wholeWord}`;
    if (!searchText) {
      prevSearchIdentityRef.current = searchIdentity;
      setMatches([]);
      setCurrentMatchIndex(0);
      setResultsTruncated(false);
      return;
    }

    const searchChanged = prevSearchIdentityRef.current !== searchIdentity;
    prevSearchIdentityRef.current = searchIdentity;

    const delay = isLargeFile(content) ? 300 : 120;
    const timer = window.setTimeout(() => {
      const { matches: newMatches, truncated } = findContentSearchMatches(
        content,
        searchText,
        { caseSensitive, useRegex, wholeWord },
      );
      setMatches(newMatches);
      setResultsTruncated(truncated);
      if (searchChanged) {
        setCurrentMatchIndex(0);
        navigationSourceRef.current = "search";
      } else {
        const oldMatches = matchesRef.current;
        const oldIndex = currentMatchIndexRef.current;
        const oldOffset = oldMatches[oldIndex]?.index ?? 0;
        setCurrentMatchIndex(findClosestMatchIndex(newMatches, oldOffset));
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [searchText, content, caseSensitive, useRegex, wholeWord]);

  const focusCurrentMatch = useCallback((match: SearchMatch) => {
    focusEditorRangeByOffset(match.index, match.index + match.length, {
      alignTopRatio: 0.3,
      focus: false,
    });
  }, []);

  // Navigate to next match
  // 只标记「用户导航」并更新下标，实际定位交给下面的 effect 统一处理，
  // 避免在 setState updater 里做副作用（StrictMode 下会执行两次）。
  const goToNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    navigationSourceRef.current = "nav";
    setCurrentMatchIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  // Navigate to previous match
  const goToPrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    navigationSourceRef.current = "nav";
    setCurrentMatchIndex(
      (prev) => (prev - 1 + matches.length) % matches.length,
    );
  }, [matches.length]);

  // Replace current match
  const replaceCurrentMatch = useCallback(() => {
    if (matches.length === 0 || !activeTabId) return;

    const match = matches[currentMatchIndex];
    const view = getActiveEditorView();
    if (view) {
      view.dispatch({
        changes: {
          from: match.index,
          to: match.index + match.length,
          insert: replaceText,
        },
        userEvent: "input.replace",
      });
      return;
    }
    const newContent =
      content.substring(0, match.index) +
      replaceText +
      content.substring(match.index + match.length);
    setContent(newContent);
  }, [
    matches,
    currentMatchIndex,
    content,
    replaceText,
    setContent,
    activeTabId,
  ]);

  // Replace all matches
  const replaceAllMatches = useCallback(() => {
    if (matches.length === 0 || !activeTabId) return;

    const regex = buildSearchRegex(searchText, {
      caseSensitive,
      useRegex,
      wholeWord,
    });
    if (!regex) return;

    const view = getActiveEditorView();
    if (view) {
      const source = view.state.doc.toString();
      // 正则模式下对每个匹配片段单独求值替换串（支持 $1 等引用），保留原 flags 但去掉 g
      const singleMatchRegex = useRegex
        ? new RegExp(regex.source, regex.flags.replace("g", ""))
        : null;
      const changes = matches.map((m) => {
        const slice = source.slice(m.index, m.index + m.length);
        const insert = singleMatchRegex
          ? slice.replace(singleMatchRegex, replaceText)
          : replaceText;
        return { from: m.index, to: m.index + m.length, insert };
      });
      view.dispatch({
        changes,
        userEvent: "input.replace",
      });
      return;
    }

    // When not in regex mode the replacement text must be literal, so escape
    // `$` which String.replace would otherwise treat as a pattern reference.
    const literalReplacement = useRegex
      ? replaceText
      : replaceText.replace(/\$/g, "$$$$");
    setContent(content.replace(regex, literalReplacement));
  }, [
    matches,
    content,
    searchText,
    replaceText,
    caseSensitive,
    useRegex,
    wholeWord,
    setContent,
    activeTabId,
  ]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeComposingEvent(e)) return;
      if (e.key === "Escape") {
        onClose();
      } else if (isPlainEnterKey(e)) {
        if (e.shiftKey) {
          goToPrevMatch();
        } else {
          goToNextMatch();
        }
      }
    },
    [onClose, goToNextMatch, goToPrevMatch],
  );

  // 仅在用户导航或输入新搜索词时定位，避免内容变化把选区拽回第 1 个匹配
  useEffect(() => {
    if (matches.length === 0 || !navigationSourceRef.current) return;
    const match = matches[currentMatchIndex];
    if (!match) return;
    focusCurrentMatch(match);
    navigationSourceRef.current = null;
  }, [matches, currentMatchIndex, focusCurrentMatch]);

  return (
    <div
      className="ui-scaled absolute top-0 right-0 w-96 max-w-full bg-white dark:bg-gray-900 border-b border-l border-gray-200 dark:border-gray-700 shadow-lg rounded-bl-xl z-40"
      onKeyDown={handleKeyDown}
    >
      <div className="p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowReplace(false)}
              aria-pressed={!showReplace}
              className={`text-sm font-medium transition-colors ${
                showReplace
                  ? "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              {t("search_find")}
            </button>
            <button
              type="button"
              onClick={() => setShowReplace(true)}
              aria-pressed={showReplace}
              className={`text-sm font-medium transition-colors ${
                showReplace
                  ? "text-gray-900 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              {t("search_replace")}
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg
              className="w-4 h-4 text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1">
            <input
              ref={searchInputRef}
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("search_searchPlaceholder")}
              className="w-full pl-3 pr-24 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                onClick={() => setCaseSensitive(!caseSensitive)}
                className={`p-1 rounded transition-colors ${
                  caseSensitive
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
                title={t("search_caseSensitive")}
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 20l4-10 4 10" />
                  <line x1="5.5" y1="16" x2="10.5" y2="16" />
                  <path d="M16 8h4a2 2 0 0 1 0 4h-4v8" />
                </svg>
              </button>
              <button
                onClick={() => setWholeWord(!wholeWord)}
                className={`p-1 rounded transition-colors text-[11px] font-semibold leading-none ${
                  wholeWord
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
                title={t("search_wholeWord")}
              >
                <span className="inline-block w-3.5 text-center underline decoration-dotted underline-offset-2">
                  W
                </span>
              </button>
              <button
                onClick={() => setUseRegex(!useRegex)}
                className={`p-1 rounded transition-colors ${
                  useRegex
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
                title={t("search_regex")}
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="4 7 8 7 8 11" />
                  <polyline points="20 17 16 17 16 13" />
                  <line x1="8" y1="7" x2="16" y2="15" />
                  <line x1="16" y1="9" x2="16" y2="9" />
                  <line x1="8" y1="15" x2="8" y2="15" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex items-center">
            <button
              onClick={goToPrevMatch}
              disabled={matches.length === 0}
              className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("search_prevMatch")}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={goToNextMatch}
              disabled={matches.length === 0}
              className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("search_nextMatch")}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Match count */}
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {searchText &&
            (matches.length > 0
              ? t("search_matchCount", {
                  current: currentMatchIndex + 1,
                  total: matches.length,
                })
              : t("search_noMatches"))}
          {resultsTruncated && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              {t("search_resultsTruncated", { count: MAX_MATCHES })}
            </span>
          )}
        </div>

        {/* Replace inputs */}
        {showReplace && (
          <div className="space-y-2">
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder={t("search_replacePlaceholder")}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={replaceCurrentMatch}
                disabled={matches.length === 0}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="16 3 21 3 21 8" />
                  <line x1="4" y1="20" x2="21" y2="3" />
                  <polyline points="21 16 21 21 16 21" />
                </svg>
                {t("search_replace")}
              </button>
              <button
                onClick={replaceAllMatches}
                disabled={matches.length === 0}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-black dark:bg-white dark:text-black rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17 1l4 4-4 4" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 23l-4-4 4-4" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                {t("search_replaceAll")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
