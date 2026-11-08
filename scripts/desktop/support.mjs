import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { until } from "./driver.mjs";

export const normalizePath = (value) => {
  const path = value
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "");
  return process.platform === "win32" ? path.toLowerCase() : path;
};
export const loaded = (driver, marker, timeout = 30_000) =>
  until(
    async () => (await driver.editor()).includes(marker),
    `Editor did not show ${marker}`,
    timeout,
  );
export const tasks = async (driver) =>
  (await driver.invoke("task_calendar_snapshot")).tasks;
export const hasTask = async (driver, title) =>
  (await tasks(driver)).some((task) => task.title === title);
export async function activateTasks(driver) {
  await until(async () => {
    await driver.click('button[aria-label="待办事项"]');
    return true;
  }, "Cannot open task calendar");
  await until(async () => {
    await driver.click('button[aria-label="关闭待办事项"]');
    return true;
  }, "Cannot close task calendar");
}
export async function openWindow(
  driver,
  path,
  withVault = true,
  marker = "OWN_SAVE_MARKER",
) {
  const before = new Set(await driver.handles());
  await driver.invoke("open_file_in_new_window", { path, withVault });
  const handle = await until(
    async () => (await driver.handles()).find((handle) => !before.has(handle)),
    "New window did not register",
    45_000,
  );
  await driver.switch(handle);
  await loaded(driver, marker, 90_000);
  return handle;
}
export async function closeWindow(driver, handle) {
  await driver.switch(handle);
  await driver.execute(
    "setTimeout(()=>void window.__TAURI_INTERNALS__.invoke('force_close_window'),300);return true",
  );
  await until(
    async () => !(await driver.handles()).includes(handle),
    "Window did not close",
  );
}
export async function appendText(driver, text) {
  await driver.click(".cm-content");
  await driver.shortcut(process.platform === "darwin" ? "\uE015" : "\uE010");
  await driver.type(".cm-content", text);
  await loaded(driver, text.trim());
}
export async function persistedIndex(context, file = "chunk-index.json") {
  const data = await context.driver.invoke("plugin:path|resolve_directory", {
    directory: 14,
  });
  const base = join(data, "MarkdownPress", "vault-index");
  return until(
    async () => {
      let entries;
      try {
        entries = await readdir(base, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const value = JSON.parse(
            await readFile(join(base, entry.name, file), "utf8"),
          );
          if (normalizePath(value.vaultRoot) === normalizePath(context.vault))
            return value;
        } catch (error) {
          if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
            throw error;
        }
      }
      return false;
    },
    `No persisted ${file}`,
    180_000,
    150,
  );
}
