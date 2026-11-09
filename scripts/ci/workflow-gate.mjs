import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export function assertCiGate(needs) {
  for (const name of [
    "frontend-checks",
    "rust-tests",
    "linux-package",
    "native-watch",
  ])
    assert.equal(
      needs?.[name]?.result,
      "success",
      `Required CI job did not pass: ${name}`,
    );
  for (const [name, job] of Object.entries(needs))
    assert.equal(job.result, "success", `CI job did not pass: ${name}`);
}

export function assertDesktopGate(needs) {
  assert.equal(
    needs?.changes?.result,
    "success",
    "Desktop scope check did not pass",
  );
  const requested = needs.changes.outputs?.run_desktop;
  assert(
    ["true", "false"].includes(requested),
    "Desktop scope result is missing or invalid",
  );
  for (const name of ["desktop", "linux-upgrade"])
    assert.equal(
      needs[name]?.result,
      requested === "true" ? "success" : "skipped",
      `Required desktop job did not pass or was unexpectedly skipped: ${name}`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const needs = JSON.parse(process.env.NEEDS_RESULTS ?? "null");
  if (process.argv[2] === "ci") assertCiGate(needs);
  else if (process.argv[2] === "desktop") assertDesktopGate(needs);
  else throw new Error("Expected ci or desktop gate");
  console.log("All required workflow results passed.");
}
