import { toForwardSlashes as normalizePath } from "../../utils/pathHelpers";
import {
  isCompatibleProvider,
  resolveCompatibleSettings,
} from "../ai/compatibleProviders";
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
  LEGACY_ASK_HISTORY_FILE,
  hashVaultId,
  hashLegacyVaultId,
  normalizeVaultIdentityPath,
  readIndexJson,
  readLegacyIndexJson,
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

function resolveModelLabel(settings: AppSettings): string {
  if (isCompatibleProvider(settings.aiProvider))
    return resolveCompatibleSettings(settings.aiProvider, settings).model;
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
    embeddingProvider:
      mode === "keyword" ? null : createEmbeddingProvider(request.settings),
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

const ASK_HISTORY_LS_PREFIX = "markdown-press.ask-history.v2.";
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

interface AskVaultHistoryEnvelope {
  version: 2;
  vaultRoot: string;
  items: AskVaultHistoryItem[];
}

function ownedHistory(
  value: unknown,
  vaultRoot: string,
): AskVaultHistoryItem[] | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<AskVaultHistoryEnvelope>;
  if (
    envelope.version !== 2 ||
    typeof envelope.vaultRoot !== "string" ||
    normalizeVaultIdentityPath(envelope.vaultRoot) !==
      normalizeVaultIdentityPath(vaultRoot) ||
    !Array.isArray(envelope.items)
  )
    return null;
  return parseAskVaultHistory(envelope.items);
}

function readLocalAskVaultHistory(
  vaultId: string,
  vaultRoot: string,
): AskVaultHistoryItem[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(askVaultHistoryLocalStorageKey(vaultId));
    if (!raw) return null;
    return ownedHistory(JSON.parse(raw), vaultRoot);
  } catch {
    return null;
  }
}

function writeLocalAskVaultHistory(
  vaultId: string,
  envelope: AskVaultHistoryEnvelope,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      askVaultHistoryLocalStorageKey(vaultId),
      JSON.stringify(envelope),
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
  await saveAskVaultHistory(vaultRoot, next);
}

async function saveAskVaultHistory(
  vaultRoot: string,
  items: AskVaultHistoryItem[],
): Promise<void> {
  const envelope: AskVaultHistoryEnvelope = { version: 2, vaultRoot, items };
  writeLocalAskVaultHistory(await hashVaultId(vaultRoot), envelope);
  await writeIndexJson(vaultRoot, ASK_HISTORY_FILE, envelope, "ask-history");
}

/** 旧数组没有库标识，只迁移全部引用都明确属于当前库的记录，原件不删除。 */
function attributableLegacyHistory(
  value: unknown,
  vaultRoot: string,
): AskVaultHistoryItem[] {
  const root = normalizeVaultIdentityPath(vaultRoot).replace(/\/+$/, "");
  return parseAskVaultHistory(value).filter(
    (item) =>
      Array.isArray(item.answer.citations) &&
      item.answer.citations.length > 0 &&
      item.answer.citations.every(
        (citation) =>
          !!citation &&
          typeof citation.path === "string" &&
          normalizeVaultIdentityPath(citation.path).startsWith(`${root}/`),
      ),
  );
}

export async function loadAskVaultHistory(
  vaultRoot: string,
): Promise<AskVaultHistoryItem[]> {
  const vaultId = await hashVaultId(vaultRoot);
  const fromDisk = ownedHistory(
    await readIndexJson<unknown>(vaultRoot, ASK_HISTORY_FILE, "ask-history"),
    vaultRoot,
  );
  if (fromDisk !== null) {
    writeLocalAskVaultHistory(vaultId, {
      version: 2,
      vaultRoot,
      items: fromDisk,
    });
    return fromDisk;
  }

  const fromLocal = readLocalAskVaultHistory(vaultId, vaultRoot);
  if (fromLocal !== null) {
    await saveAskVaultHistory(vaultRoot, fromLocal);
    return fromLocal;
  }

  const legacyDisk = await readLegacyIndexJson<unknown>(
    vaultRoot,
    LEGACY_ASK_HISTORY_FILE,
    "ask-history",
  );
  let legacyLocal: unknown = null;
  try {
    if (typeof localStorage !== "undefined") {
      legacyLocal = JSON.parse(
        localStorage.getItem(
          `markdown-press.ask-history.${await hashLegacyVaultId(vaultRoot)}`,
        ) ?? "null",
      );
    }
  } catch {
    /* 旧缓存损坏时仍尝试迁移磁盘副本。 */
  }
  const entries = [
    ...attributableLegacyHistory(legacyDisk, vaultRoot),
    ...attributableLegacyHistory(legacyLocal, vaultRoot),
  ];
  const seen = new Set<string>();
  const migrated: AskVaultHistoryItem[] = [];
  for (const item of entries) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    migrated.push(item);
    if (migrated.length === ASK_HISTORY_LIMIT) break;
  }
  if (migrated.length > 0) await saveAskVaultHistory(vaultRoot, migrated);
  return migrated;
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
