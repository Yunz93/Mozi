import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCaseCoverage, requiredCases } from "./case-coverage.mjs";

test("desktop report rejects empty, missing, duplicate and failed cases", () => {
  const good = requiredCases.map((name) => ({ name, status: "passed" }));
  assert.doesNotThrow(() => assertCaseCoverage(good));
  assert.throws(() => assertCaseCoverage([]));
  assert.throws(() => assertCaseCoverage(good.slice(1)));
  assert.throws(() => assertCaseCoverage([...good, good[0]]));
  assert.throws(() =>
    assertCaseCoverage(
      good.map((row, index) => (index ? row : { ...row, status: "failed" })),
    ),
  );
});
