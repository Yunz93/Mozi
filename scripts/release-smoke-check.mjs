#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(projectRoot, "dist");
const distAssetsDir = join(distDir, "assets");
const appBundlePath = join(
  projectRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "墨知.app",
);

const shouldBuildApp = process.argv.includes("--app");
const workflowOnly = process.argv.includes("--workflow-only");

function run(command, args, env = undefined) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: env ? { ...process.env, ...env } : process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    console.error(`Missing ${label}: ${path}`);
    process.exit(1);
  }
}

function readEntrypointAssets() {
  const html = readFileSync(join(distDir, "index.html"), "utf8");
  const cssMatch = html.match(/href="(?:\.\/)?\/?assets\/([^"]+\.css)"/);
  const jsMatch = html.match(/src="(?:\.\/)?\/?assets\/([^"]+\.js)"/);

  return {
    cssAsset: cssMatch?.[1] ?? null,
    jsAsset: jsMatch?.[1] ?? null,
  };
}

function assertReleaseWorkflowConfig() {
  const workflowPath = join(projectRoot, ".github", "workflows", "release.yml");
  const workflow = readFileSync(workflowPath, "utf8");
  const tauriConfigPath = join(projectRoot, "src-tauri", "tauri.conf.json");
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));

  if (
    tauriConfig?.bundle?.createUpdaterArtifacts !== true &&
    tauriConfig?.bundle?.createUpdaterArtifacts !== false
  ) {
    console.error(
      "src-tauri/tauri.conf.json must set bundle.createUpdaterArtifacts to true or false.",
    );
    process.exit(1);
  }

  if (workflow.includes("TAURI_SIGNING_PRIVATE_KEY_PATH")) {
    console.error(
      "release.yml must pass the prepared updater key path through TAURI_SIGNING_PRIVATE_KEY, not TAURI_SIGNING_PRIVATE_KEY_PATH.",
    );
    process.exit(1);
  }

  if (
    /\${{\s*steps\.prepare_signing_key\.outputs\.private_key\s*}}/.test(
      workflow,
    )
  ) {
    console.error(
      "release.yml must not read a non-existent prepare_signing_key private_key output; the script writes TAURI_SIGNING_PRIVATE_KEY through GITHUB_ENV.",
    );
    process.exit(1);
  }

  const prepareSigningKeyScript = readFileSync(
    join(projectRoot, "scripts", "prepare-tauri-signing-key.mjs"),
    "utf8",
  );
  if (
    !/writeGithubEnv\(\s*["']TAURI_SIGNING_PRIVATE_KEY["']\s*,\s*signingKey\s*\)/.test(
      prepareSigningKeyScript,
    )
  ) {
    console.error(
      "prepare-tauri-signing-key.mjs must export CI base64 key contents via TAURI_SIGNING_PRIVATE_KEY (not a raw key file path).",
    );
    process.exit(1);
  }

  if (
    prepareSigningKeyScript.includes("writeGithubEnv(") &&
    /writeGithubEnv\(\s*["']TAURI_SIGNING_PRIVATE_KEY["']\s*,\s*keyPath\s*\)/.test(
      prepareSigningKeyScript,
    )
  ) {
    console.error(
      "prepare-tauri-signing-key.mjs must not pass a raw key file path to TAURI_SIGNING_PRIVATE_KEY; Tauri base64-decodes the value.",
    );
    process.exit(1);
  }

  if (
    workflow.includes(
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
    )
  ) {
    console.error(
      "release.yml must not set TAURI_SIGNING_PRIVATE_KEY_PASSWORD to the secret directly on the build step; an empty password env corrupts Tauri key decoding. Export it conditionally instead.",
    );
    process.exit(1);
  }

  if (workflow.split("Export updater signing password").length - 1 !== 2) {
    console.error(
      "release.yml must conditionally export TAURI_SIGNING_PRIVATE_KEY_PASSWORD on both macOS and Windows jobs.",
    );
    process.exit(1);
  }

  if (workflow.includes("releaseAssetNamePattern")) {
    console.error(
      "tauri-action@v0 ignores releaseAssetNamePattern; use assetNamePattern for release asset names.",
    );
    process.exit(1);
  }

  const releaseAssetPattern =
    "assetNamePattern: Mozi_[version]_[arch][setup][ext]";
  const patternCount = workflow.split(releaseAssetPattern).length - 1;

  if (patternCount !== 2) {
    console.error(
      `release.yml must set "${releaseAssetPattern}" for both macOS and Windows release jobs.`,
    );
    process.exit(1);
  }

  const releaseBodyPath = join(projectRoot, ".github", "release-body.md");
  const releaseBody = existsSync(releaseBodyPath)
    ? readFileSync(releaseBodyPath, "utf8")
    : "";
  const documentsInstallScript =
    workflow.includes("scripts/install-macos.sh") ||
    releaseBody.includes("scripts/install-macos.sh");
  if (!documentsInstallScript) {
    console.error(
      "release.yml or .github/release-body.md must document the macOS one-line install script scripts/install-macos.sh.",
    );
    process.exit(1);
  }
  if (
    releaseBody &&
    !workflow.includes(".github/release-body.md") &&
    !workflow.includes("release-body.md")
  ) {
    console.error(
      "release.yml must compose the GitHub release body from .github/release-body.md when that file exists.",
    );
    process.exit(1);
  }

  if (!workflow.includes("scripts/import-apple-certificate.sh")) {
    console.error(
      "release.yml must import Apple Developer certificates via scripts/import-apple-certificate.sh for macOS signing.",
    );
    process.exit(1);
  }

  if (workflow.includes('APPLE_SIGNING_IDENTITY: "-"')) {
    console.error(
      'release.yml must not hardcode APPLE_SIGNING_IDENTITY to ad-hoc "-"; use conditional signing when APPLE_CERTIFICATE is configured.',
    );
    process.exit(1);
  }

  if (!workflow.includes("Prepare Apple notarization credentials")) {
    console.error(
      "release.yml must prepare Apple notarization credentials via scripts/prepare-apple-notarization.mjs.",
    );
    process.exit(1);
  }
}

function assertReleaseDistOutput() {
  assertExists(distDir, "dist output");
  assertExists(join(distDir, "index.html"), "dist index.html");
  assertExists(distAssetsDir, "dist assets directory");

  const { cssAsset, jsAsset } = readEntrypointAssets();

  if (!cssAsset || !jsAsset) {
    console.error("Missing entrypoint assets in dist/index.html");
    process.exit(1);
  }

  assertExists(join(distAssetsDir, cssAsset), "entrypoint CSS asset");
  assertExists(join(distAssetsDir, jsAsset), "entrypoint JS asset");

  return { cssAsset, jsAsset };
}

assertReleaseWorkflowConfig();

if (workflowOnly) {
  console.log("Release workflow config check passed.");
  process.exit(0);
}

if (!shouldBuildApp) {
  console.error(
    "Usage: node scripts/release-smoke-check.mjs --app | --workflow-only",
  );
  process.exit(1);
}

// Release frontend dist must come from Tauri beforeBuildCommand, not a standalone Vite build.
run("npx", ["tauri", "build", "--bundles", "app", "--no-sign"]);
assertExists(appBundlePath, "macOS .app bundle");

const { cssAsset, jsAsset } = assertReleaseDistOutput();

const checklist = [
  "Cold launch the packaged app and verify the first opened file has correct editor width.",
  "In Preview mode, open Outline in a non-fullscreen window and confirm the panel renders and headings jump correctly.",
  "Open a note with fenced code blocks and confirm syntax highlighting still works in the packaged app.  [auto: releaseSmokeAuto.test.ts]",
  "Open a note with valid and invalid Mermaid diagrams; confirm valid diagrams render as SVG and invalid diagrams show an error state.  [auto: releaseSmokeAuto.test.ts]",
  "Open a PDF directly from the sidebar and confirm the PDF.js canvas preview renders instead of staying on the loading state.",
  "Open a Markdown note with ![[sample.pdf]] and confirm the embedded PDF.js canvas preview renders like direct preview.",
  "Compare Editor mode styling against dev: caret, frontmatter colors, markdown token colors, and line wrapping.",
  "Verify wikilinks and embeds in Preview: [[file]], [[#heading]], ![[image.png]], and non-image attachments.  [auto: releaseSmokeAuto.test.ts + releaseParity.test.ts]",
  "Click external links from Preview and confirm the system browser opens.",
  "Switch between Editor / Preview / Split, resize the window, and confirm layout widths stay stable.",
  "For tagged releases with createUpdaterArtifacts=true, confirm updater signature assets and latest.json are attached to the GitHub Release.",
];

console.log("\nRelease smoke check passed.\n");
console.log(`Verified Tauri-built dist assets: ${cssAsset}, ${jsAsset}`);
console.log(`Verified app bundle: ${appBundlePath}`);

console.log("\nAutomated parity gates (run in CI & release workflow):");
console.log("  npm run test:release-parity");
console.log(
  "  - tauriWindowConfig.test.ts: dev config whitelist & window parity",
);
console.log(
  "  - releaseParity.test.ts: fixture-based render invariants (__PROD__ mode)",
);
console.log(
  "  - prepareTauriSigningKey.test.ts: updater signing key base64 export",
);

console.log("\nManual checklist:");
for (const item of checklist) {
  console.log(`- ${item}`);
}
