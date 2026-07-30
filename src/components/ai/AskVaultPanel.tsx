import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../hooks/useI18n";
import {
  answerAskVaultFromHits,
  appendAskVaultHistory,
  estimateLineOffset,
  hitsToPreviewSnippets,
  loadAskVaultHistory,
  retrieveAskVaultHits,
  type AskVaultHistoryItem,
} from "../../services/vault/askVaultService";
import { hydrateSensitiveSettingsIntoStore } from "../../services/secureSettingsService";
import { localizeKnownError } from "../../utils/i18n";
import { renderMarkdown } from "../../utils/markdown";
import {
  normalizeAskVaultCitationMarkers,
  renderAskVaultAnswerHtml,
} from "../../utils/askVaultAnswerCitations";
import {
  getActiveEditorSelection,
  requestEditorRangeFocus,
} from "../../utils/editorSelectionBridge";
import { requestPreviewHeadingScroll } from "../../utils/previewNavigationBridge";
import { requestVaultLinkIndexRebuild } from "../../services/vault/linkIndexEvents";
import type { AskVaultCitation } from "../../types/vaultIndex";
import type { RetrieveHit } from "../../types/vaultIndex";
import type { FileNode } from "../../types";
import { AppSelect } from "../ui/AppSelect";
import { LAYOUT, clamp, getStoredPanelWidth } from "../../config/layout";

interface AskVaultPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenFile: (file: FileNode) => Promise<void> | void;
  readFile: (file: FileNode) => Promise<string>;
}

type AskScope = "vault" | "folder" | "files";
type PrimaryTab = "ask" | "history";
type SecondaryTab = "answer" | "sources";

function isAiConfigured(settings: {
  aiProvider?: string;
  geminiApiKey?: string;
  codexApiKey?: string;
  deepseekApiKey?: string;
}): boolean {
  if (settings.aiProvider === "codex")
    return Boolean(settings.codexApiKey?.trim());
  if (settings.aiProvider === "deepseek")
    return Boolean(settings.deepseekApiKey?.trim());
  return Boolean(settings.geminiApiKey?.trim());
}

