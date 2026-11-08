import { createServer } from "vite";
import { performance } from "node:perf_hooks";
import { cpus, platform, arch, release } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { makeVault, writeFixtures } from "./fixtures.mjs";

const args = process.argv.slice(2);
if (args[0] === "--fixtures") {
  if (!args[1]) throw new Error("Provide a destination folder");
  await writeFixtures(args[1]);
  console.log(`Generated fixtures in ${args[1]}`);
} else {
  const counts = (process.env.PERF_COUNTS ?? "100,1000,10000")
    .split(",")
    .map(Number);
  const rounds = Number(process.env.PERF_ROUNDS ?? 3);
  if (
    !counts.every((n) => Number.isSafeInteger(n) && n > 0) ||
    !Number.isSafeInteger(rounds) ||
    rounds < 1
  )
    throw new Error("Invalid benchmark sizes/rounds");
  const server = await createServer({
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [], entries: [] },
    appType: "custom",
  });
  try {
    const { buildVaultIndexes } = await server.ssrLoadModule(
      "/src/services/vault/buildVaultIndexes.ts",
    );
    const { VectorStore } = await server.ssrLoadModule(
      "/src/services/vault/vectorStore.ts",
    );
    const rows = [];
    for (const count of counts) {
      const vault = makeVault(count);
      for (let round = 0; round < rounds; round++) {
        let reads = 0;
        const readFile = async (p) => {
          reads++;
          return vault.readFile(p);
        };
        const started = performance.now();
        const options = { files: vault.files, vaultRoot: vault.root, readFile };
        const { linkIndex, chunkIndex } = await buildVaultIndexes(options);
        rows.push({
          operation: "full-index",
          count,
          round,
          ms: performance.now() - started,
          reads,
          links: Object.keys(linkIndex.outbounds).length,
          chunks: Object.values(chunkIndex.byPath).flat().length,
          heapBytes: process.memoryUsage().heapUsed,
        });
      }
    }
    for (const count of [1000, 10000, 50000]) {
      const store = new VectorStore();
      store.upsert(
        Array.from({ length: count }, (_, i) => ({
          id: String(i),
          contentHash: String(i),
          values: Float32Array.from({ length: 384 }, (_, d) => Math.sin(i + d)),
        })),
      );
      const query = Float32Array.from({ length: 384 }, (_, d) => Math.sin(d));
      store.search(query, 10); // warm-up, excluded
      for (let round = 0; round < rounds; round++) {
        const started = performance.now();
        const hits = store.search(query, 10);
        rows.push({
          operation: "vector-top10",
          count,
          round,
          ms: performance.now() - started,
          hits: hits.length,
          heapBytes: process.memoryUsage().heapUsed,
        });
      }
    }
    const result = {
      schema: 1,
      git: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      timestamp: new Date().toISOString(),
      runtime: {
        platform: platform(),
        release: release(),
        arch: arch(),
        node: process.version,
        cpu: cpus()[0]?.model,
      },
      scope:
        "Node/Vite SSR; excludes disk, WebView, native UI, embedding model",
      rows,
    };
    await mkdir(".perf", { recursive: true });
    const output = process.env.PERF_OUTPUT ?? ".perf/core.json";
    await writeFile(output, JSON.stringify(result, null, 2));
    console.log(`Wrote ${rows.length} measurements to ${output}`);
  } finally {
    await server.close();
  }
}
