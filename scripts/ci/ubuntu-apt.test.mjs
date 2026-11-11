import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { useUbuntuHttpsSources } from "./configure-ubuntu-apt.mjs";

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
