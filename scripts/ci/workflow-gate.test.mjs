import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { requiresDesktop } from "./desktop-scope.mjs";
import { assertCiGate, assertDesktopGate } from "./workflow-gate.mjs";

test("desktop scope skips only known documentation changes and fails closed", () => {
  assert.equal(
    requiresDesktop("pull_request", ["docs/guide.md", "README.md"]),
    false,
  );
  for (const path of [
    "src/App.tsx",
    "src-tauri/Cargo.toml",
    "scripts/ci/workflow-gate.mjs",
    "scripts/desktop/run.mjs",
    "package-lock.json",
    "vitest.config.ts",
    "public/fonts/new-font.woff2",
    ".npmrc",
    ".github/workflows/release.yml",
  ])
    assert.equal(requiresDesktop("pull_request", [path]), true, path);
  assert.equal(requiresDesktop("push", null), true);
  assert.equal(requiresDesktop("schedule", []), true);
  assert.equal(requiresDesktop("workflow_dispatch", []), true);
  assert.equal(requiresDesktop("unknown", []), true);
});

test("CI gate rejects failure, cancellation, skip and missing results", () => {
  const good = Object.fromEntries(
    ["frontend-checks", "rust-tests", "linux-package", "native-watch"].map(
      (name) => [name, { result: "success" }],
    ),
  );
  assert.doesNotThrow(() => assertCiGate(good));
  for (const result of ["failure", "cancelled", "skipped", undefined])
    assert.throws(() => assertCiGate({ ...good, "rust-tests": { result } }));
  assert.throws(() => assertCiGate({}));
  assert.throws(() => assertCiGate({ ...good, added: { result: "failure" } }));
});

test("desktop gate allows documentation skips but never skips requested tests", () => {
  const result = (requested, state) => ({
    changes: { result: "success", outputs: { run_desktop: requested } },
    desktop: { result: state },
    "linux-upgrade": { result: state },
  });
  assert.doesNotThrow(() => assertDesktopGate(result("true", "success")));
  assert.doesNotThrow(() => assertDesktopGate(result("false", "skipped")));
  for (const state of ["failure", "cancelled", "skipped", undefined])
    assert.throws(() => assertDesktopGate(result("true", state)));
  assert.throws(() => assertDesktopGate(result(undefined, "skipped")));
  assert.throws(() =>
    assertDesktopGate({
      ...result("true", "success"),
      "linux-upgrade": { result: "failure" },
    }),
  );
  assert.throws(() =>
    assertDesktopGate({
      ...result("false", "skipped"),
      changes: { result: "failure" },
    }),
  );
});

test("workflow summary gates depend on every required job and always report", () => {
  const ci = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.deepEqual(
    new Set(ci.jobs["ci-gate"].needs),
    new Set(Object.keys(ci.jobs).filter((key) => key !== "ci-gate")),
  );
  assert.equal(ci.jobs["ci-gate"].if, "always()");
  const desktop = yaml.load(
    readFileSync(".github/workflows/desktop-acceptance.yml", "utf8"),
  );
  assert.equal(desktop.jobs["desktop-gate"].if, "always()");
  assert(
    !desktop.on.pull_request?.paths,
    "Required desktop workflow must report even for docs",
  );
  assert.deepEqual(desktop.jobs["desktop-gate"].needs, [
    "changes",
    "desktop",
    "linux-upgrade",
  ]);
  assert.deepEqual(ci.jobs["rust-tests"].strategy.matrix.os, [
    "macos-latest",
    "windows-2025",
  ]);
  const protection = JSON.parse(
    readFileSync(".github/required-checks.json", "utf8"),
  );
  assert.deepEqual(protection.required_status_checks.checks, [
    { context: ci.jobs["ci-gate"].name, app_id: 15368 },
    { context: desktop.jobs["desktop-gate"].name, app_id: 15368 },
  ]);
  assert.equal(protection.required_status_checks.strict, true);
});
