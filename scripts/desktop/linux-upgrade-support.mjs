import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const PACKAGE = "mozi-ci-upgrade";
export const OLD_VERSION = "99.0.1";
export const NEW_VERSION = "99.0.2";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function assertHostedRunner(platform, env, uid) {
  assert.equal(platform, "linux", "Linux upgrade testing requires Linux");
  assert.equal(env.GITHUB_ACTIONS, "true", "Upgrade testing is CI-only");
  assert.equal(
    env.RUNNER_ENVIRONMENT,
    "github-hosted",
    "Refusing a persistent runner",
  );
  assert(
    Number.isInteger(uid) && uid > 0,
    "The app must run as an ordinary user",
  );
}

export function assertPackageMetadata(metadata, version) {
  assert.deepEqual(metadata.trim().split("\n"), [PACKAGE, version, "amd64"]);
  assert(
    [OLD_VERSION, NEW_VERSION].includes(version),
    "Unexpected test version",
  );
}

export function assertPackageContents(listing) {
  const paths = listing
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$/.exec(line);
      assert(match, "Unrecognized Debian content listing");
      return match[1].split(" -> ")[0];
    });
  assert(
    paths.includes(`./usr/bin/${PACKAGE}`),
    "Test binary is missing from package",
  );
  for (const entry of paths) {
    assert(entry.startsWith("./") && !entry.split("/").includes(".."));
    if (entry.startsWith("./usr/bin/") && entry !== "./usr/bin/")
      assert.equal(
        entry,
        `./usr/bin/${PACKAGE}`,
        "Refusing a package with other binary names",
      );
  }
}

export function assertInstallerArguments(args, downloads) {
  assert.equal(args.length, 3);
  assert.equal(args[0], "dpkg");
  assert.equal(args[1], "-i");
  const path = args[2];
  assert(isAbsolute(path) && basename(path) === "package.deb");
  assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
  assert.equal(
    realpathSync(path),
    path,
    "Refusing symlinks in updater staging path",
  );
  const inside = relative(realpathSync(downloads), path);
  assert(inside && !inside.startsWith(`..${sep}`) && !isAbsolute(inside));
  assert(basename(dirname(path)).startsWith("tauri_deb_update"));
  return path;
}

const sudo = (args) =>
  execFileSync("/usr/bin/sudo", ["-n", ...args], { encoding: "utf8" });

export function installPinnedPackage(path, expectedHash, version) {
  assertHostedRunner(process.platform, process.env, process.getuid?.());
  assert.match(expectedHash, /^[a-f0-9]{64}$/);
  // 先复制进 root 专属目录，再校验这个副本，避免可写下载目录中的替换竞争。
  const root = sudo([
    "/usr/bin/mktemp",
    "-d",
    "/tmp/mozi-ci-upgrade.XXXXXXXX",
  ]).trim();
  assert.match(root, /^\/tmp\/mozi-ci-upgrade\.[A-Za-z0-9]+$/);
  const staged = `${root}/package.deb`;
  sudo(["/usr/bin/install", "-m", "0600", path, staged]);
  assert.equal(
    sudo(["/usr/bin/sha256sum", staged]).split(/\s/)[0],
    expectedHash,
  );
  assertPackageMetadata(
    sudo([
      "/usr/bin/dpkg-deb",
      "-f",
      staged,
      "Package",
      "Version",
      "Architecture",
    ]).replace(/^\w+: /gm, ""),
    version,
  );
  sudo(["/usr/bin/dpkg", "-i", staged]);
  // 临时目录由一次性 runner 回收，不对任意路径执行特权递归删除。
}

export function authorizationExit(tool, mode) {
  assert(["pkexec", "zenity", "kdialog", "sudo"].includes(tool));
  assert(["deny", "allow"].includes(mode));
  return mode === "allow" && tool === "pkexec"
    ? 0
    : tool === "pkexec"
      ? 126
      : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    assertHostedRunner(process.platform, process.env, process.getuid?.());
    const policy = JSON.parse(
      readFileSync(process.env.MOZI_UPGRADE_POLICY, "utf8"),
    );
    const tool = process.argv[2];
    const args = process.argv.slice(3);
    appendFileSync(
      policy.audit,
      `${JSON.stringify({ tool, args, mode: policy.mode })}\n`,
    );
    const code = authorizationExit(tool, policy.mode);
    if (code === 0) {
      const path = assertInstallerArguments(args, policy.downloads);
      installPinnedPackage(path, policy.sha256, NEW_VERSION);
    }
    process.exitCode = code;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
