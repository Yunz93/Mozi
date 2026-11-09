import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DesktopDriver, until } from "./driver.mjs";
import { seedSettingsOnUnload } from "./fixture-settings.mjs";
import { freePort, launch, stop } from "./process.mjs";
import { appendText, loaded, openWindow } from "./support.mjs";
import {
  assertHostedRunner,
  assertPackageMetadata,
  assertPackageContents,
  installPinnedPackage,
  PACKAGE,
  OLD_VERSION,
  NEW_VERSION,
  sha256,
} from "./linux-upgrade-support.mjs";

assertHostedRunner(process.platform, process.env, process.getuid?.());
const output = resolve(".perf/linux-upgrade");
const root = await mkdtemp(join(tmpdir(), "mozi-linux-upgrade-"));
await chmod(root, 0o700);
await mkdir(output, { recursive: true });
const downloads = join(root, "downloads");
await mkdir(downloads);
const policyPath = join(root, "policy.json");
const audit = join(output, "authorization.jsonl");
const report = {
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  cases: [],
  status: "running",
};
let child;
let driver;
let packageBytes;
let signature;
let tampered = false;
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  if (!packageBytes) {
    response.writeHead(503).end();
    return;
  }
  if (request.url === "/latest") {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        version: NEW_VERSION,
        notes: "Isolated CI upgrade",
        pub_date: "2026-11-09T00:00:00Z",
        platforms: {
          "linux-x86_64-deb": { signature, url: `${endpoint}/update.deb` },
        },
      }),
    );
  } else if (request.url === "/update.deb") {
    const bytes = Buffer.from(packageBytes);
    if (tampered) bytes[bytes.length - 1] ^= 1;
    response.setHeader("content-type", "application/octet-stream");
    response.setHeader("content-length", bytes.length);
    response.end(bytes);
  } else response.writeHead(404).end();
});
await new Promise((accept, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", accept);
});
const endpoint = `http://127.0.0.1:${server.address().port}`;
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16_000_000,
    ...options,
  });
const installed = () =>
  run("/usr/bin/dpkg-query", ["-W", "-f=${Version}", PACKAGE]).trim();
