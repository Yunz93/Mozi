import assert from "node:assert/strict";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { until } from "./driver.mjs";
import {
  activateTasks,
  appendText,
  closeWindow,
  hasTask,
  loaded,
  openWindow,
} from "./support.mjs";

export function editorSelection() {
  const { document, window } = globalThis;
  const editor = document.querySelector(".cm-content");
  const selection = window.getSelection();
  if (
    !editor ||
    !selection?.rangeCount ||
    !editor.contains(selection.anchorNode) ||
    !editor.contains(selection.focusNode)
  )
    return null;
  const offset = (node, end) => {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(node, end);
    return range.toString().length;
  };
  return {
    anchor: offset(selection.anchorNode, selection.anchorOffset),
    head: offset(selection.focusNode, selection.focusOffset),
    text: selection.toString(),
    focused:
      editor === document.activeElement ||
      editor.contains(document.activeElement),
  };
}

const selectionOf = (driver) =>
  driver.execute(`return (${editorSelection.toString()})()`);

export async function editorFlows(context, check) {
  const { driver: d, vault, output } = context;
  // 每个场景使用全新配置，须先从界面登记知识库，再断言保存后的任务索引。
  await activateTasks(d);
  await until(
    () => hasTask(d, "ACCEPTANCE_INITIAL_TASK"),
    "Fresh editor session did not initialize the task index",
  );
  await d.click('button[aria-label="实时预览"]');
  await check(
    context,
    "focus-mode-dims-paragraphs-and-keeps-caret",
    async () => {
      await appendText(d, "\n\nFOCUS_ACTIVE_PARAGRAPH");
      const before = await selectionOf(d);
      assert(before?.focused && before.anchor === before.head);
      await d.click('button[aria-label="专注模式"]');
      await until(
        () =>
          d.execute(
            "return document.querySelector('.cm-editor')?.dataset.writingFocus === 'true' && [...document.querySelectorAll('.cm-writing-inactive')].some(e=>parseFloat(getComputedStyle(e).opacity)<1)",
          ),
        "Focus mode did not dim inactive paragraphs",
      );
      assert.deepEqual(await selectionOf(d), before);
      await d.screenshot(join(output, "focus-mode.png"));
      await d.chord(["\uE00C"]);
      await until(
        () =>
          d.execute(
            "return document.querySelector('.cm-editor')?.dataset.writingFocus !== 'true' && !document.querySelector('.cm-writing-inactive')",
          ),
        "Escape did not exit focus mode",
      );
      await loaded(d, "FOCUS_ACTIVE_PARAGRAPH");
      return { paragraphsDimmed: true, caretPreserved: true };
    },
  );
  let day;
  await check(
    context,
    "task-date-picker-inserts-day-and-restores-caret",
    async () => {
      await appendText(d, "\n- [ ] DATE_PICKER_TASK @");
      await until(
        () =>
          d.execute(
            "return !!document.querySelector('.cm-task-date-picker[role=dialog]')",
          ),
        "Typing @ did not open the task date picker",
      );
      day = await d.execute(
        "const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')",
      );
      await d.click('.cm-task-date-picker button[aria-label="今天"]');
      await loaded(d, `DATE_PICKER_TASK @${day}`);
      const selection = await selectionOf(d);
      assert(
        selection?.focused &&
          selection.anchor === selection.head &&
          !selection.text,
      );
      assert.equal(
        await d.execute(
          "return !!document.querySelector('.cm-task-date-picker')",
        ),
        false,
      );
      await d.shortcut("s");
      await until(
        () => hasTask(d, "DATE_PICKER_TASK"),
        "Selected task date was not indexed",
      );
      return { selectedDay: day, caretCollapsedAndFocused: true };
    },
  );
  await check(
    context,
    "save-notification-keeps-toolbar-and-trash-accessible",
    async () => {
      await appendText(d, "\nSAVE_TO_TOOLBAR_MARKER");
      await d.shortcut("s");
      await until(
        () =>
          d.execute(
            "return [...document.querySelectorAll('[role=status]')].some(e=>e.textContent.trim()==='已保存')",
          ),
        "Save confirmation did not appear",
      );
      const geometry = await d.execute(
        "const status=[...document.querySelectorAll('[role=status]')].find(e=>e.textContent.trim()==='已保存'),button=document.querySelector('button[aria-label=更多操作]');const a=status.getBoundingClientRect(),b=button.getBoundingClientRect(),style=getComputedStyle(status);return {overlaps:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,selectable:style.getPropertyValue('user-select')||style.getPropertyValue('-webkit-user-select'),withinViewport:a.left>=0&&a.right<=innerWidth&&a.top>=0&&a.bottom<=innerHeight}",
      );
      assert.equal(geometry.overlaps, false);
      assert.equal(geometry.selectable, "text");
      assert.equal(geometry.withinViewport, true);
      await d.click('button[aria-label="更多操作"]');
      await d.click('button[aria-label="回收站"]');
      await until(
        () =>
          d.execute(
            "return [...document.querySelectorAll('.workspace-sidebar-footer button')].some(e=>e.textContent.trim().startsWith('回收站（'))",
          ),
        "Save confirmation blocked opening the trash panel",
      );
      await d.screenshot(join(output, "save-notification-toolbar.png"));
      const trashToggle = await d.execute(
        "return [...document.querySelectorAll('.workspace-sidebar-footer button')].find(e=>e.textContent.trim().startsWith('回收站（')).textContent.trim()",
      );
      await d.button(trashToggle);
      await d.click(".cm-content");
      return geometry;
    },
  );
  await check(
    context,
    "background-tree-refresh-keeps-editor-selection-and-focus",
    async () => {
      const before = await selectionOf(d);
      assert(before?.focused);
      await writeFile(
        join(vault, "selection-sibling.md"),
        "# Selection sibling\n",
      );
      await until(
        () => d.row("selection-sibling"),
        "External sibling was not observed",
      );
      assert.deepEqual(await selectionOf(d), before);
      return { selectionAndFocusPreserved: true };
    },
  );
  await check(
    context,
    "task-calendar-badge-is-compact-and-selectable",
    async () => {
      await d.click('button[aria-label="待办事项"]');
      const selector = `.task-calendar-date[data-date="${day}"]`;
      await until(
        () =>
          d.execute(
            "return document.querySelector(arguments[0])?.querySelector('.task-calendar-count')?.textContent.trim()==='1'",
            selector,
          ),
        "Task date badge did not show the indexed count",
      );
      const other = await d.execute(
        "return [...document.querySelectorAll('.task-calendar-date')].find(e=>e.dataset.date!==arguments[0] && !e.closest('.task-calendar-day').classList.contains('is-outside'))?.dataset.date",
        day,
      );
      assert(other, "Calendar has no alternate selectable day");
      await d.click(`.task-calendar-date[data-date="${other}"]`);
      await until(
        () =>
          d.execute(
            "return document.querySelector(arguments[0])?.getAttribute('aria-pressed')==='false' && !document.querySelector('.task-day-items')?.textContent.includes('DATE_PICKER_TASK')",
            selector,
          ),
        "Selecting another day did not change the task panel",
      );
      await d.click(selector);
      await until(
        () =>
          d.execute(
            "return document.querySelector(arguments[0])?.getAttribute('aria-pressed')==='true' && document.querySelector('.task-day-items')?.textContent.includes('DATE_PICKER_TASK')",
            selector,
          ),
        "Selecting the task date did not restore its day panel",
      );
      const geometry = await d.execute(
        "const b=document.querySelector(arguments[0]),day=b.closest('.task-calendar-day'),n=b.querySelector('.task-calendar-day-number').getBoundingClientRect(),badge=b.querySelector('.task-calendar-count').getBoundingClientRect(),cell=day.getBoundingClientRect();return {selected:b.getAttribute('aria-pressed'),rowHeight:cell.height,font:parseFloat(getComputedStyle(day).fontSize),upperRight:badge.left>n.left+n.width/2&&badge.top<n.top+n.height/2,fits:badge.right<=cell.right+1}",
        selector,
      );
      assert.equal(geometry.selected, "true");
      assert(
        geometry.rowHeight <= geometry.font * 3 &&
          geometry.upperRight &&
          geometry.fits,
      );
      await d.screenshot(join(output, "task-calendar-badge.png"));
      await d.click('button[aria-label="关闭待办事项"]');
      return geometry;
    },
  );
}

