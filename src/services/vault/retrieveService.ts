import type {
  ChunkIndexSnapshot,
  RetrieveHit,
  RetrieveOptions,
  TextChunk,
} from "../../types/vaultIndex";
import type { VectorStore } from "./vectorStore";
import type { EmbeddingProvider } from "./embeddingProvider";
import { pathMatchesAnyGlob } from "../../utils/pathGlob";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function normalizeSearchTarget(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u3000-\u303F\uFF00-\uFFEF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function listChunks(
  snapshot: ChunkIndexSnapshot | null,
  options: Pick<
    RetrieveOptions,
    "scope" | "folderPath" | "filePaths" | "excludePaths" | "excludeGlobs"
  > = {},
): TextChunk[] {
  if (!snapshot) return [];
  const exclude = new Set((options.excludePaths ?? []).map(normalizePath));
  const fileFilter = options.filePaths?.map(normalizePath);
  const folder = options.folderPath
    ? normalizePath(options.folderPath).replace(/\/+$/, "")
    : null;

  const all = Object.values(snapshot.byPath).flat();
  return all.filter((chunk) => {
    const path = normalizePath(chunk.path);
    if (exclude.has(path)) return false;
    if (pathMatchesAnyGlob(path, options.excludeGlobs, snapshot.vaultRoot)) {
      return false;
    }
    if (fileFilter && !fileFilter.includes(path)) return false;
    if (options.scope === "folder" && folder) {
      if (path !== folder && !path.startsWith(`${folder}/`)) return false;
    }
    return true;
  });
}

/** Tokenize NL queries for keyword fallback (spaces + CJK bigrams). */
export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchTarget(query);
  if (!normalized) return [];

  const tokens = new Set<string>();
  if (normalized.length >= 2) tokens.add(normalized);

  for (const part of normalized.split(" ").filter(Boolean)) {
    if (part.length >= 2) tokens.add(part);
    if (/[\u4e00-\u9fff]/.test(part)) {
      for (let i = 0; i < part.length - 1; i += 1) {
        tokens.add(part.slice(i, i + 2));
      }
      if (part.length >= 3) tokens.add(part);
    }
  }

  return [...tokens].filter((token) => token.length >= 2);
}

const LEADING_QUESTION_FILLERS =
  /^(请你|请帮我|帮我|请问|请|我想知道|想知道|麻烦|能否|能不能)\s*/u;
const TRAILING_QUESTION_FILLERS =
  /(是什么|是啥|怎么样|如何处理|如何|吗|呢|啊|呀|吧|[？?])+$/u;
const FOLLOW_UP_PREFIX =
  /^(那|还有|继续|这个|刚才|上次说|以及|and |also |what about|how about)/i;

/** Drop polite / interrogative wrappers so keyword search keeps content terms. */
export function stripSearchFillers(query: string): string {
  let next = normalizeSearchTarget(query);
  next = next.replace(LEADING_QUESTION_FILLERS, "").trim();
  next = next.replace(TRAILING_QUESTION_FILLERS, "").trim();
  return next;
}

export function isFollowUpQuestion(query: string): boolean {
  const text = query.trim();
  if (!text) return false;
  if ([...text].length <= 12) return true;
  return FOLLOW_UP_PREFIX.test(text);
}

/** Original query plus cleaned / follow-up-blended variants. */
export function expandSearchQueries(
  query: string,
  previousQuestion?: string,
): string[] {
  const queries: string[] = [];
  const add = (value: string) => {
    const next = value.trim();
    if (next && !queries.includes(next)) queries.push(next);
  };

  add(query);
  add(stripSearchFillers(query));

  const previous = previousQuestion?.trim();
  if (previous && isFollowUpQuestion(query)) {
    const prev = stripSearchFillers(previous) || previous;
    const curr = stripSearchFillers(query) || query.trim();
    if (prev && curr) add(`${prev} ${curr}`);
  }

  return queries;
}

export function diversifyHits(
  hits: RetrieveHit[],
  topK: number,
  maxPerPath: number,
): RetrieveHit[] {
  if (maxPerPath <= 0) return hits.slice(0, topK);
  const picked: RetrieveHit[] = [];
  const overflow: RetrieveHit[] = [];
  const counts = new Map<string, number>();

  for (const hit of hits) {
    const path = hit.chunk.path;
    const used = counts.get(path) ?? 0;
    if (used < maxPerPath) {
      picked.push(hit);
      counts.set(path, used + 1);
    } else {
      overflow.push(hit);
    }
    if (picked.length >= topK) return picked;
  }

  for (const hit of overflow) {
    picked.push(hit);
    if (picked.length >= topK) break;
  }
  return picked;
}

