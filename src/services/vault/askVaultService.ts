import type { AppSettings } from "../../types";
import type {
  AskVaultAnswer,
  AskVaultCitation,
  RetrieveHit,
  RetrieveOptions,
  TextChunk,
} from "../../types/vaultIndex";
import { buildAskVaultPrompt } from "../ai/prompts";
import { completeJsonWithProvider, ensureAIConfiguration } from "../aiService";
import { createEmbeddingProvider } from "./embeddingProvider";
import { retrieve } from "./retrieveService";
import {
  getActiveChunkIndex,
  getActiveVectorStore,
} from "./semanticIndexRuntime";
import {
  ASK_HISTORY_FILE,
  hashVaultId,
  readIndexJson,
  writeIndexJson,
} from "./indexStorage";

export interface AskVaultRequest {
  question: string;
  settings: AppSettings;
  scope?: RetrieveOptions["scope"];
  folderPath?: string | null;
  filePaths?: string[];
  topK?: number;
  previousQuestion?: string;
}

interface AskVaultModelResponse {
  answerMarkdown?: string;
  citationIndexes?: number[];
}

export const ASK_VAULT_SYSTEM_PROMPT =
  "You are XiaoZhi (小知助手). Answer questions ONLY using the provided numbered knowledge-base excerpts. Do not invent facts. Cite sources with [n] markers. If the excerpts are insufficient, say you could not find enough information in the vault.";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function resolveModelLabel(settings: AppSettings): string {
  return settings.aiProvider === "codex"
    ? settings.codexModel || "codex"
    : settings.aiProvider === "deepseek"
      ? settings.deepseekModel || "deepseek"
      : settings.geminiModel || "gemini";
}

function emptyAnswer(
  settings: AppSettings,
  messageZh: string,
  messageEn: string,
): AskVaultAnswer {
  return {
    answerMarkdown: settings.language === "en" ? messageEn : messageZh,
    citations: [],
    usedChunkIds: [],
    model: resolveModelLabel(settings),
    retrievedAt: Date.now(),
  };
}

function toCitations(
  chunks: TextChunk[],
  indexes: number[],
): AskVaultCitation[] {
  const byIndex = new Map(chunks.map((chunk, i) => [i + 1, chunk]));
  const unique = [...new Set(indexes.filter((n) => Number.isFinite(n)))];
  return unique
    .map((index) => {
      const chunk = byIndex.get(index);
      if (!chunk) return null;
      return {
        index,
        path: chunk.path,
        relPath: chunk.relPath,
        titlePath: chunk.titlePath,
        snippet: chunk.text.slice(0, 240),
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        headingAnchor: chunk.headingAnchor,
      } satisfies AskVaultCitation;
    })
    .filter((item): item is AskVaultCitation => item !== null);
}

function citationIndexesFromAnswer(
  answerMarkdown: string,
  maxIndex: number,
): number[] {
  const found = new Set<number>();
  const re = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answerMarkdown)) !== null) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index >= 1 && index <= maxIndex) {
      found.add(index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export async function retrieveAskVaultHits(
  request: AskVaultRequest,
): Promise<RetrieveHit[]> {
  const chunkIndex = getActiveChunkIndex();
  const mode =
    (request.settings.embeddingProvider ?? "builtin") === "none"
      ? "keyword"
      : (request.settings.searchModeDefault ?? "hybrid");

  return retrieve({
    query: request.question,
    chunkIndex,
    vectorStore: getActiveVectorStore(),
    embeddingProvider: createEmbeddingProvider(request.settings),
    retrieve: {
      mode,
      scope: request.scope ?? "vault",
      folderPath: request.folderPath,
      filePaths: request.filePaths,
      excludeGlobs: request.settings.indexExcludeGlobs,
      topK: request.topK ?? 8,
      previousQuestion: request.previousQuestion,
      maxChunksPerPath: 2,
      expandNeighbors: true,
    },
  });
}

export async function answerAskVaultFromHits(
  question: string,
  hits: RetrieveHit[],
  settings: AppSettings,
  previousQuestion?: string,
): Promise<AskVaultAnswer> {
  ensureAIConfiguration(settings);

  if (hits.length === 0) {
    return emptyAnswer(
      settings,
      "知识库中未找到与问题相关的内容。",
      "I could not find relevant notes in this knowledge base.",
    );
  }

  const promptChunks = hits.map((hit, index) => ({
    index: index + 1,
    path: hit.chunk.relPath || hit.chunk.path,
    titlePath: hit.chunk.titlePath,
    startLine: hit.chunk.startLine,
    endLine: hit.chunk.endLine,
    text: hit.chunk.text,
  }));

  const prompt = buildAskVaultPrompt(question, promptChunks, previousQuestion);
  const raw = await completeJsonWithProvider<AskVaultModelResponse>(
    prompt,
    settings,
    {
      systemPrompt: ASK_VAULT_SYSTEM_PROMPT,
      useAskVaultGeminiSchema: true,
    },
  );

  const answerMarkdown = (raw.answerMarkdown || "").trim();
  const fromModel =
    Array.isArray(raw.citationIndexes) && raw.citationIndexes.length > 0
      ? raw.citationIndexes
      : [];
  const citationIndexes =
    fromModel.length > 0
      ? fromModel
      : citationIndexesFromAnswer(answerMarkdown, promptChunks.length);

  return {
    answerMarkdown:
      answerMarkdown ||
      (settings.language === "en"
        ? "No answer was generated."
        : "未能生成回答。"),
    citations: toCitations(
      hits.map((hit) => hit.chunk),
      citationIndexes,
    ),
    usedChunkIds: hits.map((hit) => hit.chunk.id),
    model: resolveModelLabel(settings),
    retrievedAt: Date.now(),
  };
}

export async function askVault(
  request: AskVaultRequest,
): Promise<AskVaultAnswer> {
  ensureAIConfiguration(request.settings);
  const hits = await retrieveAskVaultHits(request);
  return answerAskVaultFromHits(
    request.question,
    hits,
    request.settings,
    request.previousQuestion,
  );
}

export interface AskVaultHistoryItem {
  id: string;
  question: string;
  answer: AskVaultAnswer;
  at: number;
}

const ASK_HISTORY_LS_PREFIX = "markdown-press.ask-history.";
const ASK_HISTORY_LIMIT = 50;

export function askVaultHistoryLocalStorageKey(vaultId: string): string {
  return `${ASK_HISTORY_LS_PREFIX}${vaultId}`;
}

function isHistoryItem(value: unknown): value is AskVaultHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as AskVaultHistoryItem;
  return (
    typeof item.id === "string" &&
    typeof item.question === "string" &&
    typeof item.at === "number" &&
    Boolean(item.answer) &&
    typeof item.answer.answerMarkdown === "string"
  );
}

export function parseAskVaultHistory(value: unknown): AskVaultHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isHistoryItem).slice(0, ASK_HISTORY_LIMIT);
}

