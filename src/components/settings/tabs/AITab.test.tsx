/** @vitest-environment happy-dom */
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AITab } from "./AITab";
import { defaultSettings } from "../../../store/uiStore";
import { COMPATIBLE_PROVIDERS } from "../../../services/ai/compatibleProviders";
import type { AIProvider } from "../../../types";

const save = vi.hoisted(() => vi.fn());
vi.mock("../useSecureSettings", () => ({
  useSecureSettings: () => ({
    handleSecureSettingChange: save,
    renderSecureSaveState: () => null,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function Harness({
  initialProvider = "deepseek",
}: {
  initialProvider?: AIProvider;
}) {
  const [settings, setSettings] = useState({
    ...defaultSettings,
    aiProvider: initialProvider,
  });
  return (
    <AITab
      settings={settings}
      onUpdateSettings={(updates) =>
        setSettings((previous) => ({ ...previous, ...updates }))
      }
    />
  );
}
describe.each(["glm", "kimi", "mimo"] as const)("%s settings", (provider) => {
  it("can select the provider and displays the correct independent configuration", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "AI 提供商" }));
    fireEvent.click(
      screen.getByRole("option", {
        name: COMPATIBLE_PROVIDERS[provider].label,
      }),
    );
    expect(
      (
        screen.getByLabelText(
          `${COMPATIBLE_PROVIDERS[provider].label} API Base URL`,
        ) as HTMLInputElement
      ).value,
    ).toBe(COMPATIBLE_PROVIDERS[provider].baseUrl);
    const key = screen.getByLabelText(
      `${COMPATIBLE_PROVIDERS[provider].label} API Key`,
    ) as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(screen.getByText("密钥保存在本机安全存储中。")).toBeTruthy();
    expect(screen.queryByText(/使用 DeepSeek Platform API 密钥/)).toBeNull();
    fireEvent.change(key, { target: { value: "test-secret" } });
    expect(save).toHaveBeenCalledWith(`${provider}ApiKey`, "test-secret");
    expect(screen.getByRole("button", { name: "模型" }).textContent).toContain(
      COMPATIBLE_PROVIDERS[provider].model,
    );
  });
  it("supports a custom model and preserves its ID across provider switches", () => {
    render(<Harness initialProvider={provider} />);
    fireEvent.click(screen.getByRole("button", { name: "模型" }));
    fireEvent.click(screen.getByRole("option", { name: "自定义模型" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模型 ID" }), {
      target: { value: "my-model-id" },
    });
    fireEvent.click(screen.getByRole("button", { name: "AI 提供商" }));
    fireEvent.click(screen.getByRole("option", { name: "Gemini" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 提供商" }));
    fireEvent.click(
      screen.getByRole("option", {
        name: COMPATIBLE_PROVIDERS[provider].label,
      }),
    );
    expect(
      (screen.getByRole("textbox", { name: "模型 ID" }) as HTMLInputElement)
        .value,
    ).toBe("my-model-id");
  });
});
