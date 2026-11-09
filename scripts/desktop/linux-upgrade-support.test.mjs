import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertHostedRunner,
  assertPackageMetadata,
  assertPackageContents,
  assertInstallerArguments,
  authorizationExit,
  PACKAGE,
  NEW_VERSION,
} from "./linux-upgrade-support.mjs";

test("Linux upgrade refuses local, persistent and root runners", () => {
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" };
  assert.doesNotThrow(() => assertHostedRunner("linux", env, 1001));
  for (const [platform, context, uid] of [
    ["darwin", env, 1001],
    ["linux", {}, 1001],
    ["linux", { ...env, RUNNER_ENVIRONMENT: "self-hosted" }, 1001],
    ["linux", env, 0],
  ])
    assert.throws(() => assertHostedRunner(platform, context, uid));
  assert.doesNotThrow(() =>
    assertPackageMetadata(`${PACKAGE}\n${NEW_VERSION}\namd64`, NEW_VERSION),
  );
  for (const metadata of [
    `mozi\n${NEW_VERSION}\namd64`,
    `${PACKAGE}\n2.3.1\namd64`,
    `${PACKAGE}\n${NEW_VERSION}\narm64`,
  ])
    assert.throws(() => assertPackageMetadata(metadata, NEW_VERSION));
});

test("Debian inventory requires the isolated binary and rejects unsafe package paths", () => {
  const listing = (path) =>
    `-rwxr-xr-x root/root 987654321 2026-11-09 10:00 ${path}`;
  const valid = listing(`./usr/bin/${PACKAGE}`);
  assert.doesNotThrow(() => assertPackageContents(valid));
  // Tauri 的实际 Debian 包省略 tar 路径开头的 ./。
  assert.doesNotThrow(() =>
    assertPackageContents(listing(`usr/bin/${PACKAGE}`)),
  );
  for (const extra of [
    "./usr/bin/mozi",
    "./usr/bin/other",
    "./usr/lib/../bin/mozi",
    "/usr/bin/mozi",
    `/usr/bin/${PACKAGE}`,
    `usr/lib/../bin/${PACKAGE}`,
  ])
    assert.throws(() => assertPackageContents(`${valid}\n${listing(extra)}`));
  assert.throws(() =>
    assertPackageContents(listing("./usr/lib/only-resource")),
  );
  assert.throws(() => assertPackageContents("malformed"));
  assert.throws(() =>
    assertPackageContents(
      `lrwxrwxrwx root/root 0 2026-11-09 10:00 usr/bin/${PACKAGE} -> /usr/bin/mozi`,
    ),
  );
});

test("authorization cancellation blocks every updater fallback", () => {
  for (const tool of ["pkexec", "zenity", "kdialog", "sudo"])
    assert.notEqual(authorizationExit(tool, "deny"), 0);
  assert.equal(authorizationExit("pkexec", "allow"), 0);
  assert.notEqual(authorizationExit("sudo", "allow"), 0);
  assert.throws(() => authorizationExit("sh", "allow"));
  assert.throws(() => authorizationExit("pkexec", "unknown"));
});

test("privilege proxy accepts only a regular updater package inside its download root", () => {
  const root = mkdtempSync(join(tmpdir(), "mozi-upgrade-test-"));
  try {
    const downloads = join(root, "downloads");
    const folder = join(downloads, "tauri_deb_update123");
    mkdirSync(folder, { recursive: true });
    const path = join(folder, "package.deb");
    writeFileSync(path, "fixture");
    // macOS 的 /var 是系统符号链接，测试中使用规范路径。
    const canonical = realpathSync(path);
    assert.equal(
      assertInstallerArguments(["dpkg", "-i", canonical], downloads),
      canonical,
    );
    for (const args of [
      ["sh", "-i", canonical],
      ["dpkg", "--force-all", canonical],
      ["dpkg", "-i", canonical, "extra"],
      ["dpkg", "-i", "/usr/bin/mozi"],
    ])
      assert.throws(() => assertInstallerArguments(args, downloads));
    const link = join(folder, "link.deb");
    symlinkSync(path, link);
    assert.throws(() =>
      assertInstallerArguments(["dpkg", "-i", link], downloads),
    );
    assert.throws(() =>
      assertInstallerArguments(["dpkg", "-i", canonical], join(root, "other")),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});
