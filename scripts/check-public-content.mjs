import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

// Inspect current tracked text, never print matched credentials. This is a
// high-confidence guard, not a substitute for a repository-history secret scan.
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\/Users\/(?!(?:example|user|test|runner|Shared)(?:\/|\b))[A-Za-z0-9_.-]+\//,
  /settings_aboutJointCertification/,
];
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const failures = [];
for (const file of files) {
  if (
    !existsSync(file) ||
    !statSync(file).isFile() ||
    statSync(file).size > 2_000_000
  )
    continue;
  if (!/\.(?:[cm]?[jt]sx?|json|md|rs|ya?ml|sh|toml|html|css)$/.test(file))
    continue;
  // Synthetic cryptographic fixtures are permitted only in tests.
  if (/\.test\.[jt]sx?$|__fixtures__|\/fixtures\//.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (patterns.some((pattern) => pattern.test(text))) failures.push(file);
}
if (failures.length) {
  console.error(`Review public content in:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("Tracked public-content guard passed.");
