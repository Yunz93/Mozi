import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { FileNode, SearchMode } from "../../../types";
import { ViewMode } from "../../../types";
import { flattenHeadingNodes, parseHeadings } from "../../../utils/outline";
import { requestPreviewHeadingScroll } from "../../../utils/previewNavigationBridge";
import { useAppStore } from "../../../store/appStore";
import {
  isTrashRootName,
  sanitizeTrashFolder,
} from "../../../utils/trashFolder";
import { requestEditorRangeFocus } from "../../../utils/editorSelectionBridge";
import { retrieve } from "../../../services/vault/retrieveService";
import { createEmbeddingProvider } from "../../../services/vault/embeddingProvider";
import { getActiveVectorStore } from "../../../services/vault/semanticIndexRuntime";
import { isMarkdownFile } from "../../../utils/fileTypes";

const SEARCH_READ_CONCURRENCY = 8;
const SEARCH_CACHE_FILES = 2048;
const SEARCH_CACHE_CHARS = 1_000_000; // UTF-16 contents: at most about 2 MB.

export interface SidebarSearchSnippet {
  line: number;
  start: number;
  end: number;
  text: string;
}

export interface SidebarSearchResult {
  file: FileNode;
  filenameMatched: boolean;
  snippets: SidebarSearchSnippet[];
}

interface FileContentsMap {
  [fileId: string]: string | undefined;
}

export interface UseSidebarSearchOptions {
  files: FileNode[];
  fileContents: FileContentsMap;
  readFile: (file: FileNode) => Promise<string>;
}

export interface UseSidebarSearchReturn {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
  searchResults: SidebarSearchResult[];
  isSearching: boolean;
  filteredFiles: FileNode[];
  hasSearchQuery: boolean;
  hasVisibleFiles: boolean;
  handleSearchResultSelect: (
    file: FileNode,
    snippet?: SidebarSearchSnippet,
  ) => Promise<void>;
}

