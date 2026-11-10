import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
  it("发布流程的外部Action全部固定为完整提交号", () => {
    const workflow = load(readFileSync(releaseWorkflowPath, "utf8")) as {
      jobs: Record<string, { steps: Array<{ uses?: string }> }>;
    };
    const actions = Object.values(workflow.jobs).flatMap((job) =>
      job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions)
      expect(action).toMatch(/^[\w-]+\/[\w/-]+@[a-f0-9]{40}$/);
  });

  it("recovers macOS assets from an existing tag on a pinned Arm64 runner", () => {
    const workflow = load(readFileSync(releaseWorkflowPath, "utf8")) as {
      on: Record<
        string,
        {
          inputs?: Record<
            string,
            { required: boolean; default?: string; options?: string[] }
          >;
        }
      >;
      jobs: Record<
        string,
        {
          "runs-on": string;
          needs?: string[];
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
    expect(workflow.on.workflow_dispatch.inputs?.build_runner).toMatchObject({
      default: "github-hosted",
      options: ["github-hosted", "local-once"],
    });
    expect(macos["runs-on"]).toBe(
      '${{ github.event_name == \'workflow_dispatch\' && inputs.build_runner == \'local-once\' && fromJSON(\'["self-hosted","macOS","ARM64","mozi-release-once"]\') || fromJSON(\'["macos-15"]\') }}',
    );
    expect(
      macos.steps.find((step) => step.uses?.startsWith("swatinem/rust-cache@"))
        ?.if,
    ).toBe("inputs.build_runner != 'local-once'");
    expect(
      macos.steps.find((step) => step.uses?.startsWith("actions/setup-node@"))
        ?.with?.cache,
    ).toBe("${{ inputs.build_runner != 'local-once' && 'npm' || '' }}");
    expect(
      macos.steps.find((step) => step.uses?.startsWith("actions/setup-node@"))
        ?.with?.["package-manager-cache"],
    ).toBe("${{ inputs.build_runner != 'local-once' }}");
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
    expect(build?.with?.releaseName).toBe(
      "${{ needs.release-channel.outputs.release_name }}",
    );
    expect(workflow.jobs["build-macos"].needs).toContain("release-channel");
    expect(build?.with?.releaseDraft).toBe(false);
    expect(workflow.jobs["build-windows"].if).toBe(
      "github.event_name != 'workflow_dispatch'",
    );
  });

  it("blocks local Apple credentials before host keychain or notarization changes", () => {
    const workflow = load(readFileSync(releaseWorkflowPath, "utf8")) as {
      jobs: Record<
        string,
        { steps: Array<{ name: string; if?: string; run?: string }> }
      >;
    };
    const steps = workflow.jobs["build-macos"].steps;
    const guard = steps.find(
      (step) => step.name === "Check one-shot local signing scope",
    );
    expect(guard?.if).toBe("inputs.build_runner == 'local-once'");
    expect(guard?.run).toBeTruthy();
    for (const [certificate, apiKey, status] of [
      ["", "", 0],
      ["fake-apple-certificate", "", 1],
      ["", "fake-apple-api-key", 1],
    ] as const) {
      const result = spawnSync("bash", ["-c", guard!.run!], {
        encoding: "utf8",
        env: {
          ...process.env,
          APPLE_CERTIFICATE: certificate,
          APPLE_API_KEY_CONTENT: apiKey,
        },
      });
      expect(result.status).toBe(status);
      expect(result.stdout + result.stderr).not.toContain("fake-apple-");
    }
    expect(
      steps.find((step) => step.name === "Import Apple Developer certificate")
        ?.if,
    ).toBe(
      "inputs.build_runner != 'local-once' && env.APPLE_CERTIFICATE != ''",
    );
    expect(
      steps.find(
        (step) => step.name === "Prepare Apple notarization credentials",
      )?.if,
    ).toBe("inputs.build_runner != 'local-once'");
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
