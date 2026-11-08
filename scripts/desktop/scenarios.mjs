import assert from "node:assert/strict";
import {
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  unlink,
  access,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { until } from "./driver.mjs";
import { diskRename } from "./fixtures.mjs";
import {
  activateTasks,
  appendText,
  closeWindow,
  hasTask,
  loaded,
  normalizePath,
  openWindow,
  tasks,
} from "./support.mjs";

const gone = async (path) => {
  try {
    await access(path);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
};

export async function functional(context, check) {
  const { driver: d, vault, output } = context;
  const note = join(vault, "active.md");
  await activateTasks(d);
  await check(context, "initial-snapshot-and-shared-handle", async () => {
    const stats = await until(async () => {
      const value = await d.invoke("vault_watch_stats");
      return value.watchers === 1 && value.subscriptions === 3 ? value : false;
    }, "Expected one broker and three references");
    await until(
      () => hasTask(d, "ACCEPTANCE_INITIAL_TASK"),
      "Initial task missing",
    );
    assert.deepEqual(
      (await tasks(d)).map((task) => task.title),
      ["ACCEPTANCE_INITIAL_TASK"],
    );
    return stats;
  });
  await check(
    context,
    "external-edits-reload-editor-and-task-index",
    async () => {
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const marker = `EXTERNAL_CONTENT_${i}`;
        const started = performance.now();
        await writeFile(
          note,
          `# Active\n\n${marker}\n\n- [ ] ACCEPTANCE_UPDATED_TASK\n`,
        );
        await loaded(d, marker);
        samples.push(performance.now() - started);
      }
      await until(
        () => hasTask(d, "ACCEPTANCE_UPDATED_TASK"),
        "Changed task missing",
      );
      return { writeToEditorMs: samples };
    },
  );
  await check(context, "atomic-file-replacement", async () => {
    const temporary = join(vault, "save.tmp");
    await writeFile(
      temporary,
      "# Active\n\nATOMIC_REPLACEMENT\n\n- [ ] ATOMIC_TASK\n",
    );
    await diskRename(temporary, note);
    await loaded(d, "ATOMIC_REPLACEMENT");
    await until(() => hasTask(d, "ATOMIC_TASK"), "Replacement task missing");
    return { editorReloaded: true };
  });
  await check(context, "unicode-create-rename-case-rename-delete", async () => {
    const first = join(vault, "研发😀.md");
    const second = join(vault, "研发😀CASE.md");
    const third = join(vault, "研发😀case.md");
    await writeFile(first, "# Unicode\n\n- [ ] UNICODE_TASK\n");
    await until(() => d.row("研发😀"), "Unicode note missing");
    await diskRename(first, second);
    await until(
      async () => (await d.row("研发😀CASE")) && !(await d.row("研发😀")),
      "Rename missing",
    );
    await diskRename(second, third);
    await until(
      async () => (await d.row("研发😀case")) && !(await d.row("研发😀CASE")),
      "Case-only rename missing",
    );
    await unlink(third);
    await until(
      async () =>
        !(await d.row("研发😀case")) && !(await hasTask(d, "UNICODE_TASK")),
      "Deleted note retained",
    );
    return { unicodeAndCaseRename: true };
  });
  await check(context, "nested-directory-move-and-delete", async () => {
    const source = join(vault, "directory-source");
    const target = join(vault, "directory-moved");
    await mkdir(join(source, "inner"), { recursive: true });
    await writeFile(
      join(source, "inner", "leaf.md"),
      "# Leaf\n\n- [ ] NESTED_MOVE_TASK\n",
    );
    await until(() => d.row("directory-source"), "New directory missing");
    await diskRename(source, target);
    await until(
      async () =>
        (await d.row("directory-moved")) && !(await d.row("directory-source")),
      "Directory move missing",
    );
    await rm(target, { recursive: true, maxRetries: 20, retryDelay: 100 });
    await until(
      async () =>
        !(await d.row("directory-moved")) &&
        !(await hasTask(d, "NESTED_MOVE_TASK")),
      "Deleted directory retained",
    );
    return { movedAndDeleted: true };
  });
  await check(context, "trash-hidden-and-symlink-policy", async () => {
    const path = join(vault, "trash-target.md");
    await writeFile(path, "# Trash target\n\n- [ ] MOVE_TO_TRASH_TASK\n");
    await until(() => hasTask(d, "MOVE_TO_TRASH_TASK"), "New task missing");
    await diskRename(path, join(vault, ".trash", "trash-target.md"));
    await until(
      async () =>
        !(await d.row("trash-target")) &&
        !(await hasTask(d, "MOVE_TO_TRASH_TASK")),
      "Trash note retained",
    );
    await diskRename(join(vault, ".trash", "trash-target.md"), path);
    await until(
      async () =>
        (await d.row("trash-target")) &&
        (await hasTask(d, "MOVE_TO_TRASH_TASK")),
      "Restored note missing",
    );
    await writeFile(
      join(vault, ".hidden", "added.md"),
      "# Hidden\n\n- [ ] EXCLUDED_HIDDEN_TASK\n",
    );
    const outside = join(dirname(vault), "outside.md");
    await writeFile(outside, "# Outside\n\n- [ ] SYMLINK_OUTSIDE_TASK\n");
    await symlink(outside, join(vault, "outside-link.md"), "file");
    await delay(1500);
    assert(!(await d.row(".hidden")) && !(await d.row("outside-link")));
    assert(
      !(await hasTask(d, "EXCLUDED_HIDDEN_TASK")) &&
        !(await hasTask(d, "SYMLINK_OUTSIDE_TASK")),
    );
    await unlink(path);
    await unlink(join(vault, "outside-link.md"));
    return { trashRestore: true, hiddenExcluded: true, symlinkExcluded: true };
  });
  await check(
    context,
    "own-save-does-not-trigger-external-conflict",
    async () => {
      await appendText(d, "\nOWN_SAVE_MARKER");
      await d.shortcut("s");
      await until(
        async () => (await readFile(note, "utf8")).includes("OWN_SAVE_MARKER"),
        "Own save did not reach disk",
      );
      await delay(800);
      assert((await d.editor()).includes("OWN_SAVE_MARKER"));
      assert(!(await d.body()).includes("本地文件已变化"));
      return { savedToDisk: true, falseConflict: false };
    },
  );
  await check(context, "same-path-directory-recreation", async () => {
    const parent = join(vault, "recreated");
    await mkdir(parent);
    await writeFile(
      join(parent, "old.md"),
      "# Old\n\n- [ ] OLD_DIRECTORY_TASK\n",
    );
    await until(() => d.row("recreated"), "Directory missing");
    await d.clickRow("recreated");
    await until(() => d.row("old"), "Old child missing");
    await rm(parent, { recursive: true, maxRetries: 20, retryDelay: 100 });
    await mkdir(parent);
    await writeFile(
      join(parent, "new.md"),
      "# New\n\n- [ ] NEW_DIRECTORY_TASK\n",
    );
    await until(
      async () => (await d.row("new")) && !(await d.row("old")),
      "Recreated directory kept old children",
    );
    await until(
      async () =>
        (await hasTask(d, "NEW_DIRECTORY_TASK")) &&
        !(await hasTask(d, "OLD_DIRECTORY_TASK")),
      "Recreated tasks stale",
    );
    return { staleChildrenRemoved: true };
  });
  let handles = await d.handles();
  await check(
    context,
    "two-and-five-real-windows-share-one-watch",
    async () => {
      const observations = [];
      for (const count of [2, 5]) {
        while (handles.length < count) {
          await openWindow(d, note);
          handles = await d.handles();
        }
        observations.push(
          await until(async () => {
            const value = await d.invoke("vault_watch_stats");
            return value.watchers === 1 && value.subscriptions === 2 * count + 1
              ? { windows: count, ...value }
              : false;
          }, "Window references did not converge"),
        );
      }
      await d.screenshot(join(output, "five-windows.png"));
      return observations;
    },
  );
  await check(context, "window-subscription-ownership", async () => {
    await d.switch(handles[0]);
    const token = await d.invoke("subscribe_vault", {
      path: vault,
      directory: true,
    });
    await d.switch(handles.at(-1));
    await assert.rejects(
      d.invoke("get_vault_changes", {
        subscriptionId: token.subscriptionId,
        epoch: token.epoch,
        afterSeq: token.seq,
      }),
      /belong|owner/i,
    );
    await assert.rejects(
      d.invoke("unsubscribe_vault", { subscriptionId: token.subscriptionId }),
      /belong|owner/i,
    );
    await d.switch(handles[0]);
    await d.invoke("unsubscribe_vault", {
      subscriptionId: token.subscriptionId,
    });
    return { crossWindowReadRejected: true, crossWindowReleaseRejected: true };
  });
  await check(
    context,
    "task-observer-survives-all-vault-windows-closing",
    async () => {
      const standalone = join(dirname(vault), "standalone.md");
      await writeFile(standalone, "# Standalone\n\nSTANDALONE_ORIGINAL\n");
      const monitor = await openWindow(
        d,
        standalone,
        false,
        "STANDALONE_ORIGINAL",
      );
      for (const handle of handles) await closeWindow(d, handle);
      await d.switch(monitor);
      const stats = await until(async () => {
        const value = await d.invoke("vault_watch_stats");
        return value.subscriptions === 2 && value.watchers === 2
          ? value
          : false;
      }, "Background/standalone references incorrect");
      await writeFile(
        join(vault, "background.md"),
        "# Background\n\n- [ ] BACKGROUND_WITHOUT_VAULT_WINDOWS\n",
      );
      await until(
        () => hasTask(d, "BACKGROUND_WITHOUT_VAULT_WINDOWS"),
        "Background task missed change",
      );
      const active = await openWindow(d, note);
      await closeWindow(d, monitor);
      await d.switch(active);
      handles = [active];
      await until(
        async () => (await d.invoke("vault_watch_stats")).subscriptions === 3,
        "References leaked",
      );
      return {
        noVaultWindowsDuringWrite: true,
        standaloneWindowKeptAppAlive: true,
        stats,
      };
    },
  );
  await check(
    context,
    "exact-file-grant-does-not-authorize-parent-watch",
    async () => {
      const parent = join(dirname(vault), "isolated");
      await mkdir(parent);
      const path = join(parent, "one.md");
      await writeFile(path, "# Isolated\n");
      await d.invoke("register_allowed_path", { path, recursive: false });
      await assert.rejects(
        d.invoke("subscribe_vault", { path: parent, directory: true }),
        /permission|allowed|scope/i,
      );
      return { parentDirectoryRejected: true };
    },
  );
  await check(
    context,
    "root-disappearance-recreation-and-window-reload",
    async () => {
      const backup = `${vault}-unavailable`;
      await diskRename(vault, backup);
      await until(
        async () =>
          (await d.invoke("task_calendar_snapshot")).vaults.some(
            (v) =>
              normalizePath(v.path) === normalizePath(vault) && v.unavailable,
          ),
        "Root loss not reported",
      );
      await delay(2200);
      await diskRename(backup, vault);
      await writeFile(
        join(vault, "recovered.md"),
        "# Recovery\n\n- [ ] ROOT_RECOVERY_TASK\n",
      );
      await until(
        async () =>
          (await d.row("recovered")) &&
          (await hasTask(d, "ROOT_RECOVERY_TASK")),
        "Root recovery missed file/task",
        30_000,
      );
      await d.clickRow("active");
      await loaded(d, "OWN_SAVE_MARKER");
      await d.refresh();
      await loaded(d, "OWN_SAVE_MARKER");
      return { treeAndTaskRecovered: true, windowReloaded: true };
    },
  );
  await check(context, "external-edit-preserves-unsaved-buffer", async () => {
    await appendText(d, "\nLOCAL_UNSAVED_MARKER");
    await writeFile(note, "# External\n\nEXTERNAL_CONFLICT_MARKER\n");
    await until(
      async () => (await d.body()).includes("本地文件已变化"),
      "Conflict notification missing",
    );
    assert((await d.editor()).includes("LOCAL_UNSAVED_MARKER"));
    assert(!(await d.editor()).includes("EXTERNAL_CONFLICT_MARKER"));
    assert((await readFile(note, "utf8")).includes("EXTERNAL_CONFLICT_MARKER"));
    return { localBufferAndExternalDiskPreserved: true };
  });
  await check(context, "deleted-file-preserves-unsaved-buffer", async () => {
    await unlink(note);
    await until(async () => {
      const body = await d.body();
      return body.includes("删除") && body.includes("未保存");
    }, "Deleted dirty note not reported");
    assert((await d.editor()).includes("LOCAL_UNSAVED_MARKER"));
    assert(await gone(note));
    return { localBufferPreserved: true, fileNotRecreated: true };
  });
}

export async function fallback(context, check) {
  const { driver: d, vault } = context;
  await activateTasks(d);
  await check(context, "backend-loss-polling-snapshot", async () => {
    const listener = await d.asyncExecute(
      "const done=arguments[arguments.length-1];window.__acceptanceHints=[];const handler=window.__TAURI_INTERNALS__.transformCallback(event=>window.__acceptanceHints.push(event.payload.subscriptionId));window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'vault-watch-changed',target:{kind:'Any'},handler}).then(done);",
    );
    try {
      await writeFile(
        join(vault, "active.md"),
        "# Active\n\nFALLBACK_PROBE\n\n- [ ] FALLBACK_TASK\n",
      );
      const ids = await until(
        () =>
          d.execute(
            "const ids=[...new Set(window.__acceptanceHints)];return ids.length>=2?ids:null",
          ),
        "No native subscription hints",
      );
      for (const subscriptionId of ids)
        await d.invoke("unsubscribe_vault", { subscriptionId });
      await writeFile(
        join(vault, "fallback-created.md"),
        "# Fallback\n\n- [ ] FALLBACK_CREATED_TASK\n",
      );
      await until(
        async () =>
          (await d.row("fallback-created")) &&
          (await hasTask(d, "FALLBACK_CREATED_TASK")),
        "First fallback snapshot missed new file",
        35_000,
      );
      return {
        releasedOwnedSubscriptions: ids.length,
        newFileAndTaskVisible: true,
      };
    } finally {
      await d.invoke("plugin:event|unlisten", {
        event: "vault-watch-changed",
        eventId: listener,
      });
    }
  });
}

export async function largeTree(context, check) {
  const { driver: d, vault, output } = context;
  const last = "note-09997";
  const rows = () =>
    d.execute(
      "return document.querySelectorAll('[data-file-tree-item]').length",
    );
  const scroll = async (bottom) => {
    await d.execute(
      "const p=document.querySelector('[data-virtual-file-tree]').parentElement;p.scrollTop=arguments[0]?p.scrollHeight:0;return true",
      bottom,
    );
  };
  const visible = (name) =>
    d.execute(
      "const e=[...document.querySelectorAll('.workspace-tree-row')].find(e=>e.title===arguments[0]);if(!e)return false;const r=e.getBoundingClientRect(),p=document.querySelector('[data-virtual-file-tree]').parentElement.getBoundingClientRect();return r.top>=p.top-1&&r.bottom<=p.bottom+1",
      name,
    );
  const locate = () => d.shortcut("j", true);
  const geometry = () =>
    d.execute(
      "const rows=[...document.querySelectorAll('.workspace-tree-row')];const rects=rows.map(e=>e.getBoundingClientRect());return {font:parseFloat(getComputedStyle(rows[0]).fontSize),height:rects[0].height,gaps:rects.slice(1).map((r,i)=>r.top-rects[i].bottom)}",
    );
  await check(context, "large-tree-dom-bounded", async () => {
    assert((await rows()) < 70);
    return { renderedRows: await rows() };
  });
  await check(context, "scroll-and-expansion-retained", async () => {
    await d.clickRow("nested");
    await d.clickRow("deep");
    await until(() => visible("child"), "Nested child missing");
    await scroll(true);
    await until(() => visible(last), "Last row unreachable");
    await d.clickRow(last);
    await loaded(d, "Fixture 9997");
    await scroll(false);
    await until(() => visible("child"), "Expansion lost after row unmounted");
    return true;
  });
  await check(context, "locate-offscreen-note", async () => {
    await locate();
    await until(() => visible(last), "Offscreen location failed");
    return true;
  });
  await check(
    context,
    "locate-nested-note-with-delayed-ancestors",
    async () => {
      await scroll(false);
      await until(() => visible("child"), "Child missing");
      await d.clickRow("child");
      await loaded(d, "NESTED_ORIGINAL");
      await d.clickRow("nested");
      assert(!(await d.row("child")));
      await locate();
      await until(() => visible("child"), "Ancestors did not expand");
      return true;
    },
  );
  await check(context, "font-resize-keeps-rows-aligned", async () => {
    const before = await geometry();
    for (let i = 0; i < 6; i++) await d.shortcut("=");
    await until(
      async () => (await geometry()).font > before.font,
      "UI font did not zoom",
    );
    await scroll(true);
    await until(() => visible(last), "Zoom hid last row");
    const after = await geometry();
    assert(after.gaps.every((gap) => gap >= -0.5));
    assert((await rows()) < 70);
    return { before, after };
  });
  await check(context, "window-resize-keeps-last-row-reachable", async () => {
    await d.request("POST", d.path("/window/rect"), {
      width: 1000,
      height: 850,
    });
    await scroll(true);
    await until(() => visible(last), "Resize hid last row");
    await d.shortcut("0", true);
    return true;
  });
  await check(
    context,
    "content-search-opens-and-locates-short-note",
    async () => {
      await scroll(false);
      const search = 'input[placeholder="搜索"]';
      await d.click(search);
      await d.type(search, "UNIQUE_SEARCH_NEEDLE");
      await until(
        () =>
          d.execute(
            "return !!document.querySelector('.workspace-search-result')",
          ),
        "Short note not found",
        90_000,
      );
      await d.click(".workspace-search-result button");
      await loaded(d, "UNIQUE_SEARCH_NEEDLE");
      await locate();
      await until(
        () => visible("note-05555"),
        "Search result location missing",
      );
      return true;
    },
  );
  const code = join(vault, "note-05555.md");
  await check(
    context,
    "real-lazy-python-highlighting-preserves-indent",
    async () => {
      await writeFile(code, "# Code\n\n```python\n    return value\n```\n");
      await loaded(d, "return value");
      await d.shortcut("3");
      await until(
        () =>
          d.execute(
            "return !!document.querySelector('pre.shiki code span[style]')",
          ),
        "Python grammar did not load",
        30_000,
      );
      assert(
        (
          await d.execute(
            "return document.querySelector('pre.shiki code').textContent",
          )
        ).startsWith("    return value"),
      );
      await d.screenshot(join(output, "python-highlight.png"));
      return true;
    },
  );
  await check(context, "real-lazy-language-switch", async () => {
    await writeFile(code, "# Code\n\n```javascript\nconst value = 42\n```\n");
    await until(
      () =>
        d.execute(
          "return document.querySelector('pre.shiki code')?.textContent.includes('const value = 42')",
        ),
      "JavaScript grammar did not load",
    );
    assert(
      (await d.execute(
        "return document.querySelectorAll('pre.shiki code span[style]').length",
      )) > 0,
    );
    await d.screenshot(join(output, "javascript-highlight.png"));
    return true;
  });
}
