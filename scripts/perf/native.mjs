import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const result = spawnSync(
  process.env.CARGO ?? "cargo",
  [
    "run",
    "--locked",
    "--release",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "-p",
    "mozi-vault-watch",
    "--example",
    "observation_perf",
    "--",
    ...args,
  ],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const report = JSON.parse(result.stdout);
report.commit = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();
report.workingTreeDirty =
  spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).stdout.trim().length > 0;
report.recordedAt = new Date().toISOString();
await mkdir(".perf/native", { recursive: true });
await writeFile(
  ".perf/native/latest.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "Saved .perf/native/latest.json (broker timings only; excludes IPC/UI)",
);
for (const row of report.results) {
  console.log(
    `${row.notes} notes / ${row.modeledWindows} modeled windows: watchers=${row.sharedWatchers}, p95=${row.journalVisibleLatencyMs.p95.toFixed(1)}ms, idle batches=${row.idleBatches}`,
  );
}