export function expandNeighborChunks(
  hits: RetrieveHit[],
  snapshot: ChunkIndexSnapshot,
  limit: number,
): RetrieveHit[] {
  const seen = new Set(hits.map((hit) => hit.chunk.id));
  const extras: RetrieveHit[] = [];

  for (const hit of hits) {
    const siblings = snapshot.byPath[hit.chunk.path] ?? [];
    const index = siblings.findIndex((chunk) => chunk.id === hit.chunk.id);
    if (index < 0) continue;
    for (const neighbor of [siblings[index - 1], siblings[index + 1]]) {
      if (!neighbor || seen.has(neighbor.id)) continue;
      seen.add(neighbor.id);
      extras.push({
        chunk: neighbor,
        score: hit.score * 0.92,
        source: hit.source,
      });
    }
  }

  return [...hits, ...extras].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function keywordSearchChunks(
  chunks: TextChunk[],
  query: string,
  topK = 12,
): RetrieveHit[] {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return [];

  const fullQuery = normalizeSearchTarget(query);
  const hits: RetrieveHit[] = [];
  for (const chunk of chunks) {
    const haystack = normalizeSearchTarget(
      `${chunk.titlePath.join(" ")} ${chunk.text}`,
    );
    let matched = 0;
    let firstIndex = haystack.length;
    for (const token of tokens) {
      const index = haystack.indexOf(token);
      if (index < 0) continue;
      matched += 1;
      firstIndex = Math.min(firstIndex, index);
    }
    if (matched === 0) continue;

    const coverage = matched / tokens.length;
    // Require at least one real token hit; prefer higher coverage + earlier match.
    const fullBonus = fullQuery && haystack.includes(fullQuery) ? 0.35 : 0;
    const score =
      coverage * 0.75 +
      fullBonus +
      0.25 / (1 + firstIndex / Math.max(haystack.length, 1));
    hits.push({ chunk, score, source: "keyword" });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

function rrfMerge(lists: RetrieveHit[][], topK: number, k = 60): RetrieveHit[] {
  const scores = new Map<string, { hit: RetrieveHit; score: number }>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const current = scores.get(hit.chunk.id);
      const add = 1 / (k + rank + 1);
      if (current) {
        current.score += add;
      } else {
        scores.set(hit.chunk.id, {
          hit: { ...hit, source: "hybrid" },
          score: add,
        });
      }
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ hit, score }) => ({ ...hit, score, source: "hybrid" as const }));
}

export async function retrieve(options: {
  query: string;
  chunkIndex: ChunkIndexSnapshot | null;
  vectorStore: VectorStore | null;
  embeddingProvider: EmbeddingProvider | null;
  retrieve: RetrieveOptions;
}): Promise<RetrieveHit[]> {
  const topK = options.retrieve.topK ?? 12;
  const candidateK = Math.max(
    topK,
    options.retrieve.maxChunksPerPath || options.retrieve.expandNeighbors
      ? topK * 3
      : topK,
  );
  const chunks = listChunks(options.chunkIndex, options.retrieve);
  const mode = options.retrieve.mode;
  const queries = expandSearchQueries(
    options.query,
    options.retrieve.previousQuestion,
  );

  const keywordHits =
    mode === "semantic"
      ? []
      : rrfMerge(
          queries.map((query) =>
            keywordSearchChunks(chunks, query, candidateK),
          ),
          candidateK,
        ).map((hit) => ({ ...hit, source: "keyword" as const }));

  if (mode === "keyword") {
    return finalizeHits(
      keywordHits,
      options.chunkIndex,
      options.retrieve,
      topK,
    );
  }

  const canEmbed =
    !!options.embeddingProvider &&
    options.embeddingProvider.id !== "none" &&
    !!options.vectorStore &&
    options.vectorStore.size() > 0;

  if (!canEmbed) {
    return finalizeHits(
      keywordHits,
      options.chunkIndex,
      options.retrieve,
      topK,
    );
  }

  try {
    const embedQueries =
      queries.length > 1
        ? [queries[0]!, queries[queries.length - 1]!]
        : queries;
    const uniqueEmbedQueries = [...new Set(embedQueries)];
    const queryVectors =
      await options.embeddingProvider!.embed(uniqueEmbedQueries);
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const vectorLists: RetrieveHit[][] = [];

    for (const queryVector of queryVectors) {
      const vectorHitsRaw = options.vectorStore!.search(
        queryVector,
        candidateK * 2,
      );
      const vectorHits: RetrieveHit[] = [];
      for (const { id, score } of vectorHitsRaw) {
        const chunk = chunkById.get(id);
        if (!chunk) continue;
        vectorHits.push({ chunk, score, source: "vector" });
        if (vectorHits.length >= candidateK) break;
      }
      vectorLists.push(vectorHits);
    }

    const vectorHits =
      vectorLists.length === 1
        ? vectorLists[0]!
        : rrfMerge(vectorLists, candidateK).map((hit) => ({
            ...hit,
            source: "vector" as const,
          }));

    if (mode === "semantic") {
      return finalizeHits(
        vectorHits,
        options.chunkIndex,
        options.retrieve,
        topK,
      );
    }
    return finalizeHits(
      rrfMerge([keywordHits, vectorHits], candidateK),
      options.chunkIndex,
      options.retrieve,
      topK,
    );
  } catch {
    return finalizeHits(
      keywordHits,
      options.chunkIndex,
      options.retrieve,
      topK,
    );
  }
}

function finalizeHits(
  hits: RetrieveHit[],
  snapshot: ChunkIndexSnapshot | null,
  options: RetrieveOptions,
  topK: number,
): RetrieveHit[] {
  let next = hits;
  if (options.expandNeighbors && snapshot) {
    next = expandNeighborChunks(
      next,
      snapshot,
      Math.max(topK * 2, next.length),
    );
  }
  if (options.maxChunksPerPath && options.maxChunksPerPath > 0) {
    return diversifyHits(next, topK, options.maxChunksPerPath);
  }
  return next.slice(0, topK);
}
