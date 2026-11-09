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
import { createServer } from "node:net";
import {
  assertHostedRunner,
  assertPackageMetadata,
  assertPackageContents,
  assertInstallerArguments,
  authorizationExit,
  PACKAGE,
  NEW_VERSION,
  loopbackListenerPort,
  processLoopbackPort,
} from "./linux-upgrade-support.mjs";

test("driver discovery follows the owning process and ignores other sockets", () => {
  const row = (address, port, state, inode) =>
    `0: ${address}:${port.toString(16).toUpperCase()} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1001 0 ${inode}`;
  const tcp = [
    row("0100007F", 41001, "0A", "11"),
    row("0100007F", 41002, "0A", "22"),
    row("00000000", 41003, "0A", "33"),
    row("0100007F", 41004, "01", "44"),
  ].join("\n");
  assert.equal(loopbackListenerPort(tcp, new Set(["11"])), 41001);
  assert.equal(loopbackListenerPort(tcp, new Set(["22"])), 41002);
  assert.equal(
    loopbackListenerPort(tcp, new Set(["33", "44", "unknown"])),
    null,
  );
  assert.throws(() => loopbackListenerPort(tcp, new Set(["11", "22"])));
});

test("a kernel-assigned driver port permits overlap during process relaunch", async () => {
  const old = createServer();
  const conflicting = createServer();
  const next = createServer();
  const bind = (server, port) =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  try {
    await bind(old, 0);
    await assert.rejects(bind(conflicting, old.address().port), {
      code: "EADDRINUSE",
    });
    await bind(next, 0);
    assert.notEqual(next.address().port, old.address().port);
  } finally {
    await Promise.all(
      [old, next]
        .filter((server) => server.listening)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
});

test(
  "Linux driver discovery reads the socket owned by the actual process",
  { skip: process.platform !== "linux" },
  async () => {
    const server = createServer();
    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      assert.equal(processLoopbackPort(process.pid), server.address().port);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

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
