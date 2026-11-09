import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyReleaseAssets(directory, tag, repository) {
  assert(
    /^v\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(tag),
    "Invalid release tag",
  );
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository), "Invalid release repository");
  const version = tag.slice(1);
  const mac = `Mozi_${version}_aarch64.app.tar.gz`;
  const windows = `Mozi_${version}_x64-setup.exe`;
  const linux = `Mozi_${version}_amd64.deb`;
  const required = [
    "latest.json",
    mac,
    `${mac}.sig`,
    `Mozi_${version}_aarch64.dmg`,
    windows,
    `${windows}.sig`,
    linux,
    `${linux}.sig`,
  ];
  const platforms = {
    "darwin-aarch64": mac,
    "darwin-aarch64-app": mac,
    "windows-x86_64": windows,
    "windows-x86_64-nsis": windows,
    "linux-x86_64-deb": linux,
  };
  const release = JSON.parse(
    readFileSync(join(directory, "release.json"), "utf8"),
  );
  assert.equal(release.tag_name, tag, "Release metadata has a different tag");
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  const assets = release.assets;
  assert(
    Array.isArray(assets) && assets.length === required.length,
    "Release asset inventory is incomplete or unexpected",
  );
  assert.deepEqual(
    new Set(assets.map((asset) => asset.name)),
    new Set(required),
    "Release asset names do not match the platform/version contract",
  );
  const digests = {};
  for (const name of required) {
    const path = join(directory, name);
    const entry = lstatSync(path);
    assert(
      entry.isFile() && !entry.isSymbolicLink(),
      `Asset is not a regular downloaded file: ${name}`,
    );
    const expected = assets.find((asset) => asset.name === name)?.digest;
    assert(
      /^sha256:[a-f0-9]{64}$/.test(expected ?? ""),
      `GitHub asset digest is missing: ${name}`,
    );
    const actual = `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
    assert.equal(actual, expected, `Published asset digest mismatch: ${name}`);
    digests[name] = actual;
  }
  const manifest = JSON.parse(
    readFileSync(join(directory, "latest.json"), "utf8"),
  );
  assert.equal(manifest.version, version, "Updater manifest version mismatch");
  assert.deepEqual(
    new Set(Object.keys(manifest.platforms ?? {})),
    new Set(Object.keys(platforms)),
    "Updater platform inventory is incomplete or unexpected",
  );
  for (const [platform, name] of Object.entries(platforms)) {
    const entry = manifest.platforms[platform];
    const url = new URL(entry.url);
    assert.equal(
      url.origin,
      "https://github.com",
      "Updater URL origin mismatch",
    );
    assert(
      !url.username && !url.password && !url.search && !url.hash,
      "Updater URL contains unexpected credentials, query or fragment",
    );
    assert.equal(
      decodeURIComponent(url.pathname),
      `/${repository}/releases/download/${tag}/${name}`,
      `Updater URL does not match repository/version/platform: ${platform}`,
    );
    const signature = readFileSync(
      join(directory, `${name}.sig`),
      "utf8",
    ).trim();
    assert.equal(
      entry.signature?.trim(),
      signature,
      `Manifest signature does not match the published sidecar: ${platform}`,
    );
    assert(
      Buffer.from(signature, "base64")
        .toString("utf8")
        .startsWith("untrusted comment:"),
      `Malformed updater signature: ${platform}`,
    );
  }
  return {
    tag,
    assetDigests: digests,
    signedArtifacts: [mac, windows, linux],
    platforms: Object.keys(platforms),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory = process.argv[2];
  assert(directory, "Expected downloaded release directory");
  const result = verifyReleaseAssets(
    directory,
    process.env.RELEASE_TAG,
    process.env.GITHUB_REPOSITORY,
  );
  writeFileSync(
    join(directory, "verification-summary.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(
    `Verified published inventory, URLs, sidecars and GitHub SHA-256: ${result.tag}`,
  );
}
