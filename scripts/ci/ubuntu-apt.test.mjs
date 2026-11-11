import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import {
  selectUbuntuArchive,
  useUbuntuHttpsSources,
} from "./configure-ubuntu-apt.mjs";

test("DNS failure selects a reachable HTTPS mirror and preserves Ubuntu signature trust", async () => {
  const requests = [];
  const archive = await selectUbuntuArchive("noble", async (url) => {
    requests.push(url);
    if (url.includes("archive.ubuntu.com"))
      throw new Error("DNS lookup failed");
    return new Response("-----BEGIN PGP SIGNED MESSAGE-----\nfixture");
  });
  assert.deepEqual(requests, [
    "https://archive.ubuntu.com/ubuntu/dists/noble/InRelease",
    "https://mirrors.edge.kernel.org/ubuntu/dists/noble/InRelease",
  ]);
  const source =
    "URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-security\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
  assert.equal(
    useUbuntuHttpsSources(source, archive),
    source.replace("mirror+file:/etc/apt/apt-mirrors.txt", archive),
  );
  assert.equal(
    useUbuntuHttpsSources(
      `deb http://security.ubuntu.com/ubuntu noble-security main\n`,
      archive,
    ),
    `deb ${archive} noble-security main\n`,
  );
});

test("unreachable or unsigned mirror probes stop instead of continuing with stale APT indexes", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error("DNS lookup failed");
    },
    async () => new Response("unavailable", { status: 503 }),
    async () => new Response("<html>not an archive</html>"),
  ])
    await assert.rejects(selectUbuntuArchive("noble", fetchImpl), /均不可达/);
  await assert.rejects(selectUbuntuArchive(undefined), /无效/);
});

test("GitHub runner mirror lists resolve directly to the official HTTPS archive", () => {
  const source = `Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble noble-updates noble-backports noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
`;
  const expected = source.replace(
    "mirror+file:/etc/apt/apt-mirrors.txt",
    "https://archive.ubuntu.com/ubuntu/",
  );
  assert.equal(useUbuntuHttpsSources(source), expected);
  assert.equal(useUbuntuHttpsSources(expected), expected);
});

test("Ubuntu mirrors use official HTTPS without changing suites or signature trust", () => {
  const source = `Types: deb
URIs: http://azure.archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

deb http://security.ubuntu.com/ubuntu noble-security main
deb http://archive.ubuntu.com/ubuntu noble main
deb https://archive.ubuntu.com/ubuntu noble main
deb http://example.org/ubuntu noble main
deb http://archive.ubuntu.com/ubuntu-other noble main
`;
  const expected = source
    .replace(
      "http://azure.archive.ubuntu.com/ubuntu/",
      "https://archive.ubuntu.com/ubuntu/",
    )
    .replace(
      "http://security.ubuntu.com/ubuntu ",
      "https://security.ubuntu.com/ubuntu ",
    )
    .replace(
      "http://archive.ubuntu.com/ubuntu ",
      "https://archive.ubuntu.com/ubuntu ",
    );
  assert.equal(useUbuntuHttpsSources(source), expected);
  assert.equal(useUbuntuHttpsSources(expected), expected);
});

test("every Linux dependency installation configures HTTPS before refreshing APT", () => {
  let installations = 0;
  for (const path of ["ci.yml", "desktop-acceptance.yml", "release.yml"]) {
    const workflow = yaml.load(
      readFileSync(`.github/workflows/${path}`, "utf8"),
    );
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.run?.includes("sudo apt-get update")) continue;
        installations++;
        assert(step.run.includes("sudo apt-get update --error-on=any"));
        const configure = step.run.indexOf(
          "scripts/ci/configure-ubuntu-apt.mjs",
        );
        assert(
          configure >= 0 && configure < step.run.indexOf("sudo apt-get update"),
          `${path}: ${step.name}`,
        );
      }
    }
  }
  assert.equal(installations, 5);
});
