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