const normalizeSearchTarget = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[\u3000-\u303F\uFF00-\uFFEF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const collectParagraphMatches = (
  content: string,
  query: string,
): SidebarSearchSnippet[] => {
  // 正文按字面匹配，保留标点和连续空格，避免将查询清洗为空串。
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const lowerContent = content.toLowerCase();
  const snippets: SidebarSearchSnippet[] = [];
  const seenRanges = new Set<string>();

  let pos = 0;
  while (snippets.length < 3) {
    const matchPos = lowerContent.indexOf(normalizedQuery, pos);
    if (matchPos === -1) break;
    let start = matchPos;
    while (start > 0 && content[start - 1] !== "\n") start--;
    while (start < content.length && /\s/.test(content[start])) start++;

    let end = matchPos + normalizedQuery.length;
    while (end < content.length && content[end] !== "\n") end++;
    while (end > start && /\s/.test(content[end - 1])) end--;
    // 同一段只返回一次，跳过段内重复命中，避免长文档收集全部位置。
    pos = Math.max(matchPos + normalizedQuery.length, end);

    const line = content.slice(0, start).split("\n").length;
    const key = `${start}-${end}`;

    if (!seenRanges.has(key)) {
      seenRanges.add(key);
      snippets.push({
        line,
        start,
        end,
        text: content.slice(start, end),
      });
    }
  }

  return snippets;
};

export function useSidebarSearch(
  options: UseSidebarSearchOptions,
  deps: {
    onFileSelect: (file: FileNode) => Promise<void> | void;
    onClose: () => void;
  },
): UseSidebarSearchReturn {
  const { files, fileContents, readFile: readFileFn } = options;
  const { onFileSelect, onClose } = deps;

  const defaultMode = useAppStore(
    (s) => s.settings.searchModeDefault ?? "keyword",
  );
  const settings = useAppStore((s) => s.settings);
  const chunkIndex = useAppStore((s) => s.chunkIndex);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>(defaultMode);
  const [searchResults, setSearchResults] = useState<SidebarSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const contentCacheRef = useRef(new Map<string, string>());
  const cacheCharsRef = useRef(0);
  const cacheContent = useCallback((id: string, content: string) => {
    const cache = contentCacheRef.current;
    const previous = cache.get(id);
    if (previous !== undefined) {
      cache.delete(id);
      cacheCharsRef.current -= previous.length;
    }
    if (content.length > SEARCH_CACHE_CHARS) return;
    while (
      cache.size &&
      (cache.size >= SEARCH_CACHE_FILES ||
        cacheCharsRef.current + content.length > SEARCH_CACHE_CHARS)
    ) {
      const oldest = cache.keys().next().value!;
      cacheCharsRef.current -= cache.get(oldest)!.length;
      cache.delete(oldest);
    }
    cache.set(id, content);
    cacheCharsRef.current += content.length;
  }, []);
  const trashFolder = useAppStore((state) => state.settings.trashFolder);

  useEffect(() => {
    setSearchMode(defaultMode);
  }, [defaultMode]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredFiles = useMemo(() => {
    const sortNodes = (nodes: FileNode[]): FileNode[] => {
      return [...nodes].sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    };

    const normalizedTrashFolder = sanitizeTrashFolder(trashFolder);
    const visibleFiles = files.filter(
      (node) =>
        !node.isTrash && !isTrashRootName(node.name, normalizedTrashFolder),
    );

    if (!normalizedQuery) {
      return sortNodes(visibleFiles);
    }

    const filtered = visibleFiles.filter(
      (file) =>
        file.name.toLowerCase().includes(normalizedQuery) ||
        normalizeSearchTarget(file.name).includes(normalizedQuery),
    );
    return sortNodes(filtered);
  }, [files, normalizedQuery, trashFolder]);

  const hasSearchQuery = normalizedQuery.length > 0;
  const hasVisibleFiles = filteredFiles.length > 0;

  const searchableFiles = useMemo(() => {
    const result: FileNode[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.type === "folder" && node.children) {
          walk(node.children);
        } else if (node.type === "file" && isMarkdownFile(node.name)) {
          result.push(node);
        }
      }
    };
    walk(files);
    return result;
  }, [files]);

  const filesByPath = useMemo(() => {
    const map = new Map<string, FileNode>();
    for (const file of searchableFiles) {
      map.set(file.path.replace(/\\/g, "/"), file);
      map.set(file.id, file);
    }
    return map;
  }, [searchableFiles]);

  useEffect(() => {
    contentCacheRef.current.clear();
    cacheCharsRef.current = 0;
  }, [searchableFiles, chunkIndex]);

  useEffect(() => {
    if (!normalizedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsSearching(true);
        const byPath = new Map<string, SidebarSearchResult>();
        let usedRetrieval = false;

        if (searchMode !== "keyword" && chunkIndex) {
          try {
            const hits = await retrieve({
              query: searchQuery.trim(),
              chunkIndex,
              vectorStore: getActiveVectorStore(),
              embeddingProvider: createEmbeddingProvider(settings),
              retrieve: { mode: searchMode, topK: 30 },
            });
            if (cancelled) return;

            for (const hit of hits) {
              const file =
                filesByPath.get(hit.chunk.path.replace(/\\/g, "/")) ||
                filesByPath.get(hit.chunk.path);
              if (!file) continue;
              const existing = byPath.get(file.path);
              const snippet: SidebarSearchSnippet = {
                line: hit.chunk.startLine,
                start: 0,
                end: 0,
                text: hit.chunk.text.slice(0, 160),
              };
              if (!existing) {
                byPath.set(file.path, {
                  file,
                  filenameMatched: false,
                  snippets: [snippet],
                });
              } else if (existing.snippets.length < 3) {
                existing.snippets.push(snippet);
              }
            }

            for (const file of searchableFiles) {
              const filenameMatched =
                normalizeSearchTarget(file.name).includes(normalizedQuery) ||
                file.name.toLowerCase().includes(normalizedQuery);
              if (!filenameMatched) continue;
              if (!byPath.has(file.path)) {
                byPath.set(file.path, {
                  file,
                  filenameMatched: true,
                  snippets: [],
                });
              } else {
                byPath.get(file.path)!.filenameMatched = true;
              }
            }

            if (searchMode === "semantic") {
              const nextResults = [...byPath.values()].sort((left, right) => {
                if (left.filenameMatched !== right.filenameMatched) {
                  return left.filenameMatched ? -1 : 1;
                }
                return left.file.name.localeCompare(
                  right.file.name,
                  "zh-Hans-CN",
                );
              });
              setSearchResults(nextResults);
              setIsSearching(false);
              return;
            }
            usedRetrieval = true;
          } catch {
            // Fall through to keyword search.
          }
        }

        // Hybrid search must include literal contents too: semantic chunks omit
        // short notes and may exclude sections of a document. Bound reads and
        // cached text instead of reading serially or retaining the entire vault.
        let cursor = 0;
        const worker = async () => {
          while (!cancelled && cursor < searchableFiles.length) {
            const file = searchableFiles[cursor++];

            const filenameMatched =
              normalizeSearchTarget(file.name).includes(normalizedQuery) ||
              file.name.toLowerCase().includes(normalizedQuery);
            let snippets: SidebarSearchSnippet[] = [];

            if (isMarkdownFile(file.name)) {
              let content =
                fileContents[file.id] ?? contentCacheRef.current.get(file.id);
              if (content === undefined) {
                try {
                  content = await readFileFn(file);
                  if (cancelled) return;
                  cacheContent(file.id, content);
                } catch {
                  content = undefined;
                }
              }

              if (content !== undefined) {
                snippets = collectParagraphMatches(content, normalizedQuery);
              }
            }

            if (filenameMatched || snippets.length > 0) {
              const existing = byPath.get(file.path);
              byPath.set(file.path, {
                file,
                filenameMatched: filenameMatched || !!existing?.filenameMatched,
                snippets: snippets.length
                  ? snippets
                  : (existing?.snippets ?? []),
              });
            }
          }
        };
        await Promise.all(
          Array.from(
            {
              length: Math.min(SEARCH_READ_CONCURRENCY, searchableFiles.length),
            },
            worker,
          ),
        );
        const nextResults = [...byPath.values()];

        nextResults.sort((left, right) => {
          if (left.filenameMatched !== right.filenameMatched) {
            return left.filenameMatched ? -1 : 1;
          }
          if (
            !usedRetrieval &&
            left.snippets.length !== right.snippets.length
          ) {
            return right.snippets.length - left.snippets.length;
          }
          return left.file.name.localeCompare(right.file.name, "zh-Hans-CN");
        });

        if (!cancelled) {
          setSearchResults(nextResults);
          setIsSearching(false);
        }
      })();
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    readFileFn,
    cacheContent,
    fileContents,
    normalizedQuery,
    searchableFiles,
    searchMode,
    chunkIndex,
    settings,
    searchQuery,
    filesByPath,
  ]);

  const handleSearchResultSelect = useCallback(
    async (file: FileNode, snippet?: SidebarSearchSnippet) => {
      const originRoot = useAppStore.getState().rootFolderPath;
      await onFileSelect(file);
      const state = useAppStore.getState();
      if (state.activeTabId !== file.id || state.rootFolderPath !== originRoot)
        return;
      if (snippet) {
        if (state.viewMode === ViewMode.PREVIEW) {
          const content =
            state.fileContents[file.id] ?? contentCacheRef.current.get(file.id);
          if (content !== undefined) {
            const heading = flattenHeadingNodes(parseHeadings(content))
              .filter(
                (node) => node.line !== undefined && node.line <= snippet.line,
              )
              .at(-1);
            if (heading) {
              requestPreviewHeadingScroll(file.id, heading.id, {
                alignTopRatio: 0.3,
              });
            }
          }
        } else if (snippet.end > snippet.start) {
          requestEditorRangeFocus(file.id, snippet.start, snippet.end, {
            alignTopRatio: 0.3,
          });
        }
      }
      if (window.innerWidth < 768) onClose();
    },
    [onFileSelect, onClose],
  );

  return {
    searchQuery,
    setSearchQuery,
    searchMode,
    setSearchMode,
    searchResults,
    isSearching,
    filteredFiles,
    hasSearchQuery,
    hasVisibleFiles,
    handleSearchResultSelect,
  };
}