function readLocalAskVaultHistory(vaultId: string): AskVaultHistoryItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(askVaultHistoryLocalStorageKey(vaultId));
    if (!raw) return [];
    return parseAskVaultHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeLocalAskVaultHistory(
  vaultId: string,
  items: AskVaultHistoryItem[],
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      askVaultHistoryLocalStorageKey(vaultId),
      JSON.stringify(items),
    );
  } catch {
    // Quota or private mode — disk persist is the primary copy.
  }
}

export async function appendAskVaultHistory(
  vaultRoot: string,
  item: AskVaultHistoryItem,
): Promise<void> {
  const existing = await loadAskVaultHistory(vaultRoot);
  const next = [
    item,
    ...existing.filter((entry) => entry.id !== item.id),
  ].slice(0, ASK_HISTORY_LIMIT);
  const vaultId = await hashVaultId(vaultRoot);
  writeLocalAskVaultHistory(vaultId, next);
  await writeIndexJson(vaultRoot, ASK_HISTORY_FILE, next, "ask-history");
}

export async function loadAskVaultHistory(
  vaultRoot: string,
): Promise<AskVaultHistoryItem[]> {
  const vaultId = await hashVaultId(vaultRoot);
  const fromDisk = parseAskVaultHistory(
    await readIndexJson<unknown>(vaultRoot, ASK_HISTORY_FILE, "ask-history"),
  );
  if (fromDisk.length > 0) {
    writeLocalAskVaultHistory(vaultId, fromDisk);
    return fromDisk;
  }

  const fromLocal = readLocalAskVaultHistory(vaultId);
  if (fromLocal.length > 0) {
    await writeIndexJson(vaultRoot, ASK_HISTORY_FILE, fromLocal, "ask-history");
  }
  return fromLocal;
}

export function estimateLineOffset(
  content: string,
  lineNumber: number,
): number {
  if (lineNumber <= 1) return 0;
  const lines = content.split(/\r?\n/);
  const usesCrlf = content.includes("\r\n");
  const breakLen = usesCrlf ? 2 : 1;
  let offset = 0;
  for (let i = 0; i < Math.min(lines.length, lineNumber - 1); i += 1) {
    offset += lines[i]!.length + breakLen;
  }
  return offset;
}

export function citationEditorRange(
  content: string,
  startLine: number,
  endLine: number,
): { start: number; end: number } {
  const start = estimateLineOffset(content, startLine);
  const end = estimateLineOffset(content, endLine + 1);
  return { start, end: Math.max(start + 1, end) };
}

export function normalizeAskVaultPath(path: string): string {
  return normalizePath(path);
}

export interface AskVaultPreviewSnippet {
  index: number;
  path: string;
  relPath: string;
  titlePath: string[];
  headingAnchor: string | null;
  startLine: number;
  endLine: number;
  snippet: string;
}

export function hitsToPreviewItems(
  hits: RetrieveHit[],
): AskVaultPreviewSnippet[] {
  return hits.map((hit, index) => ({
    index: index + 1,
    path: hit.chunk.path,
    relPath: hit.chunk.relPath || hit.chunk.path,
    titlePath: hit.chunk.titlePath,
    headingAnchor: hit.chunk.headingAnchor,
    startLine: hit.chunk.startLine,
    endLine: hit.chunk.endLine,
    snippet: hit.chunk.text.slice(0, 240),
  }));
}

export function hitsToPreviewSnippets(hits: RetrieveHit[]): string[] {
  return hitsToPreviewItems(hits).map(
    (item) => `[${item.index}] ${item.relPath}\n${item.snippet}`,
  );
}

export function previewItemToCitation(
  item: AskVaultPreviewSnippet,
): AskVaultCitation {
  return {
    index: item.index,
    path: item.path,
    relPath: item.relPath,
    titlePath: item.titlePath,
    snippet: item.snippet,
    startLine: item.startLine,
    endLine: item.endLine,
    headingAnchor: item.headingAnchor,
  };
}

export type AskVaultSubmitKind = "reuseHits" | "retrieveThenGenerate";

/**
 * Generate answer always answers in one click.
 * After optional "Retrieve only", the same question can reuse those hits.
 */
export function resolveAskVaultSubmitKind(options: {
  question: string;
  lastPreviewedQuestion: string | null;
  pendingHitCount: number;
}): AskVaultSubmitKind {
  const question = options.question.trim();
  if (
    question.length > 0 &&
    options.pendingHitCount > 0 &&
    options.lastPreviewedQuestion === question
  ) {
    return "reuseHits";
  }
  return "retrieveThenGenerate";
}
