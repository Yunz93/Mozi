import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  realpath,
} from "node:fs/promises";
import { tmpdir, arch, release, cpus, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DesktopDriver, until } from "./driver.mjs";
import { makeVault } from "./fixtures.mjs";
import { seedSettingsOnUnload } from "./fixture-settings.mjs";
import { assertCaseCoverage } from "./case-coverage.mjs";
import {
  freePort,
  launch,
  resetProfile,
  stop,
  processSnapshot,
} from "./process.mjs";

const binary = resolve(
  process.env.MOZI_DESKTOP_BINARY ??
    "src-tauri/target/release/mozi-desktop-e2e",
);
const provider = "embedded";
const output = resolve(process.env.MOZI_DESKTOP_OUTPUT ?? ".perf/desktop");
// Match native canonical identities (notably /var -> /private/var on macOS).
const root = await realpath(await mkdtemp(join(tmpdir(), "mozi-desktop-")));
await mkdir(output, { recursive: true });
const report = {
  schema: 1,
  source:
    process.env.MOZI_DESKTOP_SOURCE_REV ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
  sourceDirty: process.env.MOZI_DESKTOP_SOURCE_REV
    ? process.env.MOZI_DESKTOP_SOURCE_DIRTY === "1"
    : execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0,
  sourceChanges: process.env.MOZI_DESKTOP_SOURCE_REV
    ? []
    : execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean),
  platform: process.platform,
  arch: arch(),
  osRelease: release(),
  logicalProcessors: cpus().length,
  systemMemoryBytes: totalmem(),
  provider,
  binarySha256: createHash("sha256")
    .update(await readFile(binary))
    .digest("hex"),
  scope:
    "optimized test build, real WebView and Rust filesystem; no backend mocks",
  cases: [],
  performance: [],
  limitations: [
    "Virtual desktop: suspend, physical displays, GPU/energy and production signing are separate gates",
  ],
};
let sequence = 0;

async function save() {
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(report, null, 2),
  );
}

export async function session(mode = "native", count = 100) {
  const name = `session-${++sequence}`;
  const vault = await makeVault(join(root, name, "vault"), count);
  await resetProfile();
  const beforePids = new Set((await processSnapshot()).map((p) => p.pid));
  const port = await freePort();
  const env = {
    MOZI_WATCH_MODE: mode,
    RUST_BACKTRACE: "1",
    TAURI_WEBDRIVER_PORT: String(port),
  };
  const child = launch(binary, [], env, join(output, `${name}-app.log`));
  const driver = new DesktopDriver(port);
  const close = async () => {
    try {
      if (child.exitCode === null && !child.signalCode) await driver.quit();
    } finally {
      await stop(child);
    }
  };
  try {
    await until(
      async () => {
        if (child.launchError) throw child.launchError;
        if (child.exitCode !== null)
          throw new Error(`Application/driver exited ${child.exitCode}`);
        return (await driver.request("GET", "/status"))?.ready !== false;
      },
      "WebDriver server did not become ready",
      45_000,
      150,
    );
    await driver.start();
    console.log(`READY ${name} ${mode} ${count} notes`);
    await until(
      async () => (await driver.body()).length > 10,
      "Application did not render",
      60_000,
    );
    const userAgent = await driver.execute("return navigator.userAgent");
    report.userAgent = userAgent;
    report.capabilities = driver.capabilities;
    await driver.execute(
      `return (${seedSettingsOnUnload.toString()})(arguments[0])`,
      {
        language: "zh-CN",
        lastKnowledgeBasePath: vault,
        lastOpenedFilePath: join(vault, "active.md"),
        knowledgeBases: [
          {
            path: vault,
            name: "Acceptance vault",
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        embeddingProvider: "none",
        builtinEmbeddingDownloadConsent: "denied",
        autoSaveInterval: 600000,
        autoCheckForUpdates: false,
      },
    );
    const started = performance.now();
    await driver.refresh();
    await until(
      async () => (await driver.editor()).includes("ORIGINAL_CONTENT"),
      "Restored document missing",
      120_000,
    );
    const restoreMs = performance.now() - started;
    if ((await driver.invoke("vault_watch_mode")) !== mode)
      throw new Error("Wrong filesystem observation mode");
    return {
      driver,
      vault,
      root,
      output,
      mode,
      child,
      beforePids,
      restoreMs,
      started,
      close,
    };
  } catch (error) {
    if (process.platform === "win32" && child.pid) {
      try {
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-File",
            "scripts/desktop/windows-diagnostics.ps1",
            "-ApplicationPid",
            String(child.pid),
            "-OutputDirectory",
            output,
          ],
          { timeout: 20_000, stdio: "pipe" },
        );
      } catch {
        /* Preserve the original driver/startup error. */
      }
    }
    await driver
      .screenshot(join(output, `${name}-startup-failed.png`))
      .catch(() => {});
    await close().catch(() => {});
    throw error;
  }
}

