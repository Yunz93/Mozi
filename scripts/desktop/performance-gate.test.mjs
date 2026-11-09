import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePerformance } from "./performance-gate.mjs";

function fixture(full = true) {
  const performance = ["poll", "native"].flatMap((mode) =>
    (full ? [100, 1000, 10000] : [100]).flatMap((count) =>
      (full ? [1, 2, 5] : [1]).map((windows) => ({
        mode,
        count,
        windows,
        restoreMs: 100,
        firstIndexMs: 200,
        medianMs: 100,
        maxMs: 200,
        memory: { metric: "rss", bytes: 100_000_000 },
      })),
    ),
  );
  const cases = Object.fromEntries(
    performance.map((row) => [
      `${row.mode}/${row.count}/${row.windows}`,
      { ...row, memoryBytes: row.memory.bytes },
    ]),
  );
  return {
    report: { status: "passed", platform: "linux", arch: "x64", performance },
    baseline: {
      source: "test source",
      run: 1,
      policy: {
        timeRatio: 2,
        timeAllowanceMs: 1000,
        memoryRatio: 1.5,
        memoryAllowanceBytes: 134217728,
      },
      profiles: { "linux/x64": { memoryMetric: "rss", cases } },
    },
  };
}

test("performance gate checks all full matrix measurements and smoke subset", () => {
  const full = fixture();
  assert.equal(
    comparePerformance(full.report, full.baseline, true).comparisons.length,
    90,
  );
  assert(comparePerformance(full.report, full.baseline, true).passed);
  const smoke = fixture(false);
  assert.equal(
    comparePerformance(smoke.report, full.baseline, false).comparisons.length,
    10,
  );
});

test("performance gate rejects partial, duplicate, failed or invalid reports", () => {
  for (const mutate of [
    (r) => {
      r.performance.pop();
    },
    (r) => {
      r.performance[0] = r.performance[1];
    },
    (r) => {
      r.status = "failed";
    },
    (r) => {
      r.performance[0].medianMs = null;
    },
    (r) => {
      r.performance[0].memory.metric = "working-set";
    },
    (r) => {
      r.arch = "unmeasured";
    },
  ]) {
    const f = fixture();
    mutate(f.report);
    assert.throws(() => comparePerformance(f.report, f.baseline, true));
  }
});

test("performance gate fails actual time or memory regressions", () => {
  for (const metric of ["medianMs", "memoryBytes"]) {
    const f = fixture();
    if (metric === "memoryBytes") f.report.performance[0].memory.bytes *= 10;
    else f.report.performance[0][metric] *= 30;
    const result = comparePerformance(f.report, f.baseline, true);
    assert.equal(result.passed, false);
    assert(
      result.comparisons.some(
        (entry) => entry.metric === metric && !entry.passed,
      ),
    );
  }
});
