/* global window, Storage */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { platform, arch, release } from "node:os";
import { execFileSync } from "node:child_process";
import { noteContent, noteName, longDocument } from "./fixtures.mjs";

// This is deliberately a browser/dev benchmark, not a packaged Tauri claim.
const count = Number(process.env.PERF_BROWSER_COUNT ?? 100);
const sizes = (process.env.PERF_DOCUMENT_BYTES ?? "100000")
  .split(",")
  .map(Number);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  !sizes.every((n) => Number.isSafeInteger(n) && n > 0)
)
  throw new Error("Invalid fixture sizes");
const server = await createServer({
  server: { port: 4175, host: "127.0.0.1", strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "zh-CN",
  });
  const contents = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      noteName(i),
      noteContent(i, count),
    ]),
  );
  for (const size of sizes) contents[`long-${size}.md`] = longDocument(size);
  await context.addInitScript(
    ({ contents }) => {
      const handles = new Map(
        Object.entries(contents).map(([name, text]) => [
          name,
          {
            kind: "file",
            name,
            getFile: async () =>
              new File([text], name, { type: "text/markdown" }),
            createWritable: async () => ({
              write: async (value) => {
                text = String(value);
              },
              close: async () => {},
            }),
          },
        ]),
      );
      window.showDirectoryPicker = async () => ({
        kind: "directory",
        name: "perf-vault",
        entries: async function* () {
          yield* handles.entries();
        },
        getFileHandle: async (name) => {
          if (!handles.has(name))
            throw new DOMException("Missing", "NotFoundError");
          return handles.get(name);
        },
        getDirectoryHandle: async () => {
          throw new DOMException("Missing", "NotFoundError");
        },
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
      });
      const original = Storage.prototype.setItem;
      window.__perfWrites = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key === "markdown-press-settings") window.__perfWrites++;
        return original.call(this, key, value);
      };
    },
    { contents },
  );
  const rows = [];
  await mkdir(".perf", { recursive: true });
  for (const cache of ["cold", "warm"]) {
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const started = performance.now();
    await page.goto("http://127.0.0.1:4175");
    const open = page.getByRole("button", { name: "打开知识库", exact: true });
    await open.waitFor();
    rows.push({
      operation: "startup-to-folder-choice",
      cache,
      ms: performance.now() - started,
    });
    await open.click();
    await page.getByText(noteName(0).slice(0, -3), { exact: true }).waitFor();
    const skip = page.getByRole("button", { name: "暂不", exact: true });
    // Download consent is optional; no model network operation is performed.
    await skip
      .waitFor({ timeout: 3000 })
      .then(() => skip.click())
      .catch(() => {});
    for (const size of sizes) {
      const name = `long-${size}`;
      const openStarted = performance.now();
      await page.getByText(name, { exact: true }).click();
      await page.locator(".cm-content[contenteditable=true]:visible").waitFor();
      rows.push({
        operation: "open-document",
        cache,
        bytes: size,
        ms: performance.now() - openStarted,
      });
      const before = await page.evaluate(() => window.__perfWrites);
      await page.locator(".cm-content[contenteditable=true]:visible").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type("\nPERF_EDIT_MARKER");
      const switchStarted = performance.now();
      await page.getByRole("button", { name: "阅读", exact: true }).click();
      await page
        .getByRole("article")
        .getByText("PERF_EDIT_MARKER", { exact: true })
        .waitFor();
      rows.push({
        operation: "edit-to-reading",
        cache,
        bytes: size,
        ms: performance.now() - switchStarted,
        settingsWrites:
          (await page.evaluate(() => window.__perfWrites)) - before,
      });
      await page.getByRole("button", { name: "实时预览", exact: true }).click();
    }
    await page.screenshot({ path: `.perf/browser-${cache}.png` });
    if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
    await page.close();
  }
  await writeFile(
    ".perf/browser.json",
    JSON.stringify(
      {
        schema: 1,
        git: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        runtime: {
          platform: platform(),
          arch: arch(),
          release: release(),
          browser: browser.version(),
        },
        scope:
          "Development browser with in-memory File System Access fixtures; cold/warm refers to browser context assets/settings, NOT embedding caches or OS disk cache",
        rows,
      },
      null,
      2,
    ),
  );
  console.log("Wrote .perf/browser.json and browser screenshots");
} finally {
  await browser?.close();
  await server.close();
}
