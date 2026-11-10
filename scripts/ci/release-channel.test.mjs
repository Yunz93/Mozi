import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { resolveReleaseChannel } from "../release-channel.mjs";

test("release tags distinguish stable and incrementing beta versions", () => {
  assert.equal(resolveReleaseChannel("v2.3.6").prerelease, false);
  assert.equal(resolveReleaseChannel("v2.3.6").release_name, "Release v2.3.6");
  for (const sequence of [1, 2, 10]) {
    const tag = `v2.3.6-beta.${sequence}`;
    const result = resolveReleaseChannel(tag);
    assert.equal(result.channel, "beta");
    assert.equal(result.release_name, `Beta ${tag}`);
    assert.equal(result.prerelease, true);
    assert.equal(result.version, tag.slice(1));
  }
  for (const tag of [
    undefined,
    "beta",
    "v2.3",
    "v02.3.6",
    "v2.3.6-beta.0",
    "v2.3.6-beta.01",
    "v2.3.6-beta",
    "v2.3.6-nightly.1",
    "v2.3.6+beta.1",
  ]) {
    assert.throws(() => resolveReleaseChannel(tag));
  }
  assert.throws(() => resolveReleaseChannel("v2.3.6", "beta"), /不符/);
  assert.throws(() => resolveReleaseChannel("v2.3.6-beta.1", "stable"), /不符/);
});

test("channel CLI writes GitHub outputs and rejects a mismatched manual channel", () => {
  const directory = mkdtempSync(join(tmpdir(), "mozi-release-channel-"));
  const output = join(directory, "output");
  writeFileSync(output, "");
  const env = {
    ...process.env,
    GITHUB_OUTPUT: output,
    RELEASE_CHANNEL: "beta",
  };
  const run = (tag) =>
    spawnSync(process.execPath, ["scripts/release-channel.mjs", tag], {
      env,
      encoding: "utf8",
    });
  const result = run("v2.3.6-beta.2");
  assert.equal(result.status, 0, result.stderr);
  const written = readFileSync(output, "utf8");
  assert.match(written, /^channel=beta$/m);
  assert.match(written, /^prerelease=true$/m);
  assert.equal(run("v2.3.6").status, 1);
  assert.equal(readFileSync(output, "utf8"), written);
});

test("version sync preserves the beta suffix and rejects unsupported tags before writing", () => {
  const root = mkdtempSync(join(tmpdir(), "mozi-release-version-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "src-tauri"));
  for (const name of ["sync-version-from-tag.mjs", "release-channel.mjs"]) {
    copyFileSync(resolve("scripts", name), join(root, "scripts", name));
  }
  writeFileSync(join(root, "package.json"), '{"version":"2.3.5"}');
  writeFileSync(
    join(root, "package-lock.json"),
    '{"version":"2.3.5","packages":{"":{"version":"2.3.5"}}}',
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.lock"),
    '[[package]]\nname = "app"\nversion = "2.3.5"\n',
  );
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), '{"version":"2.3.5"}');
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    '[package]\nname = "app"\nversion = "2.3.5"\n',
  );
  const files = [
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
  ];
  for (const tag of ["v2.3.6-beta.2", "v2.3.6"]) {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/sync-version-from-tag.mjs"), tag],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    for (const file of files)
      assert(readFileSync(join(root, file), "utf8").includes(tag.slice(1)));
    assert.equal(
      JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))
        .packages[""].version,
      tag.slice(1),
    );
  }
  const before = files.map((file) => readFileSync(join(root, file), "utf8"));
  const invalid = spawnSync(process.execPath, [
    join(root, "scripts/sync-version-from-tag.mjs"),
    "v2.3.7-rc.1",
  ]);
  assert.equal(invalid.status, 1);
  assert.deepEqual(
    files.map((file) => readFileSync(join(root, file), "utf8")),
    before,
  );
});

test("release builds require the channel gate and keep user update feeds stable", () => {
  const workflow = yaml.load(
    readFileSync(".github/workflows/release.yml", "utf8"),
  );
  const gate = workflow.jobs["release-channel"];
  assert.equal(
    workflow.on.workflow_dispatch.inputs.release_channel.default,
    "beta",
  );
  assert.equal(
    gate.outputs.prerelease,
    "${{ steps.channel.outputs.prerelease }}",
  );
  for (const name of ["build-macos", "build-windows"]) {
    const job = workflow.jobs[name];
    assert(job.needs.includes("release-channel"));
    const upload = job.steps.find((step) =>
      step.uses?.startsWith("tauri-apps/tauri-action@"),
    );
    assert.equal(
      upload.with.prerelease,
      "${{ needs.release-channel.outputs.prerelease == 'true' }}",
    );
  }
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const stableFeed =
    "https://github.com/Yunz93/Mozi/releases/latest/download/latest.json";
  assert.deepEqual(config.plugins.updater.endpoints, [stableFeed]);
  assert(
    readFileSync("src-tauri/src/macos_update.rs", "utf8").includes(
      `"${stableFeed}"`,
    ),
  );
});
