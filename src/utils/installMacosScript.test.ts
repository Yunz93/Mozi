import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync as readText,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const installScriptPath = resolve(projectRoot, "scripts/install-macos.sh");

describe("install-macos.sh", () => {
  const script = readFileSync(installScriptPath, "utf8");

  it("targets the latest GitHub Release dmg for the current Mac architecture", () => {
    expect(script).toContain('readonly REPO="Yunz93/Mozi"');
    expect(script).toContain('readonly APP_NAME="墨知"');
    expect(script).toContain("releases/latest");
    expect(script).toContain("Mozi_");
    expect(script).toContain('DMG_PATH="${TMP_DIR}/Mozi.dmg"');
    expect(script).toContain("User-Agent: Mozi-installer");
    expect(script).not.toContain("markdown-press_");
    expect(script).not.toContain("api.github.com");
    expect(script).toContain('ASSET_ARCH="aarch64"');
    expect(script).toContain('ASSET_ARCH="x64"');
    expect(script).toContain("xattr -cr");
    expect(script).toContain(
      'install_app_bundle "${SOURCE_APP}" "${APP_PATH}"',
    );
    expect(script).toContain("DMG_FILE");
    expect(script).toContain("OPEN_APP");
    expect(script).toContain("使用已下载的安装包");
  });

  it.each(["copy", "validation", "swap", "signal", "success"])(
    "安全处理安装结果：%s",
    (failure) => {
      const helper = script.match(/install_app_bundle\(\) \{[\s\S]*?\n\}/)?.[0];
      expect(helper).toBeTruthy();
      const cleanup = script.match(/cleanup\(\) \{[\s\S]*?\n\}/)?.[0];
      expect(cleanup).toBeTruthy();
      const root = mkdtempSync(resolve(tmpdir(), "mozi-installer-test-"));
      try {
        const source = resolve(root, "source.app");
        const target = resolve(root, "墨知.app");
        mkdirSync(resolve(source, "Contents/MacOS"), { recursive: true });
        writeFileSync(resolve(source, "Contents/Info.plist"), "new-plist");
        writeFileSync(resolve(source, "Contents/MacOS/app"), "new-app");
        chmodSync(resolve(source, "Contents/MacOS/app"), 0o755);
        mkdirSync(target);
        writeFileSync(resolve(target, "old-content"), "old-app");
        const runner = `set -eu\nwarn(){ :; }\nlog(){ :; }\nditto(){ if [ "$FAILURE" = copy ]; then return 1; fi; cp -R "$1" "$2"; }\nxattr(){ :; }\nplutil(){ if [ "$FAILURE" = validation ]; then return 1; fi; if [ "$1" = -extract ]; then printf com.bxyz.markdown-press; fi; }\nmv(){ if [ "$FAILURE" = swap ] && [[ "$1" == */new.app ]]; then return 1; fi; command mv "$@"; if [ "$FAILURE" = signal ] && [[ "$2" == */previous.app ]]; then kill -TERM $$; fi; }\n${cleanup}\nMOUNT_POINT=""\nTMP_DIR="$(mktemp -d)"\ntrap cleanup EXIT\ntrap 'exit 143' TERM\n${helper}\ninstall_app_bundle "$SOURCE" "$TARGET"`;
        const result = spawnSync("bash", ["-c", runner], {
          encoding: "utf8",
          env: {
            ...process.env,
            SOURCE: source,
            TARGET: target,
            FAILURE: failure,
          },
        });
        if (failure === "success") {
          expect(result.status).toBe(0);
          expect(readText(resolve(target, "Contents/MacOS/app"), "utf8")).toBe(
            "new-app",
          );
        } else {
          expect(result.status).not.toBe(0);
          expect(existsSync(resolve(target, "old-content"))).toBe(true);
          expect(readText(resolve(target, "old-content"), "utf8")).toBe(
            "old-app",
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("is referenced from the README install instructions", () => {
    const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8");
    expect(readme).toContain("scripts/install-macos.sh");
    expect(readme).toContain("curl -fsSL");
  });
});
