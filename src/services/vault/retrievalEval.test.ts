import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkMarkdownFile } from "./chunkService";
import { keywordSearchChunks, listChunks } from "./retrieveService";
import type { ChunkIndexSnapshot } from "../../types/vaultIndex";

interface EvalQuery {
  id: string;
  query: string;
  expectAnyPath: string[];
}

interface EvalManifest {
  version: number;
  topK: number;
  minHitRate: number;
  vault: string;
  queries: EvalQuery[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, "../../../docs/fixtures/retrieval-eval");

function loadManifest(): EvalManifest {
  return JSON.parse(
    readFileSync(path.join(evalRoot, "queries.json"), "utf8"),
  ) as EvalManifest;
}

function buildSnapshot(vaultDir: string): ChunkIndexSnapshot {
  const vaultRoot = path.resolve(vaultDir);
  const byPath: ChunkIndexSnapshot["byPath"] = {};
  for (const name of readdirSync(vaultRoot)) {
    if (!/\.(md|markdown)$/i.test(name)) continue;
    const filePath = path.join(vaultRoot, name);
    const content = readFileSync(filePath, "utf8");
    byPath[filePath] = chunkMarkdownFile({
      path: filePath,
      vaultRoot,
      content,
    });
  }
  return {
    version: 1,
    vaultRoot,
    builtAt: Date.now(),
    byPath,
  };
}

describe("retrieval-eval fixture", () => {
  it("meets keyword hit-rate gate on sample vault queries", () => {
    const manifest = loadManifest();
    const snapshot = buildSnapshot(path.join(evalRoot, manifest.vault));
    const chunks = listChunks(snapshot);
    expect(chunks.length).toBeGreaterThan(0);

    const failures: string[] = [];
    let hits = 0;

    for (const item of manifest.queries) {
      const ranked = keywordSearchChunks(chunks, item.query, manifest.topK);
      const relPaths = ranked.map((hit) =>
        hit.chunk.relPath.replace(/\\/g, "/"),
      );
      const ok = item.expectAnyPath.some((expected) =>
        relPaths.includes(expected),
      );
      if (ok) {
        hits += 1;
      } else {
        failures.push(
          `${item.id} query="${item.query}" expected one of [${item.expectAnyPath.join(", ")}] got [${relPaths.join(", ") || "(none)"}]`,
        );
      }
    }

    const hitRate = hits / manifest.queries.length;
    expect(
      hitRate,
      `hitRate=${hitRate.toFixed(2)} failures:\n${failures.join("\n")}`,
    ).toBeGreaterThanOrEqual(manifest.minHitRate);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
