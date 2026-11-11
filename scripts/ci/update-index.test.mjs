import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import {
  buildReleaseIndex,
  compareReleaseTags,
  publishUpdateIndex,
} from "../publish-update-index.mjs";

const release = (tag, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: tag.includes("-beta."),
  assets: [{ name: "latest.json" }],
  ...extra,
});
const tags = (index) => index.releases.map((item) => item.tag_name);

test("index sorts semantic versions and excludes invalid, draft, incomplete and unverified releases", () => {
  const releases = [
    release("v2.3.6-beta.2"),
    release("v2.3.6-beta.10"),
    release("v2.3.6"),
    release("v2.3.5"),
    release("v8.0.0", { draft: true }),
    release("v7.0.0", { assets: [] }),
    release("v6.0.0", { prerelease: true }),
    release("v6.0.0-beta.1", { prerelease: false }),
    release("v5.0.0-nightly.1"),
    release("v5.0.0-beta.01"),
    release("v5.0.0+meta"),
    release("v18446744073709551616.0.0"),
    release("v9.0.0"),
  ];
  const verified = releases
    .map((item) => item.tag_name)
    .filter((tag) => tag !== "v9.0.0");
  assert.deepEqual(tags(buildReleaseIndex(releases, verified)), [
    "v2.3.6",
    "v2.3.6-beta.10",
    "v2.3.6-beta.2",
    "v2.3.5",
  ]);
  assert.equal(compareReleaseTags("v10.0.0-beta.1", "v9.99.99"), 1);
  assert.equal(compareReleaseTags("v2.3.6-beta.10", "v2.3.6-beta.2"), 1);
});

