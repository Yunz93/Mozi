import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src-tauri");
const config = JSON.parse(readFileSync(resolve(root, "tauri.windows.conf.json"), "utf8"));
const hooks = readFileSync(resolve(root, "windows/file-associations.nsh"), "utf8");

describe("Windows file association safety", () => {
  it("registers Open With without claiming the default .md ProgID", () => {
    expect(config.bundle.fileAssociations).toEqual([]);
    expect(config.bundle.windows.nsis.installerHooks).toBe("windows/file-associations.nsh");
    expect(hooks).not.toContain("!insertmacro APP_ASSOCIATE ");
    expect(hooks).toContain("OpenWithList");
    expect(hooks).not.toContain(String.raw`Software\Classes\.md" ""`);
  });

  it("uses a quoted executable and file argument and cleans up its own entries", () => {
    expect(hooks).toContain(String.raw`$\"$INSTDIR`);
    expect(hooks).toContain(String.raw`$\"%1$\"`);
    expect(hooks).toContain("NSIS_HOOK_POSTUNINSTALL");
  });
});
