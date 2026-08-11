import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const tauriConfigPath = resolve(projectRoot, "src-tauri/tauri.conf.json");
const entitlementsPath = resolve(projectRoot, "src-tauri/entitlements.plist");
const releaseWorkflowPath = resolve(
  projectRoot,
  ".github/workflows/release.yml",
);

describe("macOS release signing configuration", () => {
  it("configures hardened runtime entitlements for macOS bundles", () => {
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
    const entitlements = readFileSync(entitlementsPath, "utf8");

    expect(tauriConfig.bundle.macOS).toMatchObject({
      entitlements: "entitlements.plist",
      hardenedRuntime: true,
    });
    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
    expect(entitlements).toContain("com.apple.security.network.client");
  });

  it("wires certificate import and conditional signing in release workflow", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("scripts/import-apple-certificate.sh");
    expect(workflow).toContain("scripts/prepare-apple-notarization.mjs");
    expect(workflow).toContain("env.APPLE_CERTIFICATE != ''");
    expect(workflow).toContain("Prepare Apple notarization credentials");
    expect(workflow).not.toContain('APPLE_SIGNING_IDENTITY: "-"');
    expect(workflow).not.toMatch(
      /Build and upload release assets[\s\S]*APPLE_ID: \$\{\{ secrets\.APPLE_ID \}\}/,
    );
    expect(workflow).toContain("APPLE_ID: ${{ secrets.APPLE_ID }}");
  });

  it("keeps updater plugin endpoints configured for Windows in-app updates", async () => {
    const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
    const { UPDATER_ARTIFACTS_ENABLED } =
      await import("../services/updaterCapabilities");

    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(
      UPDATER_ARTIFACTS_ENABLED,
    );
    expect(tauriConfig.plugins?.updater?.endpoints).toEqual([
      "https://github.com/Yunz93/Mozi/releases/latest/download/latest.json",
    ]);
    expect(typeof tauriConfig.plugins?.updater?.pubkey).toBe("string");
    expect(tauriConfig.plugins.updater.pubkey.length).toBeGreaterThan(0);
  });
});
