import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const installScriptPath = resolve(projectRoot, "scripts/install-macos.sh");

describe("install-macos.sh", () => {
  const script = readFileSync(installScriptPath, "utf8");

  it("targets the latest GitHub Release dmg for the current Mac architecture", () => {
    expect(script).toContain('readonly REPO="Yunz93/markdown-press"');
    expect(script).toContain('readonly APP_NAME="墨知"');
    expect(script).toContain("releases/latest");
    expect(script).toContain("Mozi_");
    expect(script).not.toContain("api.github.com");
    expect(script).toContain('ASSET_ARCH="aarch64"');
    expect(script).toContain('ASSET_ARCH="x64"');
    expect(script).toContain("xattr -cr");
    expect(script).toContain('ditto "${SOURCE_APP}" "${APP_PATH}"');
  });

  it("is referenced from the README install instructions", () => {
    const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8");
    expect(readme).toContain("scripts/install-macos.sh");
    expect(readme).toContain("curl -fsSL");
  });
});
