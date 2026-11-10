/** @vitest-environment happy-dom */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import { requestBuiltinEmbeddingDownloadConsent } from "../services/vault/builtinEmbeddingConsent";
import { getUiAccentColorVariables } from "../utils/uiAccentColor";

vi.mock("./settings/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("./ai/AiResultReviewDialog", () => ({
  AiResultReviewDialog: () => null,
}));
vi.mock("./publish/PublishTargetDialog", () => ({
  PublishTargetDialog: () => null,
}));
vi.mock("./publish/SimpleBlogPublishDialog", () => ({
  SimpleBlogPublishDialog: () => null,
}));
vi.mock("./publish/WechatDraftDialog", () => ({
  WechatDraftDialog: () => null,
}));
vi.mock("./import/WeReadImportDialog", () => ({
  WeReadImportDialog: () => null,
}));
vi.mock("./share/ShareLongImageDialog", () => ({
  ShareLongImageDialog: () => null,
}));
import { AppDialogs } from "./AppDialogs";

const css = ["workspace.css", "workspace-settings.css"]
  .map((file) =>
    readFileSync(resolve(process.cwd(), "src/styles", file), "utf8"),
  )
  .join("\n");
let stylesheet: HTMLStyleElement;
let pending: Promise<boolean> | undefined;

function applyTheme(theme: "light" | "dark", accent = "default") {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.removeAttribute("style");
  const canvas = getComputedStyle(root)
    .getPropertyValue("--workspace-canvas")
    .trim();
  for (const [name, value] of Object.entries(
    getUiAccentColorVariables(accent, canvas),
  )) {
    root.style.setProperty(name, value);
  }
}

function openConsent() {
  const props = {
    settings: useAppStore.getState().settings,
    t: (key: string) => key,
    uiScaleStyle: {},
    notification: null,
  } as React.ComponentProps<typeof AppDialogs>;
  render(<AppDialogs {...props} />);
  act(() => {
    pending = requestBuiltinEmbeddingDownloadConsent();
  });
  return screen.getByRole("dialog", { name: "下载内置语义模型？" });
}

beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = css;
  document.head.appendChild(stylesheet);
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
    pendingDraftRestore: null,
    pendingCloseDespiteSaveFailure: null,
  });
});

afterEach(async () => {
  const skip = screen.queryByRole("button", { name: "暂不" });
  if (skip) fireEvent.click(skip);
  if (pending) await pending;
  pending = undefined;
  cleanup();
  stylesheet.remove();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
});

describe("内置模型下载确认的主题色", () => {
  it.each([
    ["light", "default"],
    ["dark", "default"],
    ["light", "#2563eb"],
    ["dark", "#2b7c68"],
  ] as const)("在 %s / %s 中使用工作区主按钮颜色", (theme, accent) => {
    applyTheme(theme, accent);
    const dialog = openConsent();
    const tokens = getComputedStyle(document.documentElement);
    const background = tokens.getPropertyValue("--workspace-primary-bg").trim();
    expect(background).toMatch(/^#[\da-f]{6}$/);
    expect(getComputedStyle(dialog).backgroundColor).toBe(
      tokens.getPropertyValue("--workspace-menu").trim(),
    );
    const button = getComputedStyle(
      screen.getByRole("button", { name: "下载" }),
    );
    expect(button.backgroundColor).toBe(background);
    expect(button.color).toBe(
      tokens.getPropertyValue("--workspace-primary-text").trim(),
    );
  });

  it("弹窗打开时切换主题和自定义强调色也会立即更新", () => {
    applyTheme("light");
    openConsent();
    const button = screen.getByRole("button", { name: "下载" });
    applyTheme("dark", "#6d43a8");
    const tokens = getComputedStyle(document.documentElement);
    expect(getComputedStyle(button).backgroundColor).toBe(
      tokens.getPropertyValue("--workspace-primary-bg").trim(),
    );
    expect(getComputedStyle(button).color).toBe(
      tokens.getPropertyValue("--workspace-primary-text").trim(),
    );
  });

  it.each([
    ["下载", true],
    ["暂不", false],
  ] as const)("选择%s后保持原有授权结果", async (label, granted) => {
    applyTheme("light");
    openConsent();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await expect(pending).resolves.toBe(granted);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
