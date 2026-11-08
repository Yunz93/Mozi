import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function makeVault(root, count = 100) {
  await mkdir(join(root, "nested", "deep"), { recursive: true });
  await mkdir(join(root, ".trash"));
  await mkdir(join(root, ".hidden"));
  await writeFile(
    join(root, "active.md"),
    "# Acceptance active\n\nORIGINAL_CONTENT\n\n- [ ] ACCEPTANCE_INITIAL_TASK\n",
  );
  await writeFile(
    join(root, "nested", "deep", "child.md"),
    "# Nested child\n\nNESTED_ORIGINAL\n",
  );
  await writeFile(
    join(root, ".trash", "trashed.md"),
    "# Trashed\n\n- [ ] TRASH_TASK_SHOULD_NOT_INDEX\n",
  );
  await writeFile(
    join(root, ".hidden", "private.md"),
    "# Hidden\n\n- [ ] HIDDEN_TASK_SHOULD_NOT_INDEX\n",
  );
  // Small bounded batches keep fixture creation from exhausting file handles.
  for (let offset = 0; offset < count - 2; offset += 64) {
    await Promise.all(
      Array.from({ length: Math.min(64, count - 2 - offset) }, (_, n) => {
        const i = offset + n;
        return writeFile(
          join(root, `note-${String(i).padStart(5, "0")}.md`),
          `# Synthetic note ${i}\n\n${i === 5555 ? "UNIQUE_SEARCH_NEEDLE" : `Fixture ${i}. [[active]]`}\n`,
        );
      }),
    );
  }
  return root;
}

export async function diskRename(source, target) {
  // Windows can briefly hold a note while an editor/watcher is reading it.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EBUSY", "EACCES"].includes(error.code) ||
        attempt === 30
      )
        throw error;
      await delay(100);
    }
  }
}
