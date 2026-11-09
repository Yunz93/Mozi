import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const requiredCases = JSON.parse(
  readFileSync(new URL("./case-manifest.json", import.meta.url), "utf8"),
);

export function assertCaseCoverage(cases) {
  assert(Array.isArray(cases), "Desktop case results are missing");
  const names = cases.map((entry) => entry.name);
  assert.equal(
    new Set(names).size,
    names.length,
    "Duplicate desktop case names",
  );
  assert.deepEqual(
    new Set(names),
    new Set(requiredCases),
    "Desktop acceptance cases are incomplete",
  );
  assert(
    cases.every((entry) => entry.status === "passed"),
    "A desktop case did not pass",
  );
}
