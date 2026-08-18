/** Vault link-index / retrieval shared types (Phase 1+). */

export type WikiSubpathType = "heading" | "block" | null;

/** One outbound [[wiki]] / ![[embed]] occurrence in a source note. */
export interface WikiOutboundLink {
  sourcePath: string;
  raw: string;
  targetRaw: string;
  displayText: string;
  resolvedPath: string | null;
  isEmbed: boolean;
  subpath: string;
  subpathType: WikiSubpathType;
  startOffset: number;
  endOffset: number;
}

export interface LinkIndexSnapshot {
  version: 1;
  vaultRoot: string;
  builtAt: number;
  /** sourcePath -> outbound links */
  outbounds: Record<string, WikiOutboundLink[]>;
  /** resolvedPath -> sourcePaths that link to it */
  inbounds: Record<string, string[]>;
  /** unresolved targetRaw -> sourcePaths */
  unresolved: Record<string, string[]>;
}

export interface LinkIndexProgress {
  phase: "idle" | "building" | "updating" | "error";
  done: number;
  total: number;
  currentPath: string | null;
  error: string | null;
  builtAt: number | null;
}

export interface BacklinkGroup {
  sourcePath: string;
  links: WikiOutboundLink[];
}

export type SearchMode = "keyword" | "semantic" | "hybrid";
export type EmbeddingProviderId = "none" | "builtin" | "openai-compatible";

export interface TextChunk {
  id: string;
  path: string;
  relPath: string;
  titlePath: string[];
  headingAnchor: string | null;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
}

export interface ChunkIndexSnapshot {
  version: 1;
  vaultRoot: string;
  builtAt: number;
  /** path -> chunks */
  byPath: Record<string, TextChunk[]>;
}

export interface RetrieveHit {
  chunk: TextChunk;
  score: number;
  source: "keyword" | "vector" | "hybrid";
}

export interface RetrieveOptions {
  mode: SearchMode;
  scope?: "vault" | "folder" | "files";
  folderPath?: string | null;
  filePaths?: string[];
  topK?: number;
  excludePaths?: string[];
  excludeGlobs?: string[];
}

export interface AskVaultCitation {
  index: number;
  path: string;
  relPath: string;
  titlePath: string[];
  snippet: string;
  startLine: number;
  endLine: number;
  headingAnchor: string | null;
}

export interface AskVaultAnswer {
  answerMarkdown: string;
  citations: AskVaultCitation[];
  usedChunkIds: string[];
  model: string;
  retrievedAt: number;
}