export async function closingFlows(context, check) {
  const { driver: d, vault } = context;
  assert.notEqual(
    process.getuid?.(),
    0,
    "Read-only save tests require an ordinary application user",
  );
  const monitor = await d.request("GET", d.path("/window"));
  await check(context, "normal-window-close-saves-unsaved-edits", async () => {
    const path = join(vault, "close-save.md");
    await writeFile(path, "# Close save\n\nCLOSE_ORIGINAL\n");
    const target = await openWindow(d, path, false, "CLOSE_ORIGINAL");
    await appendText(d, "\nCLOSE_SAVED_MARKER");
    assert(!(await readFile(path, "utf8")).includes("CLOSE_SAVED_MARKER"));
    await closeWindow(d, target);
    assert((await readFile(path, "utf8")).includes("CLOSE_SAVED_MARKER"));
    await d.switch(monitor);
    await loaded(d, "ORIGINAL_CONTENT");
    return { unsavedEditsSaved: true, otherWindowAlive: true };
  });
  await check(
    context,
    "failed-close-save-can-be-cancelled-and-retried",
    async () => {
      const path = join(vault, "close-readonly.md");
      const original = "# Read only\n\nREADONLY_ORIGINAL\n";
      await writeFile(path, original);
      const mode = (await stat(path)).mode;
      const target = await openWindow(d, path, false, "READONLY_ORIGINAL");
      await appendText(d, "\nREADONLY_UNSAVED_MARKER");
      await chmod(path, 0o444);
      try {
        const request = d.request("DELETE", d.path("/window"));
        await until(
          async () => (await d.body()).includes("无法保存，应用无法关闭"),
          "Read-only save did not block closing",
        );
        await d.button("取消");
        const handles = await request;
        assert(handles.includes(target));
        assert((await d.editor()).includes("READONLY_UNSAVED_MARKER"));
        assert.equal(await readFile(path, "utf8"), original);
      } finally {
        await chmod(path, mode);
      }
      await closeWindow(d, target);
      assert(
        (await readFile(path, "utf8")).includes("READONLY_UNSAVED_MARKER"),
      );
      await d.switch(monitor);
      return { cancellationKeptBuffer: true, retrySavedAndClosed: true };
    },
  );
  await check(
    context,
    "native-fullscreen-close-saves-and-keeps-other-window-responsive",
    async () => {
      const path = join(vault, "close-fullscreen.md");
      await writeFile(path, "# Fullscreen\n\nFULLSCREEN_ORIGINAL\n");
      const target = await openWindow(d, path, false, "FULLSCREEN_ORIGINAL");
      await appendText(d, "\nFULLSCREEN_SAVED_MARKER");
      assert(
        !(await readFile(path, "utf8")).includes("FULLSCREEN_SAVED_MARKER"),
      );
      await d.request("POST", d.path("/window/fullscreen"), {});
      assert.equal(
        await d.invoke("plugin:window|is_fullscreen", { label: target }),
        true,
      );
      await closeWindow(d, target);
      assert(
        (await readFile(path, "utf8")).includes("FULLSCREEN_SAVED_MARKER"),
      );
      await d.switch(monitor);
      await loaded(d, "ORIGINAL_CONTENT");
      return {
        nativeFullscreenRequested: true,
        normalCloseCompleted: true,
        otherWindowAlive: true,
      };
    },
  );
}

