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
  readdirSync,
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

  it.each([
    ["", "v2.3.5", "v2.3.5"],
    ["2.3.4", "", "v2.3.4"],
    [" v2.3.4 ", "", "v2.3.4"],
    ["v2.3.6-beta.1", "", null],
    ["v2.3.6-nightly.1", "", null],
    ["v2.3.6+beta.1", "", null],
    ["", "v2.3.6-beta.2", null],
    ["", "https://github.com/Yunz93/Mozi/releases/latest", null],
    ["v2.3.6/other", "", null],
  ])("只解析正式版标签：指定 %s，latest 返回 %s", (tag, latest, expected) => {
    const helper = script.match(
      /normalize_release_tag\(\) \{[\s\S]*?\n\}/,
    )?.[0];
    expect(helper).toBeTruthy();
    const runner = `set -eu\nREPO=Yunz93/Mozi\nwarn(){ printf '%s' "$*" >&2; }\ncurl(){ printf '%s' "$LATEST_TAG"; }\n${helper}\nnormalize_release_tag "$REQUESTED_TAG"`;
    const result = spawnSync("bash", ["-c", runner], {
      encoding: "utf8",
      env: { ...process.env, REQUESTED_TAG: tag, LATEST_TAG: latest },
    });
    if (expected === null) {
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("仅支持正式版本标签");
    } else {
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(expected);
    }
  });

  it.each([
    "copy",
    "validation",
    "swap",
    "signal",
    "success",
    "target-race",
    "rollback-race",
    "lock",
  ])("安全处理安装结果：%s", (failure) => {
    const helper = script.match(/install_app_bundle\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(helper).toBeTruthy();
    const cleanup = script.match(/cleanup\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(cleanup).toBeTruthy();
    const safetyHelpers = [
      "install_directory_identity",
      "restore_install_backup",
    ]
      .map(
        (name) =>
          script.match(new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ??
          "",
      )
      .join("\n");
    const root = mkdtempSync(resolve(tmpdir(), "mozi-installer-test-"));
    try {
      const source = resolve(root, "source.app");
      const target = resolve(root, "墨知.app");
      mkdirSync(resolve(source, "Contents/MacOS"), { recursive: true });
      writeFileSync(resolve(source, "Contents/Info.plist"), "new-plist");
      const newExecutable = "#!/bin/sh\nprintf new-app\n";
      writeFileSync(resolve(source, "Contents/MacOS/app"), newExecutable);
      chmodSync(resolve(source, "Contents/MacOS/app"), 0o755);
      mkdirSync(target);
      writeFileSync(resolve(target, "old-content"), "old-app");
      if (failure === "lock") mkdirSync(`${target}.mozi-install-lock`);
      // Git Bash 不会自动转换环境变量里的 Windows 路径，夹具必须显式转换。
      const runner = `set -eu
warn(){ printf '%s\\n' "$*" >&2; }
log(){ :; }
if command -v cygpath >/dev/null 2>&1; then
  SOURCE="$(cygpath -u "$SOURCE")"
  TARGET="$(cygpath -u "$TARGET")"
fi
if [ "$(uname -s)" != Darwin ]; then
  stat(){ local last=""; for last in "$@"; do :; done; command stat -c '%d:%i' "$last"; }
fi
chmod +x "$SOURCE/Contents/MacOS/app"
printf fixture-ready
ditto(){ if [ "$FAILURE" = copy ]; then printf failure:copy >&2; return 1; fi; cp -R "$1" "$2"; }
xattr(){ :; }
plutil(){ if [ "$FAILURE" = validation ]; then printf failure:validation >&2; return 1; fi; if [ "$1" = -extract ]; then printf com.bxyz.markdown-press; fi; }
mv(){ if [ "$FAILURE" = rollback-race ] && [[ "$1" == */new.app ]]; then printf failure:rollback-race >&2; return 1; fi; if [ "$FAILURE" = rollback-race ] && [[ "$1" == */previous.app ]]; then mkdir -p "$TARGET"; fi; if [ "$FAILURE" = target-race ] && [[ "$1" == */new.app ]]; then printf failure:target-race >&2; mkdir -p "$TARGET"; fi; if [ "$FAILURE" = swap ] && [[ "$1" == */new.app ]]; then printf failure:swap >&2; return 1; fi; command mv "$@"; if [ "$FAILURE" = signal ] && [[ "$2" == */previous.app ]]; then printf failure:signal >&2; kill -TERM $$; fi; }
${safetyHelpers}
${cleanup}
MOUNT_POINT=""
TMP_DIR="$(mktemp -d)"
trap cleanup EXIT
trap 'exit 143' TERM
${helper}
install_app_bundle "$SOURCE" "$TARGET"`;
      const result = spawnSync("bash", ["-c", runner], {
        encoding: "utf8",
        env: {
          ...process.env,
          SOURCE: source,
          TARGET: target,
          FAILURE: failure,
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.stdout, result.stderr).toContain("fixture-ready");
      if (failure === "success") {
        expect(result.status, result.stderr).toBe(0);
        expect(readText(resolve(target, "Contents/MacOS/app"), "utf8")).toBe(
          newExecutable,
        );
      } else if (failure === "target-race" || failure === "rollback-race") {
        expect(result.status, result.stderr).not.toBe(0);
        expect(result.stderr).toContain(`failure:${failure}`);
        const retained = (directory: string): boolean =>
          readdirSync(directory, { withFileTypes: true }).some((entry) =>
            entry.isDirectory()
              ? retained(resolve(directory, entry.name))
              : entry.name === "old-content" &&
                readText(resolve(directory, entry.name), "utf8") === "old-app",
          );
        expect(retained(root), "原应用备份必须保留").toBe(true);
      } else {
        expect(result.status, result.stderr).not.toBe(0);
        if (failure !== "lock")
          expect(result.stderr).toContain(`failure:${failure}`);
        expect(existsSync(resolve(target, "old-content"))).toBe(true);
        expect(readText(resolve(target, "old-content"), "utf8")).toBe(
          "old-app",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is referenced from the README install instructions", () => {
    const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8");
    expect(readme).toContain("scripts/install-macos.sh");
    expect(readme).toContain("curl -fsSL");
  });
});
