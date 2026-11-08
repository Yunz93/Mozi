import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { freePort, launch, resetProfile, stop } from "./process.mjs";
import { until } from "./driver.mjs";

assert.equal(process.platform, "darwin");
const output = resolve(process.env.MOZI_DESKTOP_OUTPUT ?? ".perf/desktop");
await mkdir(output, { recursive: true });
const app = resolve("src-tauri/target/release/bundle/macos/墨知.app");
const plist = JSON.parse(
  execFileSync(
    "plutil",
    ["-convert", "json", "-o", "-", join(app, "Contents/Info.plist")],
    { encoding: "utf8" },
  ),
);
assert.equal(plist.CFBundleIdentifier, "com.bxyz.markdown-press");
const binary = join(app, "Contents/MacOS", plist.CFBundleExecutable);
const report = {
  scope:
    "Unsigned stock release-configuration .app; installation layout and native window launch, no embedded automation feature",
  identifier: plist.CFBundleIdentifier,
  binarySha256: createHash("sha256")
    .update(await readFile(binary))
    .digest("hex"),
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  limitations: [
    "Gatekeeper, notarization, updater signatures and physical hardware require release/device gates",
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
    join(output, "macos-stock-app.log"),
  );
  const swift = `import AppKit
import CoreGraphics
let pid = Int32(CommandLine.arguments[1])!
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
let bounds = owned.compactMap { $0[kCGWindowBounds as String] }
let result: [String: Any] = ["windowCount": owned.count, "bounds": bounds]
print(String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)`;
  report.window = await until(
    async () => {
      if (child.launchError) throw child.launchError;
      assert.equal(
        child.exitCode,
        null,
        "Stock application exited before showing a window",
      );
      const window = JSON.parse(
        execFileSync("swift", ["-e", swift, String(child.pid)], {
          encoding: "utf8",
          timeout: 30_000,
        }),
      );
      return window.windowCount > 0 ? window : false;
    },
    "Stock application did not create an onscreen native window",
    90_000,
    1000,
  );
  await delay(5000);
  assert.equal(
    child.exitCode,
    null,
    "Stock application exited during launch smoke",
  );
  let listening = false;
  try {
    await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    listening = true;
  } catch {
    /* No automation server is expected. */
  }
  assert(!listening, "Stock application unexpectedly started the test driver");
  report.automationPortClosed = true;
  report.status = "passed";
  console.log(
    "PASS macOS stock release application launch and driver exclusion",
  );
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  await stop(child);
  await writeFile(
    join(output, "macos-stock.json"),
    JSON.stringify(report, null, 2),
  );
}
