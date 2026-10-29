/** @vitest-environment happy-dom */
import { expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../types/filesystem", () => ({ isTauriEnvironment: () => true }));

it("hydrates and securely saves independent provider keys while scrubbing persisted copies", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "get_secure_settings"
      ? {
          glmApiKey: "glm-from-secure",
          kimiApiKey: "kimi-from-secure",
          mimoApiKey: "mimo-from-secure",
        }
      : undefined,
  );
  const { loadSecureSettings, persistSecureSetting } =
    await import("./secureSettingsService");
  localStorage.setItem(
    "markdown-press-settings",
    JSON.stringify({
      state: {
        settings: {
          glmApiKey: "legacy-glm",
          kimiApiKey: "legacy-kimi",
          mimoApiKey: "legacy-mimo",
          language: "en",
        },
      },
    }),
  );
  expect(await loadSecureSettings()).toMatchObject({
    glmApiKey: "glm-from-secure",
    kimiApiKey: "kimi-from-secure",
    mimoApiKey: "mimo-from-secure",
  });
  const stored = JSON.parse(localStorage.getItem("markdown-press-settings")!);
  expect(stored.state.settings).toEqual({ language: "en" });
  for (const provider of ["glm", "kimi", "mimo"] as const) {
    await persistSecureSetting(`${provider}ApiKey`, `  ${provider}-new  `);
    expect(invoke).toHaveBeenCalledWith("set_secure_secret", {
      key: `${provider}ApiKey`,
      value: `${provider}-new`,
    });
    expect(await loadSecureSettings()).toHaveProperty(
      `${provider}ApiKey`,
      `${provider}-new`,
    );
  }
  await persistSecureSetting("kimiApiKey", " ");
  expect(invoke).toHaveBeenLastCalledWith("set_secure_secret", {
    key: "kimiApiKey",
    value: null,
  });
  expect(await loadSecureSettings()).toHaveProperty("kimiApiKey", "");
  localStorage.removeItem("markdown-press-settings");
});
