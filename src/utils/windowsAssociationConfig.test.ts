import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src-tauri");
const config = JSON.parse(readFileSync(resolve(root, "tauri.windows.conf.json"), "utf8"));
const hooks = readFileSync(resolve(root, "windows/file-associations.nsh"), "utf8");

describe("Windows file association safety", () => {
  it("does not use Tauri APP_ASSOCIATE to overwrite .md defaults", () => {
    expect(config.bundle.fileAssociations).toEqual([]);
    expect(config.bundle.windows.nsis.installerHooks).toBe("windows/file-associations.nsh");
    expect(hooks).not.toMatch(/!insertmacro\\s+APP_ASSOCIATE\\b/);
    expect(hooks).toContain("OpenWithList");
    expect(hooks).not.toMatch(/WriteRegStr\\s+SHCTX\\s+"Software\\\\Classes\\\\\\.md"\\s+""/);
  });

  it("quotes the executable and %1 in the Windows open command", () => {
    expect(hooks).toContain('\\$\\\"$INSTDIR');
    expect(hooks).toContain('%1');
    expect(hooks).toContain("NSIS_HOOK_POSTUNINSTALL");
  });
});