export async function exitFlow(context, check) {
  const { driver: d, vault, child } = context;
  await check(
    context,
    "exit-request-saves-all-windows-before-process-exit",
    async () => {
      const first = await d.request("GET", d.path("/window"));
      const firstPath = join(vault, "active.md");
      await appendText(d, "\nEXIT_FIRST_DOCUMENT_MARKER");
      const secondPath = join(vault, "exit-second.md");
      await writeFile(secondPath, "# Second\n\nEXIT_SECOND_ORIGINAL\n");
      await openWindow(d, secondPath, false, "EXIT_SECOND_ORIGINAL");
      await appendText(d, "\nEXIT_SECOND_DOCUMENT_MARKER");
      assert(
        !(await readFile(firstPath, "utf8")).includes(
          "EXIT_FIRST_DOCUMENT_MARKER",
        ),
      );
      assert(
        !(await readFile(secondPath, "utf8")).includes(
          "EXIT_SECOND_DOCUMENT_MARKER",
        ),
      );
      await d.switch(first);
      // 定向发送原生退出协调器的同一事件，复用真实的全窗保存和进程退出流程。
      const request = d
        .invoke("plugin:event|emit_to", {
          target: { kind: "AnyLabel", label: first },
          event: "app-close-requested",
          payload: "exit",
        })
        .catch((error) => error);
      await until(
        () => child.exitCode !== null,
        "Saved application did not exit",
        45_000,
      );
      await request;
      assert.equal(child.exitCode, 0);
      assert(
        (await readFile(firstPath, "utf8")).includes(
          "EXIT_FIRST_DOCUMENT_MARKER",
        ),
      );
      assert(
        (await readFile(secondPath, "utf8")).includes(
          "EXIT_SECOND_DOCUMENT_MARKER",
        ),
      );
      return { documentsSaved: 2, exitCode: child.exitCode };
    },
  );
}
