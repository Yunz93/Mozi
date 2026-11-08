import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { freePort, launch, resetProfile, stop } from "./process.mjs";
import { until } from "./driver.mjs";

assert.equal(process.platform, "win32");
const binary = resolve(process.env.MOZI_STOCK_BINARY);
const output = resolve(process.env.MOZI_DESKTOP_OUTPUT ?? ".perf/desktop");
await mkdir(output, { recursive: true });
const report = {
  scope:
    "Installed unsigned stock NSIS release configuration; native window launch and responsiveness, no embedded automation feature",
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  binarySha256: createHash("sha256")
    .update(await readFile(binary))
    .digest("hex"),
  limitations: [
    "Full interaction suite runs in the isolated test build; SmartScreen, signing and physical-device behavior are separate gates",
  ],
};
let child;
try {
  await resetProfile(true);
  const port = await freePort();
  child = launch(
    binary,
    [],
    { TAURI_WEBDRIVER_PORT: String(port) },
    join(output, "windows-stock-app.log"),
  );
  await delay(3000);
  report.native = await until(
    async () => {
      if (child.launchError) throw child.launchError;
      assert.equal(
        child.exitCode,
        null,
        "Stock app exited before showing a window",
      );
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
      const probe = JSON.parse(
        (await readFile(join(output, "windows-native.json"), "utf8")).replace(
          /^\uFEFF/,
          "",
        ),
      );
      return probe.processId === child.pid &&
        probe.responding &&
        probe.windows.some((w) => w.width > 100 && w.height > 100)
        ? probe
        : false;
    },
    "Installed stock app did not show a responsive native window",
    60_000,
    1000,
  );
  assert.equal(child.exitCode, null);
  await copyFile(
    join(output, "windows-native.png"),
    join(output, "windows-stock.png"),
  );
  let listening = false;
  try {
    await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    listening = true;
  } catch {
    /* Stock build has no test server. */
  }
  assert(!listening, "Stock app unexpectedly opened the test driver port");
  report.automationPortClosed = true;
  report.status = "passed";
  console.log(
    "PASS installed Windows stock app responsiveness and driver exclusion",
  );
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await stop(child);
  await writeFile(
    join(output, "windows-stock.json"),
    JSON.stringify(report, null, 2),
  );
}