function formatHistoryTime(at: number, language: string): string {
  try {
    return new Date(at).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export const AskVaultPanel: React.FC<AskVaultPanelProps> = ({
  open,
  onClose,
  onOpenFile,
  readFile,
}) => {
  const { t, language } = useI18n();
  const settings = useAppStore((s) => s.settings);
  const rootFolderPath = useAppStore((s) => s.rootFolderPath);
  const currentFilePath = useAppStore((s) => s.currentFilePath);
  const setPendingAiResult = useAppStore((s) => s.setPendingAiResult);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const showNotification = useAppStore((s) => s.showNotification);
  const fileContents = useAppStore((s) => s.fileContents);
  const linkIndexProgress = useAppStore((s) => s.linkIndexProgress);
  const chunkIndex = useAppStore((s) => s.chunkIndex);
  const semanticReady = useAppStore((s) => s.semanticReady);

  const panelRef = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(() =>
    getStoredPanelWidth(
      LAYOUT.STORAGE_KEYS.ASK_VAULT_WIDTH,
      LAYOUT.ASK_VAULT.DEFAULT_WIDTH,
      LAYOUT.ASK_VAULT.MIN_WIDTH,
      LAYOUT.ASK_VAULT.MAX_WIDTH,
    ),
  );

  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("ask");
  const [secondaryTab, setSecondaryTab] = useState<SecondaryTab>("answer");
  const [readinessExpanded, setReadinessExpanded] = useState(false);

  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AskScope>("vault");
  const [retrieving, setRetrieving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pendingHits, setPendingHits] = useState<RetrieveHit[]>([]);
  const [previewSnippets, setPreviewSnippets] = useState<string[]>([]);
  const [answerMarkdown, setAnswerMarkdown] = useState("");
  const [citations, setCitations] = useState<AskVaultCitation[]>([]);
  const [history, setHistory] = useState<AskVaultHistoryItem[]>([]);

  const chunkCount = useMemo(
    () =>
      chunkIndex
        ? Object.values(chunkIndex.byPath).reduce(
            (sum, chunks) => sum + chunks.length,
            0,
          )
        : 0,
    [chunkIndex],
  );

  const indexBuilding =
    linkIndexProgress.phase === "building" ||
    linkIndexProgress.phase === "updating";
  const keywordOnly = (settings.embeddingProvider ?? "builtin") === "none";
  const aiReady = isAiConfigured(settings);
  const blocked =
    !rootFolderPath || !aiReady || indexBuilding || chunkCount === 0;
  const canAsk =
    Boolean(rootFolderPath) &&
    aiReady &&
    !indexBuilding &&
    chunkCount > 0 &&
    !retrieving &&
    !generating;

  const scopeNeedsFile = scope === "folder" || scope === "files";
  const scopeBlocked = scopeNeedsFile && !currentFilePath;
  const showReadinessDetail = blocked || readinessExpanded || keywordOnly;

  const answerHtml = useMemo(() => {
    if (!answerMarkdown.trim()) return "";
    return renderAskVaultAnswerHtml(answerMarkdown, (markdown) =>
      renderMarkdown(markdown, {
        themeMode: settings.themeMode,
        markdownStylePreset: settings.markdownStylePreset,
      }),
    );
  }, [answerMarkdown, settings.themeMode, settings.markdownStylePreset]);

  useEffect(() => {
    if (!open || !rootFolderPath) return;
    void loadAskVaultHistory(rootFolderPath).then(setHistory);
  }, [open, rootFolderPath]);

  useEffect(() => {
    if (!open) return;
    void hydrateSensitiveSettingsIntoStore();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      LAYOUT.STORAGE_KEYS.ASK_VAULT_WIDTH,
      String(width),
    );
  }, [width]);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (window.innerWidth < 768) return;
      event.preventDefault();

      const handlePointerMove = (moveEvent: MouseEvent) => {
        const panelRect = panelRef.current?.getBoundingClientRect();
        const nextWidth =
          (panelRect?.right ?? window.innerWidth) - moveEvent.clientX;
        setWidth(
          clamp(
            nextWidth,
            LAYOUT.ASK_VAULT.MIN_WIDTH,
            LAYOUT.ASK_VAULT.MAX_WIDTH,
          ),
        );
      };

      const handlePointerUp = () => {
        document.removeEventListener("mousemove", handlePointerMove);
        document.removeEventListener("mouseup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handlePointerMove);
      document.addEventListener("mouseup", handlePointerUp);
    },
    [],
  );

  const resolveHydratedSettings = useCallback(async () => {
    const hydrated = await hydrateSensitiveSettingsIntoStore();
    return { ...settings, ...hydrated };
  }, [settings]);

  const buildRequest = useCallback(
    (activeSettings: typeof settings) => {
      const folderPath =
        scope === "folder" && currentFilePath
          ? currentFilePath.replace(/[/\\][^/\\]+$/, "")
          : null;
      return {
        question: question.trim(),
        settings: activeSettings,
        scope:
          scope === "files"
            ? ("files" as const)
            : scope === "folder"
              ? ("folder" as const)
              : ("vault" as const),
        folderPath,
        filePaths:
          scope === "files" && currentFilePath ? [currentFilePath] : undefined,
      };
    },
    [question, scope, currentFilePath],
  );

  const ensureAskConfig = useCallback(
    async (activeSettings: typeof settings) => {
      try {
        const { ensureAIConfiguration } =
          await import("../../services/aiService");
        ensureAIConfiguration(activeSettings);
        return true;
      } catch (error) {
        showNotification(
          error instanceof Error
            ? localizeKnownError(language, error.message)
            : t("notifications_aiConfigFirst"),
          "error",
        );
        setSettingsOpen(true, "ai");
        return false;
      }
    },
    [language, showNotification, setSettingsOpen, t],
  );

  /** Optional: preview snippets without calling the chat model. */
  const handleRetrieve = useCallback(async () => {
    const trimmed = question.trim();
    if (!trimmed || !rootFolderPath || !canAsk || scopeBlocked) return;

    setRetrieving(true);
    setAnswerMarkdown("");
    setCitations([]);
    setPrimaryTab("ask");
    try {
      const activeSettings = await resolveHydratedSettings();
      if (!(await ensureAskConfig(activeSettings))) return;

      const hits = await retrieveAskVaultHits(buildRequest(activeSettings));
      setPendingHits(hits);
      setPreviewSnippets(hitsToPreviewSnippets(hits));
      setSecondaryTab("sources");
      if (hits.length === 0) {
        showNotification(t("askVault_noHits"), "info");
      }
    } catch (error) {
      showNotification(
        error instanceof Error
          ? localizeKnownError(language, error.message)
          : t("askVault_failed"),
        "error",
      );
      setSettingsOpen(true, "ai");
    } finally {
      setRetrieving(false);
    }
  }, [
    question,
    rootFolderPath,
    canAsk,
    scopeBlocked,
    resolveHydratedSettings,
    ensureAskConfig,
    buildRequest,
    language,
    showNotification,
    setSettingsOpen,
    t,
  ]);

  /**
   * One-click ask: always retrieve fresh snippets, then generate.
   * Use「仅检索」when you only want to preview sources first.
   */
  const handleAsk = useCallback(async () => {
    const trimmed = question.trim();
    if (!trimmed || !rootFolderPath || !canAsk || scopeBlocked) return;

    setPrimaryTab("ask");
    setGenerating(true);
    setRetrieving(true);
    setAnswerMarkdown("");
    setCitations([]);

    try {
      const activeSettings = await resolveHydratedSettings();
      if (!(await ensureAskConfig(activeSettings))) return;

      let hits: RetrieveHit[] = [];
      try {
        hits = await retrieveAskVaultHits(buildRequest(activeSettings));
        setPendingHits(hits);
        setPreviewSnippets(hitsToPreviewSnippets(hits));
      } finally {
        setRetrieving(false);
      }

      if (hits.length === 0) {
        setSecondaryTab("sources");
        showNotification(t("askVault_noHits"), "info");
        return;
      }

      const result = await answerAskVaultFromHits(
        trimmed,
        hits,
        activeSettings,
      );
      setAnswerMarkdown(
        normalizeAskVaultCitationMarkers(result.answerMarkdown),
      );
      setCitations(result.citations);
      setSecondaryTab("answer");

      const historyItem: AskVaultHistoryItem = {
        id: `${Date.now()}`,
        question: trimmed,
        answer: result,
        at: Date.now(),
      };
      await appendAskVaultHistory(rootFolderPath, historyItem);
      setHistory((prev) => [historyItem, ...prev].slice(0, 50));
    } catch (error) {
      showNotification(
        error instanceof Error
          ? localizeKnownError(language, error.message)
          : t("askVault_failed"),
        "error",
      );
      setSettingsOpen(true, "ai");
    } finally {
      setRetrieving(false);
      setGenerating(false);
    }
  }, [
    question,
    rootFolderPath,
    canAsk,
    scopeBlocked,
    resolveHydratedSettings,
    ensureAskConfig,
    buildRequest,
    language,
    showNotification,
    setSettingsOpen,
    t,
  ]);

  const handleOpenCitation = useCallback(
    async (citation: AskVaultCitation) => {
      const file: FileNode = {
        id: citation.path,
        name: citation.path.split(/[/\\]/).pop() || citation.path,
        type: "file",
        path: citation.path,
      };
      await onOpenFile(file);
      try {
        const content = fileContents[citation.path] ?? (await readFile(file));
        const start = estimateLineOffset(content, citation.startLine);
        const end = estimateLineOffset(content, citation.endLine + 1);
        requestEditorRangeFocus(
          citation.path,
          start,
          Math.max(start + 1, end),
          {
            alignTopRatio: 0.25,
          },
        );
        if (citation.headingAnchor) {
          requestPreviewHeadingScroll(citation.path, citation.headingAnchor);
        }
      } catch {
        // Opening the file is still useful even if focus fails.
      }
    },
    [fileContents, onOpenFile, readFile],
  );

  const handleInsertAnswer = useCallback(() => {
    if (!currentFilePath || !answerMarkdown.trim()) {
      showNotification(t("askVault_insertNeedsNote"), "info");
      return;
    }
    const previous = fileContents[currentFilePath] ?? "";
    const selection = getActiveEditorSelection();
    let next: string;
    if (
      selection &&
      selection.tabId === currentFilePath &&
      selection.from !== selection.to
    ) {
      next =
        previous.slice(0, selection.from) +
        answerMarkdown.trim() +
        previous.slice(selection.to);
    } else if (selection && selection.tabId === currentFilePath) {
      next =
        previous.slice(0, selection.from) +
        `\n\n${answerMarkdown.trim()}\n` +
        previous.slice(selection.from);
    } else {
      next = `${previous.trimEnd()}\n\n${answerMarkdown.trim()}\n`;
    }
    setPendingAiResult({
      fileId: currentFilePath,
      previousContent: previous,
      newContent: next,
    });
  }, [
    answerMarkdown,
    currentFilePath,
    fileContents,
    setPendingAiResult,
    showNotification,
    t,
  ]);

  const restoreHistoryItem = useCallback((item: AskVaultHistoryItem) => {
    setQuestion(item.question);
    setAnswerMarkdown(
      normalizeAskVaultCitationMarkers(item.answer.answerMarkdown),
    );
    setCitations(item.answer.citations);
    setPreviewSnippets(
      item.answer.citations.map(
        (c) => `[${c.index}] ${c.relPath}\n${c.snippet}`,
      ),
    );
    setPendingHits([]);
    setPrimaryTab("ask");
    setSecondaryTab("answer");
  }, []);

  const handleAnswerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = (event.target as HTMLElement | null)?.closest(
        "[data-ask-cite]",
      ) as HTMLElement | null;
      if (!target) return;
      event.preventDefault();
      const index = Number(target.dataset.askCite);
      if (!Number.isFinite(index)) return;
      const citation = citations.find((item) => item.index === index);
      if (citation) {
        void handleOpenCitation(citation);
      }
    },
    [citations, handleOpenCitation],
  );

  if (!open) return null;

  const readinessBody = !rootFolderPath ? (
    <p>{t("askVault_needVault")}</p>
  ) : !aiReady ? (
    <p>
      {t("askVault_needAi")}{" "}
      <button type="button" onClick={() => setSettingsOpen(true, "ai")}>
        {t("askVault_openAiSettings")}
      </button>
    </p>
  ) : indexBuilding ? (
    <p>
      {t("askVault_indexBuilding", {
        done: linkIndexProgress.done,
        total: Math.max(linkIndexProgress.total, 1),
      })}
    </p>
  ) : chunkCount === 0 ? (
    <p>
      {t("askVault_indexEmpty")}{" "}
      <button
        type="button"
        onClick={() => {
          void requestVaultLinkIndexRebuild().catch(() => {
            setSettingsOpen(true, "index");
          });
        }}
      >
        {t("askVault_rebuildIndex")}
      </button>
    </p>
  ) : keywordOnly ? (
    <p>
      {t("askVault_keywordOnly")}{" "}
      <button type="button" onClick={() => setSettingsOpen(true, "index")}>
        {t("askVault_openIndexSettings")}
      </button>
    </p>
  ) : semanticReady ? (
    <p className="ask-vault-ready">{t("askVault_ready")}</p>
  ) : (
    <p>{t("askVault_readyKeyword")}</p>
  );

  const readinessSummary = blocked
    ? t("askVault_statusBlocked")
    : keywordOnly
      ? t("askVault_statusKeyword")
      : semanticReady
        ? t("askVault_statusReady")
        : t("askVault_statusKeyword");

  return (
    <aside
      ref={panelRef}
      className="ask-vault-module ui-scaled"
      style={{ width: `${width}px` }}
      aria-label={t("askVault_title")}
    >
      <div
        className="ask-vault-resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("askVault_resize")}
      />

      <div className="ask-vault-module-header right-rail-header">
        <div className="right-rail-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={primaryTab === "ask"}
            className={`right-rail-tab ${primaryTab === "ask" ? "active" : ""}`}
            onClick={() => setPrimaryTab("ask")}
          >
            {t("askVault_tabAsk")}
            {answerMarkdown || pendingHits.length > 0 ? (
              <span className="right-rail-tab-dot" aria-hidden />
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={primaryTab === "history"}
            className={`right-rail-tab ${primaryTab === "history" ? "active" : ""}`}
            onClick={() => setPrimaryTab("history")}
          >
            {t("askVault_history")}
            {history.length > 0 ? (
              <span className="ask-vault-tab-count" aria-hidden>
                {Math.min(history.length, 99)}
              </span>
            ) : null}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ask-vault-close"
          aria-label={t("common_done")}
        >
          ×
        </button>
      </div>

      {primaryTab === "ask" ? (
        <div className="ask-vault-ask-layout">
          <div className="ask-vault-readiness">
            <button
              type="button"
              className="ask-vault-readiness-toggle"
              aria-expanded={showReadinessDetail}
              onClick={() => setReadinessExpanded((v) => !v)}
            >
              <span
                className={`ask-vault-readiness-dot ${blocked ? "is-blocked" : keywordOnly ? "is-warn" : "is-ok"}`}
              />
              <span className="ask-vault-readiness-summary">
                {readinessSummary}
              </span>
              <span className="ask-vault-readiness-chevron" aria-hidden>
                {showReadinessDetail ? "▾" : "▸"}
              </span>
            </button>
            {showReadinessDetail ? (
              <div className="ask-vault-readiness-detail">{readinessBody}</div>
            ) : null}
          </div>

          <div className="ask-vault-ask-main">
            <div className="ask-vault-secondary-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={secondaryTab === "answer"}
                className={`ask-vault-secondary-tab ${secondaryTab === "answer" ? "active" : ""}`}
                onClick={() => setSecondaryTab("answer")}
              >
                {t("askVault_answer")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={secondaryTab === "sources"}
                className={`ask-vault-secondary-tab ${secondaryTab === "sources" ? "active" : ""}`}
                onClick={() => setSecondaryTab("sources")}
              >
                {t("askVault_sourcesTab")}
                {previewSnippets.length > 0 ? (
                  <span className="ask-vault-tab-count" aria-hidden>
                    {previewSnippets.length}
                  </span>
                ) : null}
              </button>
            </div>

            <div className="ask-vault-ask-scroll">
              {secondaryTab === "answer" ? (
                answerMarkdown ? (
                  <div className="ask-vault-answer">
                    <div
                      className="ask-vault-answer-body markdown-body"
                      dangerouslySetInnerHTML={{ __html: answerHtml }}
                      onClick={handleAnswerClick}
                    />
                    <div className="ask-vault-actions">
                      <button
                        type="button"
                        onClick={handleInsertAnswer}
                        disabled={!currentFilePath}
                        title={
                          !currentFilePath
                            ? t("askVault_insertNeedsNote")
                            : undefined
                        }
                      >
                        {t("askVault_insert")}
                      </button>
                    </div>
                    {citations.length > 0 ? (
                      <div className="ask-vault-citations">
                        <h4 className="links-section-title">
                          {t("askVault_citations")}
                        </h4>
                        {citations.map((citation) => (
                          <button
                            key={`${citation.index}-${citation.path}`}
                            type="button"
                            className="ask-vault-citation"
                            onClick={() => void handleOpenCitation(citation)}
                          >
                            <strong>[{citation.index}]</strong>{" "}
                            {citation.relPath}
                            <span>{citation.snippet}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="ask-vault-empty">{t("askVault_answerEmpty")}</p>
                )
              ) : previewSnippets.length > 0 ? (
                <div className="ask-vault-sources-preview">
                  <p className="ask-vault-sources-hint">
                    {t("askVault_sourcesHint")}
                  </p>
                  {previewSnippets.map((snippet, index) => (
                    <pre key={`${index}-${snippet.slice(0, 12)}`}>
                      {snippet}
                    </pre>
                  ))}
                </div>
              ) : (
                <p className="ask-vault-empty">{t("askVault_sourcesEmpty")}</p>
              )}
            </div>
          </div>

          <div className="ask-vault-composer">
            <AppSelect
              value={scope}
              aria-label={t("askVault_scope")}
              options={[
                { value: "vault", label: t("askVault_scopeVault") },
                {
                  value: "folder",
                  label: t("askVault_scopeFolder"),
                  disabled: !currentFilePath,
                },
                {
                  value: "files",
                  label: t("askVault_scopeCurrent"),
                  disabled: !currentFilePath,
                },
              ]}
              onChange={(next) => setScope(next as AskScope)}
            />
            {scopeBlocked ? (
              <p className="ask-vault-scope-hint">
                {t("askVault_scopeNeedsNote")}
              </p>
            ) : null}
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("askVault_placeholder")}
              rows={3}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleAsk();
                }
              }}
            />
            <div className="ask-vault-actions">
              <button
                type="button"
                className="ask-vault-primary"
                disabled={!canAsk || !question.trim() || scopeBlocked}
                onClick={() => void handleAsk()}
              >
                {retrieving
                  ? t("askVault_retrieving")
                  : generating
                    ? t("askVault_asking")
                    : t("askVault_ask")}
              </button>
              <button
                type="button"
                disabled={!canAsk || !question.trim() || scopeBlocked}
                onClick={() => void handleRetrieve()}
                title={t("askVault_retrieveHint")}
              >
                {retrieving && !generating
                  ? t("askVault_retrieving")
                  : t("askVault_retrieve")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="ask-vault-history-pane">
          {history.length === 0 ? (
            <p className="ask-vault-empty">{t("askVault_historyEmpty")}</p>
          ) : (
            <ul className="ask-vault-history-list">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="ask-vault-history-item"
                    onClick={() => restoreHistoryItem(item)}
                  >
                    <span className="ask-vault-history-question">
                      {item.question}
                    </span>
                    <span className="ask-vault-history-meta">
                      {formatHistoryTime(item.at, language)}
                      {item.answer.citations.length > 0
                        ? ` · ${t("askVault_historyCitations", {
                            count: item.answer.citations.length,
                          })}`
                        : ""}
                    </span>
                    <span className="ask-vault-history-snippet">
                      {item.answer.answerMarkdown
                        .replace(/\s+/g, " ")
                        .slice(0, 120)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
};