function github({ releases, previous, competing, failStatus } = {}) {
  let current = previous;
  let conflict = competing;
  const calls = [];
  const api = async (url, options) => {
    const path =
      new URL(url).pathname.replace("/repos/Yunz93/Mozi", "") +
      new URL(url).search;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, ...options, body });
    assert.equal(options.headers.Authorization, "Bearer fixture-token");
    const response = (data, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (failStatus) return response({}, failStatus);
    if (path.startsWith("/releases?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return response(releases.slice((page - 1) * 100, page * 100));
    }
    if (path === "/git/ref/heads/updater-index")
      return current
        ? response({ object: { sha: "parent" } })
        : response({}, 404);
    if (path.startsWith("/contents/releases.json?ref="))
      return response({
        encoding: "base64",
        content: Buffer.from(JSON.stringify(current)).toString("base64"),
      });
    if (path === "/git/blobs") return response({ sha: "blob" }, 201);
    if (path === "/git/trees") return response({ sha: "tree" }, 201);
    if (path === "/git/commits") return response({ sha: "commit" }, 201);
    if (path === "/git/refs" || path === "/git/refs/heads/updater-index") {
      if (conflict) {
        current = conflict;
        conflict = undefined;
        return response({}, 422);
      }
      return response({ ref: "refs/heads/updater-index" }, 201);
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  return { calls, api };
}

const options = (mock, extra = {}) => ({
  repository: "Yunz93/Mozi",
  token: "fixture-token",
  verifiedTag: "v2.3.6-beta.1",
  fetchImpl: mock.api,
  ...extra,
});

test("first verified release initializes an independent index branch only", async () => {
  const mock = github({
    releases: [release("v2.3.6-beta.1"), release("v9.0.0-beta.1")],
  });
  const result = await publishUpdateIndex(options(mock, { publish: true }));
  assert.equal(result.changed, true);
  assert.deepEqual(tags(result.index), ["v2.3.6-beta.1"]);
  const ref = mock.calls.at(-1);
  assert.deepEqual(ref.body, {
    ref: "refs/heads/updater-index",
    sha: "commit",
  });
  assert.deepEqual(
    mock.calls.find((call) => call.path === "/git/commits").body.parents,
    [],
  );
  assert(
    mock.calls
      .filter((call) => call.method !== "GET")
      .every((call) => call.path.startsWith("/git/")),
  );
});

test("older repair retains newer verified releases and prunes removed or draft entries", async () => {
  const previous = buildReleaseIndex(
    [release("v2.3.7"), release("v2.3.8-beta.10"), release("v3.0.0")],
    ["v2.3.7", "v2.3.8-beta.10", "v3.0.0"],
  );
  const mock = github({
    previous,
    releases: [
      release("v2.3.6-beta.1"),
      release("v2.3.7"),
      release("v2.3.8-beta.10"),
      release("v3.0.0", { draft: true }),
    ],
  });
  const result = await publishUpdateIndex(options(mock, { publish: true }));
  assert.deepEqual(tags(result.index), [
    "v2.3.8-beta.10",
    "v2.3.7",
    "v2.3.6-beta.1",
  ]);
  assert.deepEqual(mock.calls.at(-1).body, { sha: "commit", force: false });
  assert.deepEqual(
    mock.calls.find((call) => call.path === "/git/commits").body.parents,
    ["parent"],
  );
});

test("concurrent branch updates re-read and merge newer verified tags", async () => {
  const mock = github({
    releases: [release("v2.3.6-beta.1"), release("v2.3.7")],
    competing: buildReleaseIndex([release("v2.3.7")], ["v2.3.7"]),
  });
  const result = await publishUpdateIndex(options(mock, { publish: true }));
  assert.deepEqual(tags(result.index), ["v2.3.7", "v2.3.6-beta.1"]);
  assert.equal(
    mock.calls.filter((call) => call.path === "/git/ref/heads/updater-index")
      .length,
    2,
  );
  assert.equal(mock.calls.at(-1).body.force, false);
});

test("pagination reads all releases before selecting the verified tag", async () => {
  const mock = github({
    releases: [
      ...Array.from({ length: 100 }, (_, index) => release(`v4.0.${index}`)),
      release("v2.3.6-beta.1"),
    ],
  });
  const result = await publishUpdateIndex(options(mock));
  assert.deepEqual(tags(result.index), ["v2.3.6-beta.1"]);
  assert.equal(
    mock.calls.filter((call) => call.path.startsWith("/releases?")).length,
    2,
  );
  assert(mock.calls.every((call) => call.method === "GET"));
});

test("dry runs, unchanged indexes, failed discovery and damaged prior indexes cannot publish", async () => {
  const releases = [release("v2.3.6-beta.1")];
  for (const [previous, extra] of [
    [undefined, {}],
    [buildReleaseIndex(releases, ["v2.3.6-beta.1"]), { publish: true }],
  ]) {
    const mock = github({ releases, previous });
    await publishUpdateIndex(options(mock, extra));
    assert(mock.calls.every((call) => call.method === "GET"));
  }
  for (const configuration of [
    { releases: [] },
    { releases, failStatus: 403 },
    { releases, previous: { schemaVersion: 2, releases: [] } },
  ]) {
    const mock = github(configuration);
    await assert.rejects(publishUpdateIndex(options(mock, { publish: true })));
    assert(mock.calls.every((call) => call.method === "GET"));
  }
});

test("a newer index published during release discovery survives an older publisher", async () => {
  const older = "v2.3.8-beta.3";
  const newer = "v2.3.8-beta.4";
  const indexes = new Map([
    ["initial", buildReleaseIndex([], [])],
    ["newer-publisher", buildReleaseIndex([release(newer)], [newer])],
  ]);
  let ref = "initial";
  let competed = false;
  let pendingIndex;
  let sequence = 0;
  let conflicts = 0;
  const parents = new Map();
  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), { status });
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace("/repos/Yunz93/Mozi", "");
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (path === "/releases") {
      if (!competed) {
        // 旧列表返回时，另一发布已经完成验收并写入更新索引。
        competed = true;
        ref = "newer-publisher";
        return reply([release(older)]);
      }
      return reply([release(older), release(newer)]);
    }
    if (path === "/git/ref/heads/updater-index")
      return reply({ object: { sha: ref } });
    if (path === "/contents/releases.json")
      return reply({
        encoding: "base64",
        content: Buffer.from(
          JSON.stringify(indexes.get(parsed.searchParams.get("ref"))),
        ).toString("base64"),
      });
    if (path === "/git/blobs") {
      pendingIndex = JSON.parse(body.content);
      return reply({ sha: "blob" }, 201);
    }
    if (path === "/git/trees") return reply({ sha: "tree" }, 201);
    if (path === "/git/commits") {
      const sha = `candidate-${++sequence}`;
      parents.set(sha, body.parents[0]);
      indexes.set(sha, pendingIndex);
      return reply({ sha }, 201);
    }
    if (path === "/git/refs/heads/updater-index") {
      assert.equal(body.force, false);
      if (parents.get(body.sha) !== ref) {
        conflicts++;
        return reply({}, 422);
      }
      ref = body.sha;
      return reply({ ref });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  await publishUpdateIndex({
    repository: "Yunz93/Mozi",
    token: "fixture-token",
    verifiedTag: older,
    publish: true,
    fetchImpl,
  });
  assert.deepEqual(tags(indexes.get(ref)), [newer, older]);
  assert.equal(conflicts, 1);
});

test("index publishing waits for complete asset and signature verification and leaves stable feed intact", () => {
  const workflow = yaml.load(
    readFileSync(".github/workflows/release.yml", "utf8"),
  );
  const job = workflow.jobs["publish-update-index"];
  assert.deepEqual(job.needs, ["verify-published-assets"]);
  assert.equal(job.if, undefined);
  assert.equal(job.permissions.contents, "write");
  for (const dependency of [
    "release-channel",
    "build-macos",
    "build-windows",
    "build-linux",
  ])
    assert(workflow.jobs["verify-published-assets"].needs.includes(dependency));
  assert(
    workflow.jobs["verify-published-assets"].steps.some((step) =>
      step.run?.includes("--example verify-updater"),
    ),
  );
  const publish = job.steps.find((step) =>
    step.run?.includes("publish-update-index.mjs"),
  );
  assert.equal(publish.run, "node scripts/publish-update-index.mjs --publish");
  assert.equal(publish.env.GH_TOKEN, "${{ github.token }}");
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://github.com/Yunz93/Mozi/releases/latest/download/latest.json",
  ]);
});