export async function check(context, name, action) {
  const started = performance.now();
  try {
    const evidence = await action();
    report.cases.push({
      name,
      status: "passed",
      ms: performance.now() - started,
      evidence,
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({
      name,
      status: "failed",
      ms: performance.now() - started,
      error: error.message,
    });
    const diagnostics = {};
    for (const [key, read] of [
      ["body", () => context.driver.body()],
      ["tasks", () => context.driver.invoke("task_calendar_snapshot")],
      [
        "restoredPaths",
        () =>
          context.driver.execute(
            "const s=JSON.parse(localStorage.getItem('markdown-press-settings')||'null')?.state?.settings;return {vault:s?.lastKnowledgeBasePath,file:s?.lastOpenedFilePath}",
          ),
      ],
      [
        "tree",
        () =>
          context.driver.execute(
            "return [...document.querySelectorAll('.workspace-tree-row')].map(e=>e.title)",
          ),
      ],
    ]) {
      try {
        diagnostics[key] = await read();
      } catch {
        /* Keep the first failure. */
      }
    }
    await writeFile(
      join(output, `${name}-diagnostics.json`),
      JSON.stringify(diagnostics, null, 2),
    );
    await context.driver
      .screenshot(join(output, `${name}-failed.png`))
      .catch(() => {});
    await save();
    throw error;
  }
  await save();
}

try {
  const context = await session();
  try {
    await check(context, "driver-bootstrap", async () => {
      await context.driver.screenshot(join(output, "bootstrap.png"));
      return {
        userAgent: report.userAgent,
        restoreMs: context.restoreMs,
        stats: await context.driver.invoke("vault_watch_stats"),
      };
    });
  } finally {
    await context.close();
  }
  if (process.env.MOZI_DESKTOP_SUITE !== "bootstrap") {
    // Scenario modules share only the public WebDriver/IPC interface.
    const { functional, fallback, largeTree } = await import("./scenarios.mjs");
    const { editorFlows, closingFlows, exitFlow } =
      await import("./user-flows.mjs");
    for (const [action, count] of [
      [functional, 100],
      [fallback, 100],
      [largeTree, 10000],
      [editorFlows, 100],
      [closingFlows, 100],
      [exitFlow, 100],
    ]) {
      const context = await session("native", count);
      try {
        await action(context, check);
      } finally {
        await context.close();
      }
    }
    assertCaseCoverage(report.cases);
    const { measure } = await import("./performance.mjs");
    const full = process.env.MOZI_DESKTOP_PERFORMANCE === "full";
    for (const mode of ["poll", "native"])
      for (const count of full ? [100, 1000, 10000] : [100])
        for (const windows of full ? [1, 2, 5] : [1]) {
          const context = await session(mode, count);
          try {
            report.performance.push(await measure(context, count, windows));
            await save();
          } finally {
            await context.close();
          }
        }
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await save();
}
