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
  const chunks = listChunks(options.chunkIndex, options.retrieve);
  const mode = options.retrieve.mode;

  const keywordHits =
    mode === "semantic" ? [] : keywordSearchChunks(chunks, options.query, topK);

  if (mode === "keyword") {
    return keywordHits;
  }

  const canEmbed =
    !!options.embeddingProvider &&
    options.embeddingProvider.id !== "none" &&
    !!options.vectorStore &&
    options.vectorStore.size() > 0;

  if (!canEmbed) {
    return keywordHits;
  }

  try {
    const [queryVector] = await options.embeddingProvider!.embed([
      options.query,
    ]);
    const vectorHitsRaw = options.vectorStore!.search(queryVector, topK * 2);
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const vectorHits: RetrieveHit[] = [];
    for (const { id, score } of vectorHitsRaw) {
      const chunk = chunkById.get(id);
      if (!chunk) continue;
      vectorHits.push({ chunk, score, source: "vector" });
      if (vectorHits.length >= topK) break;
    }

    if (mode === "semantic") {
      return vectorHits;
    }
    return rrfMerge([keywordHits, vectorHits], topK);
  } catch {
    return keywordHits;
  }
}
