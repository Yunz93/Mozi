import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sampleMemory } from "./process.mjs";
import { until } from "./driver.mjs";
import {
  activateTasks,
  loaded,
  openWindow,
  persistedIndex,
} from "./support.mjs";

/** Measurements include WebDriver round trips and background work; they are not SLOs. */
export async function measure(context, count, windows) {
  const { driver: d, vault, child, beforePids, binary, output, mode } = context;
  const index = await persistedIndex(context);
  assert.equal(
    Object.keys(index.byPath).length,
    count,
    "Incomplete persisted index",
  );
  const firstIndexMs = performance.now() - context.started;
  const handles = [await d.request("GET", d.path("/window"))];
  const note = join(vault, "active.md");
  await activateTasks(d);
  while (handles.length < windows)
    handles.push(await openWindow(d, note, true, "ORIGINAL_CONTENT"));
  if (mode === "native")
    await until(async () => {
      const stats = await d.invoke("vault_watch_stats");
      return stats.watchers === 1 && stats.subscriptions === windows * 2 + 1;
    }, "Unexpected watcher ownership during measurement");
  await delay(8000);
  const memory = await sampleMemory(child.pid, beforePids, binary);
  const renderedRows = [];
  for (const handle of handles) {
    await d.switch(handle);
    const rows = await d.execute(
      "return document.querySelectorAll('[data-file-tree-item]').length",
    );
    assert(rows > 0 && rows < (count >= 1000 ? 70 : 200));
    renderedRows.push(rows);
  }
  await d.screenshot(join(output, `perf-${mode}-${count}-${windows}.png`));
  const writeToAllEditorsMs = [];
  for (let i = 0; i < 3; i++) {
    const marker = `MEASURE_${mode}_${count}_${windows}_${i}`;
    const started = performance.now();
    await writeFile(note, `# Active\n\n${marker}\n\n- [ ] MEASURE_TASK\n`);
    for (const handle of handles) {
      await d.switch(handle);
      await loaded(d, marker, 60_000);
    }
    writeToAllEditorsMs.push(performance.now() - started);
  }
  const sorted = [...writeToAllEditorsMs].sort((a, b) => a - b);
  const result = {
    mode,
    count,
    windows,
    restoreMs: context.restoreMs,
    firstIndexMs,
    renderedRows,
    watchStats: await d.invoke("vault_watch_stats"),
    memory,
    writeToAllEditorsMs,
    medianMs: sorted[1],
    maxMs: sorted.at(-1),
    measurementScope:
      "Synthetic vault, fresh profile; elapsed time includes driver polling and sequential window switching; three samples, no percentile or energy claim",
  };
  console.log(`PASS performance ${mode} ${count} notes ${windows} windows`);
  return result;
}
