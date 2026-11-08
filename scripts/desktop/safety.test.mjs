import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { resetOwnedDirectory, TEST_ID } from "./process.mjs";
import { DesktopDriver } from "./driver.mjs";
import { instrumentSubscriptions } from "./subscription-probe.mjs";

test("subscription probe preserves real replies and cannot revive a revoked token", async () => {
  let completeRead;
  const token = { subscriptionId: "owned", epoch: "epoch", seq: 1 };
  const denied = new Error("Denied by the real backend");
  const bridge = {
    invoke(command) {
      assert.equal(this, bridge);
      if (command === "subscribe_vault") return Promise.resolve(token);
      if (command === "get_vault_changes")
        return new Promise((accept) => {
          completeRead = accept;
        });
      if (command === "denied") return Promise.reject(denied);
      return Promise.resolve(null);
    },
  };
  const original = bridge.invoke;
  // Serialize exactly as the desktop client does: no test-module closures.
  const install = Function(`return (${instrumentSubscriptions.toString()})`)();
  install(bridge);
  assert.equal(await bridge.invoke("subscribe_vault", {}), token);
  const read = bridge.invoke("get_vault_changes", {
    subscriptionId: token.subscriptionId,
    epoch: token.epoch,
    afterSeq: 1,
  });
  await bridge.invoke("unsubscribe_vault", {
    subscriptionId: token.subscriptionId,
  });
  const page = { seq: 2, changes: [] };
  completeRead(page);
  assert.equal(await read, page);
  assert.deepEqual(bridge.__acceptanceSubscriptions.snapshot().tokens, []);
  await assert.rejects(bridge.invoke("denied"), (error) => error === denied);
  bridge.__acceptanceSubscriptions.restore();
  assert.equal(bridge.invoke, original);
});

test("profile reset preserves unowned data and refuses linked directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "mozi-profile-guard-"));
  try {
    const profile = join(root, TEST_ID);
    await mkdir(profile);
    await writeFile(join(profile, "document.md"), "User content");
    await assert.rejects(
      resetOwnedDirectory(profile, TEST_ID),
      /unowned profile/,
    );
    assert.equal(
      await readFile(join(profile, "document.md"), "utf8"),
      "User content",
    );
    await rm(profile, { recursive: true });
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      profile,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      resetOwnedDirectory(profile, TEST_ID),
      /symbolic-link profile/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owned disposable profiles can be reset without touching siblings", async () => {
  const root = await mkdtemp(join(tmpdir(), "mozi-profile-guard-"));
  try {
    const profile = join(root, TEST_ID);
    await writeFile(join(root, "sibling.md"), "Keep");
    await resetOwnedDirectory(profile, TEST_ID);
    await writeFile(join(profile, "stale-cache"), "Disposable");
    await resetOwnedDirectory(profile, TEST_ID);
    await assert.rejects(readFile(join(profile, "stale-cache")), {
      code: "ENOENT",
    });
    assert.equal(await readFile(join(root, "sibling.md"), "utf8"), "Keep");
    await assert.rejects(
      resetOwnedDirectory(root, TEST_ID),
      /Invalid profile boundary/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WebDriver distinguishes script return values from protocol errors", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/failure") {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          value: { error: "script timeout", message: "timeout" },
        }),
      );
    } else
      response.end(
        JSON.stringify({ value: { error: "ordinary application data" } }),
      );
  });
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    const driver = new DesktopDriver(server.address().port);
    assert.deepEqual(await driver.request("GET", "/value"), {
      error: "ordinary application data",
    });
    await assert.rejects(driver.request("GET", "/failure"), /script timeout/);
  } finally {
    await new Promise((accept) => server.close(accept));
  }
});
