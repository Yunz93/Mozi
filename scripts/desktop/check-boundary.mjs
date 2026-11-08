import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
const rust = readFileSync("src-tauri/src/lib.rs", "utf8");
const production = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8"),
);
const release = readFileSync(".github/workflows/release.yml", "utf8");
const test = JSON.parse(
  readFileSync("src-tauri/tauri.desktop-e2e.conf.json", "utf8"),
);
assert.match(cargo, /desktop-e2e\s*=\s*\["dep:tauri-plugin-wdio-webdriver"\]/);
assert.match(
  cargo,
  /tauri-plugin-wdio-webdriver\s*=\s*\{[^\n]*optional\s*=\s*true/,
);
assert.match(
  rust,
  /#\[cfg\(feature = "desktop-e2e"\)\]\s*\{\s*builder = builder\.plugin\(tauri_plugin_wdio_webdriver::init\(\)\);\s*\}/,
);
assert(
  !release.includes("desktop-e2e"),
  "Release workflow must never opt into the test driver",
);
assert(
  !release.includes("--all-features"),
  "Release workflow must not enable test features indirectly",
);
assert.notEqual(test.identifier, production.identifier);
assert(test.identifier.endsWith(".desktop-e2e"));
const normal = execFileSync(
  "cargo",
  [
    "tree",
    "--locked",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "-e",
    "normal",
  ],
  { encoding: "utf8", maxBuffer: 8_000_000 },
);
assert(
  !normal.includes("tauri-plugin-wdio-webdriver"),
  "Default dependency graph contains the automation server",
);
const feature = execFileSync(
  "cargo",
  [
    "tree",
    "--locked",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--features",
    "desktop-e2e",
    "-e",
    "normal",
  ],
  { encoding: "utf8", maxBuffer: 8_000_000 },
);
assert(feature.includes("tauri-plugin-wdio-webdriver v1.5.1"));
console.log(
  "Desktop driver is optional, test-scoped, and absent from release/default builds",
);