const ownedPids = () => {
  try {
    return run("/usr/bin/pgrep", [
      "-u",
      String(process.getuid()),
      "-x",
      PACKAGE,
    ])
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
};
const saveReport = () =>
  writeFile(
    join(output, "results.json"),
    `${JSON.stringify({ ...report, requests }, null, 2)}\n`,
  );
const setPolicy = (mode) =>
  writeFile(
    policyPath,
    JSON.stringify({ mode, downloads, audit, sha256: sha256(packageBytes) }),
  );
const auditRows = async () => {
  try {
    return (await readFile(audit, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

async function buildPackage(version, key, password, pubkey) {
  const config = JSON.parse(
    await readFile("src-tauri/tauri.desktop-e2e.conf.json", "utf8"),
  );
  Object.assign(config, {
    version,
    productName: PACKAGE,
    mainBinaryName: PACKAGE,
  });
  config.bundle = { createUpdaterArtifacts: true, fileAssociations: [] };
  config.plugins = {
    updater: {
      pubkey,
      endpoints: [`${endpoint}/latest`],
      dangerousInsecureTransportProtocol: true,
    },
  };
  const configPath = join(root, `build-${version}.json`);
  await writeFile(configPath, JSON.stringify(config));
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  };
  run(
    "npm",
    [
      "run",
      "tauri",
      "--",
      "build",
      "--features",
      "desktop-e2e",
      "--bundles",
      "deb",
      "--config",
      configPath,
    ],
    { env, stdio: "inherit" },
  );
  const folder = "src-tauri/target/release/bundle/deb";
  const names = (await readdir(folder)).filter(
    (name) =>
      name.startsWith(`${PACKAGE}_${version}_`) && name.endsWith(".deb"),
  );
  assert.equal(names.length, 1);
  const path = join(root, `${version}.deb`);
  await copyFile(join(folder, names[0]), path);
  await copyFile(join(folder, `${names[0]}.sig`), `${path}.sig`);
  assertPackageMetadata(
    run("/usr/bin/dpkg-deb", [
      "-f",
      path,
      "Package",
      "Version",
      "Architecture",
    ]).replace(/^\w+: /gm, ""),
    version,
  );
  // 只捕获文件清单，不把超过百兆的解压 tar 内容读进 exec 缓冲区。
  const contents = run("/usr/bin/dpkg-deb", ["--contents", path], {
    env: { ...process.env, LC_ALL: "C" },
  });
  assertPackageContents(contents);
  return path;
}

async function showUpdate() {
  await driver.shortcut(",");
  await until(
    () => driver.button("关于").then(() => true),
    "Cannot open About settings",
  );
  await driver.button("立即检查");
  await until(
    async () =>
      (await driver.body()).includes(`发现新版本 ${NEW_VERSION}`) ||
      (await driver.body()).includes(`新版本 ${NEW_VERSION}`),
    "New version was not discovered",
  );
  await until(
    () =>
      driver
        .find('//button[normalize-space(.)="下载安装更新"]')
        .then(() => true),
    "Update install action is missing",
  );
}

async function failedAttempt(name) {
  const beforeDownloads = requests.filter(
    (url) => url === "/update.deb",
  ).length;
  await showUpdate();
  await driver.button("下载安装更新");
  await until(
    async () => (await driver.body()).includes("安装更新失败："),
    "Updater did not report installation failure",
    90_000,
  );
  assert.equal(
    requests.filter((url) => url === "/update.deb").length,
    beforeDownloads + 1,
  );
  assert.equal(installed(), OLD_VERSION);
  assert.equal(child.exitCode, null);
  await driver.chord(["\uE00C"]);
  await appendText(driver, `\n${name}\n`);
  await driver.shortcut("s");
  await until(
    async () => (await readFile(active, "utf8")).includes(name),
    "Failed update left editing or saving locked",
  );
  report.cases.push({ name, status: "passed", installed: installed() });
  await saveReport();
}

const vault = join(root, "vault");
const active = join(vault, "active.md");
const other = join(vault, "other.md");
try {
  assert.deepEqual(ownedPids(), [], "A dedicated test app is already running");
  let exists = false;
  try {
    installed();
    exists = true;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert(!exists, "Refusing to replace an existing test package");
  const key = join(root, "updater.key");
  const password = randomBytes(24).toString("base64");
  // 密钥输出必须捕获，绝不打印到日志或上传为工件。
  run("npm", [
    "run",
    "tauri",
    "--",
    "signer",
    "generate",
    "--ci",
    "--password",
    password,
    "-w",
    key,
  ]);
  await chmod(key, 0o600);
  const pubkey = (await readFile(`${key}.pub`, "utf8")).trim();
  const next = await buildPackage(NEW_VERSION, key, password, pubkey);
  packageBytes = await readFile(next);
  signature = (await readFile(`${next}.sig`, "utf8")).trim();
  const previous = await buildPackage(OLD_VERSION, key, password, pubkey);
  installPinnedPackage(previous, sha256(await readFile(previous)), OLD_VERSION);
  assert.equal(installed(), OLD_VERSION);
  const bin = join(root, "auth-bin");
  await mkdir(bin);
  const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const proxy = resolve("scripts/desktop/linux-upgrade-support.mjs");
  for (const tool of ["pkexec", "zenity", "kdialog", "sudo"]) {
    const path = join(bin, tool);
    await writeFile(
      path,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(proxy)} ${shellQuote(tool)} "$@"\n`,
    );
    await chmod(path, 0o700);
  }
  await setPolicy("deny");
  await mkdir(vault);
  await writeFile(active, "# UPGRADE_ACTIVE\n");
  await writeFile(other, "# UPGRADE_OTHER\n");
  const port = await freePort();
  child = launch(
    `/usr/bin/${PACKAGE}`,
    [],
    {
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: downloads,
      MOZI_UPGRADE_POLICY: policyPath,
      TAURI_WEBDRIVER_PORT: String(port),
    },
    join(output, "app.log"),
  );
  driver = new DesktopDriver(port);
  await until(
    () => driver.request("GET", "/status").then(() => true),
    "Installed updater app did not launch",
    60_000,
  );
  await driver.start();
  await driver.execute(
    `return (${seedSettingsOnUnload.toString()})(arguments[0])`,
    {
      language: "zh-CN",
      lastKnowledgeBasePath: vault,
      lastOpenedFilePath: active,
      knowledgeBases: [
        {
          path: vault,
          name: "Upgrade vault",
          lastOpenedAt: new Date().toISOString(),
        },
      ],
      embeddingProvider: "none",
      builtinEmbeddingDownloadConsent: "denied",
      autoSaveInterval: 600000,
      autoCheckForUpdates: false,
    },
  );
  await driver.refresh();
  await loaded(driver, "UPGRADE_ACTIVE", 90_000);
  const main = (await driver.handles())[0];
  tampered = true;
  await failedAttempt(
    "tampered-signature-blocks-install-and-preserves-editing",
  );
  assert.deepEqual(
    await auditRows(),
    [],
    "Signature failure reached a privilege command",
  );
  tampered = false;
  await failedAttempt("authorization-cancel-keeps-old-app-editable");
  assert.deepEqual(
    new Set((await auditRows()).map((row) => row.tool)),
    new Set(["pkexec", "zenity", "kdialog", "sudo"]),
  );
  await openWindow(driver, other, true, "UPGRADE_OTHER");
  await appendText(driver, "\nSECOND_WINDOW_DIRTY_UPGRADE\n");
  await driver.switch(main);
  await appendText(driver, "\nMAIN_WINDOW_DIRTY_UPGRADE\n");
  // 验证两份文档此时确实未落盘，成功升级必须负责保存。
  assert(
    !(await readFile(active, "utf8")).includes("MAIN_WINDOW_DIRTY_UPGRADE"),
  );
  assert(
    !(await readFile(other, "utf8")).includes("SECOND_WINDOW_DIRTY_UPGRADE"),
  );
  await setPolicy("allow");
  await showUpdate();
  await driver.button("下载安装更新").catch(() => {});
  await until(
    () => child.exitCode !== null,
    "Old app did not exit after successful installation",
    120_000,
  );
  assert.equal(child.exitCode, 0);
  assert.equal(installed(), NEW_VERSION);
  const nextPid = await until(
    () => ownedPids().find((pid) => pid !== child.pid),
    "New installed app did not relaunch",
    60_000,
  );
  driver = new DesktopDriver(port);
  await until(
    () => driver.request("GET", "/status").then(() => true),
    "Relaunched app driver did not start",
    60_000,
  );
  await driver.start();
  assert.equal(await driver.invoke("plugin:app|version"), NEW_VERSION);
  await loaded(driver, "MAIN_WINDOW_DIRTY_UPGRADE", 90_000);
  assert(
    (await readFile(active, "utf8")).includes("MAIN_WINDOW_DIRTY_UPGRADE"),
  );
  assert(
    (await readFile(other, "utf8")).includes("SECOND_WINDOW_DIRTY_UPGRADE"),
  );
  report.cases.push({
    name: "installed-deb-upgrades-saves-both-windows-and-relaunches",
    status: "passed",
    oldPid: child.pid,
    newPid: nextPid,
    installed: installed(),
  });
  await driver.screenshot(join(output, "upgraded.png"));
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await driver?.screenshot(join(output, "failed.png")).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await stop(child);
  // 仅终止当前用户的独立测试进程，不触碰正式墨知进程。
  for (const pid of ownedPids()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") {
        report.status = "failed";
        report.cleanupError = error.message;
        process.exitCode = 1;
      }
    }
  }
  await new Promise((accept) => server.close(accept));
  await saveReport();
}
