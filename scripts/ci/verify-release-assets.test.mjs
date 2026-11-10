import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyReleaseAssets } from "./verify-release-assets.mjs";

function fixture(version = "2.3.2") {
  const directory = mkdtempSync(join(tmpdir(), "mozi-release-verification-"));
  const tag = `v${version}`;
  const names = [
    `Mozi_${version}_aarch64.app.tar.gz`,
    `Mozi_${version}_x64-setup.exe`,
    `Mozi_${version}_amd64.deb`,
  ];
  const signature = Buffer.from(
    "untrusted comment: test fixture\nnot-a-cryptographic-test",
  ).toString("base64");
  const platforms = {};
  for (const [index, keys] of [
    ["darwin-aarch64", "darwin-aarch64-app"],
    ["windows-x86_64", "windows-x86_64-nsis"],
    ["linux-x86_64-deb"],
  ].entries())
    for (const key of keys)
      platforms[key] = {
        url: `https://github.com/Yunz93/Mozi/releases/download/${tag}/${names[index]}`,
        signature,
      };
  const manifest = { version, platforms };
  writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
  for (const name of names) {
    writeFileSync(join(directory, name), "package fixture");
    writeFileSync(join(directory, `${name}.sig`), signature);
  }
  writeFileSync(join(directory, `Mozi_${version}_aarch64.dmg`), "dmg fixture");
  const files = [
    "latest.json",
    `Mozi_${version}_aarch64.dmg`,
    ...names.flatMap((name) => [name, `${name}.sig`]),
  ];
  const metadata = {
    tag_name: tag,
    draft: false,
    prerelease: version.includes("-beta."),
    assets: files.map((name) => ({
      name,
      digest: `sha256:${createHash("sha256")
        .update(readFileSync(join(directory, name)))
        .digest("hex")}`,
    })),
  };
  const writeMetadata = () =>
    writeFileSync(join(directory, "release.json"), JSON.stringify(metadata));
  const writeManifest = () => {
    writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
    metadata.assets.find((asset) => asset.name === "latest.json").digest =
      `sha256:${createHash("sha256")
        .update(readFileSync(join(directory, "latest.json")))
        .digest("hex")}`;
    writeMetadata();
  };
  writeMetadata();
  return { directory, metadata, manifest, writeManifest, writeMetadata };
}

test("release inventory validates both channels and rejects mismatched prerelease metadata", () => {
  for (const version of ["2.3.6", "2.3.6-beta.1", "2.3.6-beta.2"]) {
    const f = fixture(version);
    const verify = () =>
      verifyReleaseAssets(f.directory, `v${version}`, "Yunz93/Mozi");
    assert.equal(
      verify().channel,
      version.includes("-beta.") ? "beta" : "stable",
    );
    f.metadata.prerelease = !f.metadata.prerelease;
    f.writeMetadata();
    assert.throws(verify, /Release channel does not match its tag/);
  }
});

test("release inventory validates real digests and rejects missing or tampered downloads", () => {
  const f = fixture();
  assert.equal(
    verifyReleaseAssets(f.directory, "v2.3.2", "Yunz93/Mozi").signedArtifacts
      .length,
    3,
  );
  writeFileSync(join(f.directory, "Mozi_2.3.2_amd64.deb"), "tampered package");
  assert.throws(
    () => verifyReleaseAssets(f.directory, "v2.3.2", "Yunz93/Mozi"),
    /digest mismatch/,
  );
  f.metadata.assets.pop();
  f.writeMetadata();
  assert.throws(
    () => verifyReleaseAssets(f.directory, "v2.3.2", "Yunz93/Mozi"),
    /inventory/,
  );
});

test("release inventory rejects wrong version, repository, missing platform and sidecar", () => {
  for (const change of [
    (m) => {
      m.version = "2.3.1";
    },
    (m) => {
      m.platforms["linux-x86_64-deb"].url =
        "https://github.com/other/repo/releases/download/v2.3.2/Mozi_2.3.2_amd64.deb";
    },
    (m) => {
      m.platforms["linux-x86_64-deb"].url =
        "https://github.com/Yunz93/Mozi/releases/download/v2.3.1/Mozi_2.3.2_amd64.deb";
    },
    (m) => {
      delete m.platforms["linux-x86_64-deb"];
    },
    (m) => {
      m.platforms["linux-x86_64-deb"].signature = "different";
    },
  ]) {
    const f = fixture();
    change(f.manifest);
    f.writeManifest();
    assert.throws(() =>
      verifyReleaseAssets(f.directory, "v2.3.2", "Yunz93/Mozi"),
    );
  }
});

test("release inventory rejects path traversal assets and malformed metadata", () => {
  const f = fixture();
  f.metadata.assets[0].name = "../../outside";
  f.writeMetadata();
  assert.throws(() =>
    verifyReleaseAssets(f.directory, "v2.3.2", "Yunz93/Mozi"),
  );
  assert.throws(() =>
    verifyReleaseAssets(f.directory, "v2.3.2;echo secret", "Yunz93/Mozi"),
  );
});
