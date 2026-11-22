import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

function runFixture({ appExit = 0, mounted = true, unmountExit = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mozi-linux-runtime-"));
  const bin = join(root, "bin");
  const runtime = join(root, "runtime with spaces");
  const audit = join(root, "audit");
  const marker = join(root, "mounted");
  const realRm = spawnSync("sh", ["-c", "command -v rm"], {
    encoding: "utf8",
  }).stdout.trim();
  const scripts = {
    mktemp:
      'mkdir -p "$MOZI_TEST_RUNTIME"\nprintf "%s\\n" "$MOZI_TEST_RUNTIME"',
    "dbus-run-session": 'shift\nexec "$@"',
    "xvfb-run":
      'if [ "$MOZI_TEST_MOUNTED" = 1 ]; then\n  mkdir -p "$XDG_RUNTIME_DIR/doc"\n  touch "$MOZI_TEST_MARKER"\nfi\nexit "$MOZI_TEST_APP_EXIT"',
    mountpoint:
      '[ "$1" = "-q" ] && [ "$2" = "$MOZI_TEST_RUNTIME/session/doc" ] && [ -f "$MOZI_TEST_MARKER" ]',
    fusermount3:
      '[ "$1" = "-u" ] && [ "$2" = "-z" ] && [ "$3" = "$MOZI_TEST_RUNTIME/session/doc" ] || exit 90\nprintf "unmount\\n" >> "$MOZI_TEST_AUDIT"\n[ "$MOZI_TEST_UNMOUNT_EXIT" = 0 ] || exit "$MOZI_TEST_UNMOUNT_EXIT"\n"$MOZI_TEST_REAL_RM" "$MOZI_TEST_MARKER"',
    rm: '[ "$1" = "-rf" ] && [ "$2" = "$MOZI_TEST_RUNTIME" ] || exit 91\nprintf "remove\\n" >> "$MOZI_TEST_AUDIT"\nif [ -f "$MOZI_TEST_MARKER" ]; then\n  echo "document portal is still mounted" >&2\n  exit 1\nfi\nexec "$MOZI_TEST_REAL_RM" "$@"',
  };
  try {
    mkdirSync(bin);
    for (const [name, source] of Object.entries(scripts)) {
      const file = join(bin, name);
      writeFileSync(file, `#!/bin/sh\nset -eu\n${source}\n`);
      chmodSync(file, 0o755);
    }
    const result = spawnSync("sh", [resolve("scripts/desktop/run-linux.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        MOZI_TEST_RUNTIME: runtime,
        MOZI_TEST_AUDIT: audit,
        MOZI_TEST_MARKER: marker,
        MOZI_TEST_REAL_RM: realRm,
        MOZI_TEST_APP_EXIT: String(appExit),
        MOZI_TEST_MOUNTED: mounted ? "1" : "0",
        MOZI_TEST_UNMOUNT_EXIT: String(unmountExit),
      },
    });
    assert.ifError(result.error);
    return {
      status: result.status,
      stderr: result.stderr,
      runtimeExists: existsSync(runtime),
      audit: existsSync(audit) ? readFileSync(audit, "utf8") : "",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const options = { skip: process.platform === "win32" };

test(
  "Linux desktop cleanup unmounts its document portal before removing runtime",
  options,
  () => {
    const result = runFixture();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.audit, "unmount\nremove\n");
    assert.equal(result.runtimeExists, false);
  },
);

test(
  "Linux desktop cleanup preserves the failing application exit status",
  options,
  () => {
    const result = runFixture({ appExit: 7 });
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.audit, "unmount\nremove\n");
    assert.equal(result.runtimeExists, false);
  },
);

test(
  "Linux desktop cleanup removes ordinary runtime directories without unmounting",
  options,
  () => {
    const result = runFixture({ mounted: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.audit, "remove\n");
    assert.equal(result.runtimeExists, false);
  },
);

test(
  "Linux desktop cleanup fails without traversing a portal it cannot unmount",
  options,
  () => {
    const result = runFixture({ unmountExit: 42 });
    assert.notEqual(result.status, 0);
    assert.equal(result.audit, "unmount\n");
    assert.equal(result.runtimeExists, true);
  },
);
