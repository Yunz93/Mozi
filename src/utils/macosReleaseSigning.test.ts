import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const tauriConfigPath = resolve(projectRoot, "src-tauri/tauri.conf.json");
const entitlementsPath = resolve(projectRoot, "src-tauri/entitlements.plist");
const releaseWorkflowPath = resolve(
  projectRoot,
  ".github/workflows/release.yml",
);

describe("macOS release signing configuration", () => {
  it("recovers macOS assets from an existing tag on a pinned Arm64 runner", () => {
    const workflow = load(readFileSync(releaseWorkflowPath, "utf8")) as {
      on: Record<string, { inputs?: Record<string, { required: boolean }> }>;
      jobs: Record<
        string,
        {
          "runs-on": string;
          if?: string;
          env?: Record<string, string>;
          steps: Array<{
            name?: string;
            uses?: string;
            if?: string;
            with?: Record<string, string>;
            env?: Record<string, string>;
          }>;
        }
      >;
    };
    expect(workflow.on.workflow_dispatch.inputs?.release_tag.required).toBe(
      true,
    );
    const macos = workflow.jobs["build-macos"];
    expect(macos["runs-on"]).toBe("macos-15");
    expect(macos.env?.RELEASE_TAG).toBe(
      "${{ inputs.release_tag || github.ref_name }}",
    );
    const checkout = macos.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout?.with?.ref).toBe(
      "${{ github.event_name == 'workflow_dispatch' && format('refs/tags/{0}', inputs.release_tag) || github.ref }}",
    );
    const sync = macos.steps.find(
      (step) => step.name === "Sync app version from Git tag",
    );
    expect(sync?.if).toContain("github.event_name == 'workflow_dispatch'");
    const build = macos.steps.find((step) =>
      step.uses?.startsWith("tauri-apps/tauri-action@"),
    );
    expect(build?.with?.tagName).toBe("${{ env.RELEASE_TAG }}");
    expect(build?.with?.releaseName).toBe("Release ${{ env.RELEASE_TAG }}");
    expect(build?.with?.releaseDraft).toBe(false);
    expect(workflow.jobs["build-windows"].if).toBe(
      "github.event_name != 'workflow_dispatch'",
    );
  });

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
