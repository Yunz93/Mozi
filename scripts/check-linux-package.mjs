import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const bundleDir = "src-tauri/target/release/bundle/deb";
const artifacts =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(bundleDir)
        .filter((name) => name.endsWith(".deb"))
        .map((name) => join(bundleDir, name));
if (!artifacts.length) throw new Error("No Linux .deb package to validate");

for (const input of artifacts) {
  const artifact = resolve(input);
  // Extraction alone accepts malformed control fields. Ask dpkg to parse the
  // actual package, including Debian's ASCII package-name requirements.
  const packageName = execFileSync(
    "dpkg-deb",
    ["--field", artifact, "Package"],
    { encoding: "utf8" },
  ).trim();
  execFileSync("dpkg-deb", ["--info", artifact], { stdio: "pipe" });
  const directory = mkdtempSync(join(tmpdir(), "mozi-deb-check-"));
  try {
    execFileSync("dpkg-deb", ["--extract", artifact, directory]);
    const applications = join(directory, "usr/share/applications");
    const launchers = readdirSync(applications).filter((name) =>
      name.endsWith(".desktop"),
    );
    if (!launchers.length) throw new Error("Package has no desktop launcher");
    for (const name of launchers) {
      const file = join(applications, name);
      execFileSync("desktop-file-validate", [file], { stdio: "pipe" });
      const text = readFileSync(file, "utf8");
      const executable = /^Exec=(?:"([^"]+)"|([^\s]+))/m.exec(text);
      if (!executable) throw new Error("Desktop launcher has no Exec entry");
      if (!/^Exec=.*%[fFuU]/m.test(text))
        throw new Error("Desktop launcher does not forward opened files");
      const binary = join(
        directory,
        "usr/bin",
        basename(executable[1] ?? executable[2]),
      );
      if (!(statSync(binary).mode & 0o111))
        throw new Error("Desktop Exec target is not executable");
      if (!/^MimeType=.*text\/markdown/m.test(text))
        throw new Error("Markdown file association is missing");
    }
    console.log(
      `Validated ${basename(artifact)}: package=${packageName}, desktop launcher and Markdown association`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
