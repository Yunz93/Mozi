import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DesktopDriver, until } from "./driver.mjs";
import { freePort, launch, stop } from "./process.mjs";

// 使用独立标识和真实 WKWebView/IPC；仅网络版本索引与 Beta 清单来自回环夹具。
const root = await mkdtemp(join(tmpdir(), "mozi-beta-updater-"));
const output = resolve(".perf", basename(root));
await mkdir(output, { recursive: true });
const report = { runtime: "tauri:dev", status: "running", cases: [], output };
const paths = [];
let indexStatus = 404;
const { version: currentVersion } = JSON.parse(
  await readFile("package.json", "utf8"),
);
const [major, minor, patch] = currentVersion.split("-")[0].split(".");
const nextVersion = `${major}.${minor}.${BigInt(patch) + 1n}`;
const betaVersion = `${nextVersion}-beta.10`;
const release = (tag_name, extra = {}) => ({
  tag_name,
  draft: false,
  prerelease: tag_name.includes("-beta."),
  assets: [{ name: "latest.json" }],
  ...extra,
});
const index = {
  schemaVersion: 1,
  releases: [
    release(`v${nextVersion}-beta.2`),
    release(`v${betaVersion}`),
    release(`v${currentVersion}`),
    release("v9.0.0", { draft: true }),
    release("v8.0.0", { prerelease: true }),
  ],
};
const server = createServer((request, response) => {
  paths.push(request.url);
  response.setHeader("content-type", "application/json");
  if (request.url === "/releases.json") {
    response.writeHead(indexStatus);
    response.end(JSON.stringify(index));
    return;
  }
  const match = /^\/releases\/download\/(v[^/]+)\/latest\.json$/.exec(
    request.url,
  );
  if (match) {
    const version = match[1].slice(1);
    const platform = {
      url: `https://github.com/Yunz93/Mozi/releases/download/${match[1]}/Mozi.app.tar.gz`,
      signature: "test-fixture-detection-only",
    };
    response.end(
      JSON.stringify({
        version,
        notes: "Beta 更新检查回归验证",
        pub_date: "2026-11-11T00:00:00Z",
        platforms: { "darwin-aarch64": platform, "darwin-x86_64": platform },
      }),
    );
    return;
  }
  response.writeHead(403);
  response.end('{"message":"API rate limit exceeded"}');
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const fixture = `http://127.0.0.1:${server.address().port}`;
const vitePort = await freePort();
const driverPort = await freePort();
const config = JSON.parse(
  await readFile("src-tauri/tauri.desktop-e2e.conf.json", "utf8"),
);
config.identifier = `com.bxyz.${basename(root).toLowerCase()}`;
config.build = {
  devUrl: `http://localhost:${vitePort}`,
  beforeDevCommand: `npm run dev -- --port ${vitePort} --strictPort`,
};
const configPath = join(root, "tauri.beta-updater.conf.json");
await writeFile(configPath, JSON.stringify(config));
const child = launch(
  "npm",
  [
    "run",
    "tauri:dev",
    "--",
    "--features",
    "desktop-e2e",
    "--config",
    configPath,
  ],
  {
    TAURI_WEBDRIVER_PORT: String(driverPort),
    MOZI_TEST_RELEASE_INDEX_URL: `${fixture}/releases.json`,
  },
  join(output, "tauri-dev.log"),
);
const driver = new DesktopDriver(driverPort);
const save = () =>
  writeFile(
    join(output, "results.json"),
    JSON.stringify({ ...report, requests: paths }, null, 2),
  );
async function check(name, run) {
  await run();
  report.cases.push({ name, status: "passed" });
  console.log(`PASS ${name}`);
  await save();
}
async function settings(patch) {
  const result = await driver.asyncExecute(
    "const done=arguments[arguments.length-1];const patch=arguments[0];import('/src/store/appStore.ts').then(({useAppStore})=>{useAppStore.getState().updateSettings(patch);useAppStore.getState().setSettingsOpen(true);done(true)},error=>done({error:String(error)}));",
    patch,
  );
  assert.equal(result, true);
}
const indexRequests = () =>
  paths.filter((path) => path === "/releases.json").length;
try {
  await until(
    async () => {
      if (child.exitCode !== null)
        throw new Error(`tauri:dev exited ${child.exitCode}`);
      return (await driver.request("GET", "/status"))?.ready !== false;
    },
    "tauri:dev driver did not become ready",
    180_000,
    500,
  );
  await driver.start();
  await until(
    () => driver.execute("return !!document.querySelector('.workspace-root')"),
    "Application did not mount",
    60_000,
  );
  await settings({
    language: "zh-CN",
    autoCheckForUpdates: false,
    acceptBetaUpdates: true,
  });
  await until(
    () => driver.find('//button[normalize-space(.)="关于"]'),
    "Settings did not render",
  );
  await driver.button("关于");
  await until(
    async () => (await driver.body()).includes("接收 Beta 更新"),
    "Updates screen missing",
  );

  await check("missing-index-shows-error-rather-than-up-to-date", async () => {
    await driver.button("立即检查");
    await until(
      async () => (await driver.body()).includes("Beta 更新索引尚未发布"),
      "Missing-index error not shown",
    );
    assert(!(await driver.body()).includes("已是最新版本"));
    await driver.screenshot(join(output, "missing-index.png"));
  });

  await check("rate-limited-api-does-not-block-beta-discovery", async () => {
    assert.equal(
      (await fetch(`${fixture}/repos/Yunz93/Mozi/releases?per_page=100`))
        .status,
      403,
    );
    indexStatus = 200;
    await delay(5200);
    await driver.button("立即检查");
    await until(
      async () => (await driver.body()).includes(`发现新版本 ${betaVersion}`),
      "Beta version not found",
    );
    assert.equal(indexRequests(), 2);
    assert(paths.includes(`/releases/download/v${betaVersion}/latest.json`));
    await driver.screenshot(join(output, "beta-update.png"));
  });

  await check("manual-and-auto-checks-share-index-cache", async () => {
    const before = indexRequests();
    const manifests = () =>
      paths.filter((path) => path.includes("/latest.json")).length;
    await driver.button("立即检查");
    await until(
      async () => (await driver.body()).includes(`发现新版本 ${betaVersion}`),
      "Repeated check did not finish",
    );
    const afterManual = manifests();
    await settings({ autoCheckForUpdates: true });
    await until(
      () => manifests() > afterManual,
      "Automatic check did not reach native updater",
    );
    assert.equal(indexRequests(), before);
    await settings({ autoCheckForUpdates: false });
  });

  await check(
    "turning-beta-off-clears-results-and-checks-real-stable-feed",
    async () => {
      const before = indexRequests();
      await driver.click(
        '//label[.//p[normalize-space(.)="接收 Beta 更新"]]/input',
      );
      await until(
        async () => !(await driver.body()).includes(`可更新到 ${betaVersion}`),
        "Old Beta result retained",
      );
      await driver.button("立即检查");
      await until(
        async () =>
          /发现新版本 \d+\.\d+\.\d+[。\s]|当前已经是最新版本。/.test(
            await driver.body(),
          ),
        "Real stable check did not finish",
        40_000,
      );
      assert.equal(indexRequests(), before);
      await driver.screenshot(join(output, "stable-update.png"));
    },
  );
  assert.equal(paths.filter((path) => path.startsWith("/repos/")).length, 1);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  try {
    await writeFile(join(output, "failure.txt"), await driver.body());
    await driver.screenshot(join(output, "failure.png"));
  } catch {
    /* 启动失败时可能尚无窗口。 */
  }
  process.exitCode = 1;
} finally {
  await save();
  await stop(child);
  await new Promise((accept) => server.close(accept));
}
console.log(
  JSON.stringify({ status: report.status, output, error: report.error }),
);
