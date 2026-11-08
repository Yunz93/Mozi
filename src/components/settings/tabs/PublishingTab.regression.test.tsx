// @vitest-environment happy-dom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishingTab } from "./PublishingTab";
import { defaultSettings, useAppStore } from "../../../store/appStore";
import { loadSecureSettings } from "../../../services/secureSettingsService";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("../../../types/filesystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../types/filesystem")>()),
  isTauriEnvironment: () => true,
}));

afterEach(() => {
  cleanup();
  invoke.mockReset();
});

describe("公众号配置检查的安全存储一致性", () => {
  it.each(["changed-in-another-window", null])(
    "其他窗口修改为 %s 后，不把旧缓存视为已安全保存",
    async (storedSecret) => {
      const settings = {
        ...defaultSettings,
        language: "zh-CN" as const,
        wechatAppId: "wx-test-account",
        wechatAppSecret: "original-secret",
      };
      useAppStore.setState({ settings });
      invoke.mockResolvedValue({ wechatAppSecret: "original-secret" });
      await loadSecureSettings();
      // 模拟另一个窗口写入共享后端，当前窗口的界面及加载缓存仍是旧值。
      invoke.mockResolvedValue({ wechatAppSecret: storedSecret });
      render(<PublishingTab settings={settings} onUpdateSettings={vi.fn()} />);
      fireEvent.click(screen.getByRole("tab", { name: "微信公众号" }));
      fireEvent.click(screen.getByRole("button", { name: "检查配置" }));
      await waitFor(() => {
        expect(screen.getByText(/AppSecret 尚未安全保存/)).toBeTruthy();
      });
      expect(invoke).not.toHaveBeenCalledWith(
        "set_secure_secret",
        expect.anything(),
      );
    },
  );
});
