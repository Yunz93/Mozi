import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const keyOf = (row) => `${row.mode}/${row.count}/${row.windows}`;
const positive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function comparePerformance(report, baseline, full) {
  assert.equal(
    report.status,
    "passed",
    "Performance report is incomplete or failed",
  );
  const profile = baseline.profiles?.[`${report.platform}/${report.arch}`];
  assert(
    profile,
    "No measured baseline exists for this platform and architecture",
  );
  const expected = ["poll", "native"].flatMap((mode) =>
    (full ? [100, 1000, 10000] : [100]).flatMap((count) =>
      (full ? [1, 2, 5] : [1]).map((windows) => `${mode}/${count}/${windows}`),
    ),
  );
  const rows = report.performance;
  assert(
    Array.isArray(rows) && rows.length === expected.length,
    "Performance matrix is incomplete",
  );
  assert.deepEqual(
    new Set(rows.map(keyOf)),
    new Set(expected),
    "Performance matrix has missing, duplicate or unexpected cases",
  );
  const comparisons = [];
  for (const row of rows) {
    const key = keyOf(row);
    const before = profile.cases[key];
    assert(before, `Measured case baseline is missing: ${key}`);
    assert.equal(
      row.memory?.metric,
      profile.memoryMetric,
      "Memory metrics cannot be compared across platforms",
    );
    const measurements = {
      restoreMs: row.restoreMs,
      firstIndexMs: row.firstIndexMs,
      medianMs: row.medianMs,
      maxMs: row.maxMs,
      memoryBytes: row.memory?.bytes,
    };
    for (const [metric, value] of Object.entries(measurements)) {
      assert(
        positive(value) && positive(before[metric]),
        `Invalid ${metric} measurement: ${key}`,
      );
      const limit =
        metric === "memoryBytes"
          ? before[metric] * baseline.policy.memoryRatio +
            baseline.policy.memoryAllowanceBytes
          : before[metric] * baseline.policy.timeRatio +
            baseline.policy.timeAllowanceMs;
      assert(positive(limit), "Invalid regression policy");
      comparisons.push({
        case: key,
        metric,
        measured: value,
        baseline: before[metric],
        limit,
        passed: value <= limit,
      });
    }
  }
  return {
    passed: comparisons.every((entry) => entry.passed),
    source: report.source,
    baselineSource: baseline.source,
    baselineRun: baseline.run,
    comparisons,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const output = process.env.MOZI_DESKTOP_OUTPUT ?? ".perf/desktop";
  try {
    const report = JSON.parse(
      readFileSync(join(output, "results.json"), "utf8"),
    );
    const baseline = JSON.parse(
      readFileSync(
        new URL("./performance-baseline.json", import.meta.url),
        "utf8",
      ),
    );
    const result = comparePerformance(
      report,
      baseline,
      process.env.MOZI_DESKTOP_PERFORMANCE === "full",
    );
    writeFileSync(
      join(output, "performance-comparison.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    assert(
      result.passed,
      `Performance regression: ${result.comparisons
        .filter((row) => !row.passed)
        .map(
          (row) => `${row.case} ${row.metric}: ${row.measured} > ${row.limit}`,
        )
        .join("; ")}`,
    );
    console.log(
      `Performance regression gate passed: ${result.comparisons.length} measurements`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
