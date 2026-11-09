import assert from "node:assert/strict";
import { test } from "node:test";
import { editorFlows } from "./user-flows.mjs";

test("editor acceptance activates a fresh vault's task index before testing date insertion", async () => {
  let registered = false;
  let indexed = false;
  const stop = new Error("setup complete");
  const driver = {
    async click(selector) {
      if (selector === 'button[aria-label="待办事项"]') registered = true;
      if (selector === 'button[aria-label="实时预览"]') {
        assert(registered && indexed, "Fresh vault has no task observer");
        throw stop;
      }
    },
    async invoke(command) {
      assert.equal(command, "task_calendar_snapshot");
      assert(registered, "Task snapshot requested before opening the calendar");
      indexed = true;
      return { tasks: [{ title: "ACCEPTANCE_INITIAL_TASK" }] };
    },
  };
  await assert.rejects(
    editorFlows({ driver }, () => {}),
    (error) => error === stop,
  );
});
