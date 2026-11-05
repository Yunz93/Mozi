/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { ViewMode } from "../../types";
import { Toolbar } from "./Toolbar";

const exportState = vi.hoisted(() => ({ inFlight: false }));
vi.mock("../../hooks/useExportActions", () => ({
  getExportInFlight: () => exportState.inFlight,
  subscribeExportInFlight: () => () => {},
}));

function setup(overrides: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
  const props = {
    fileName: "演示笔记.md",
    viewMode: ViewMode.PREVIEW,
    onViewModeChange: vi.fn(),
    onAIAnalyze: vi.fn(),
    onAskVault: vi.fn(),
    isAnalyzing: false,
    isSaving: false,
    isSidebarOpen: true,
    onMenuClick: vi.fn(),
    onToggleTheme: vi.fn(),
    themeMode: "light" as const,
    onPublish: vi.fn(),
    onExportPdf: vi.fn(),
    onExportHtml: vi.fn(),
    onShareLongImage: vi.fn(),
    ...overrides,
  };
  const rendered = render(<Toolbar {...props} />);
  return { ...rendered, props, user: userEvent.setup() };
}

describe("Toolbar", () => {
  beforeEach(() => {
    exportState.inFlight = false;
    useAppStore.setState({
      settings: { ...defaultSettings, language: "zh-CN" },
    });
  });

  afterEach(cleanup);

  it("keeps icon-only controls accessible with editing before reading", async () => {
    const { props, user } = setup();
    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(names.slice(1)).toEqual([
      "切换到深色模式",
      "小知助手",
      "AI 增强",
      "实时预览",
      "阅读",
      "发布",
      "更多操作",
    ]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent).toBe("");
      expect(button.getAttribute("title")).toBeTruthy();
    }
    await user.click(screen.getByRole("button", { name: "切换到深色模式" }));
    await user.click(screen.getByRole("button", { name: "小知助手" }));
    await user.click(screen.getByRole("button", { name: "AI 增强" }));
    expect(props.onAIAnalyze).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "实时预览" }));
    await user.click(screen.getByRole("button", { name: "发布" }));
    expect(props.onToggleTheme).toHaveBeenCalledOnce();
    expect(props.onAskVault).toHaveBeenCalledOnce();
    expect(props.onViewModeChange).toHaveBeenCalledWith(ViewMode.LIVE);
    await user.click(screen.getByRole("button", { name: "阅读" }));
    expect(props.onViewModeChange).toHaveBeenLastCalledWith(ViewMode.PREVIEW);
    expect(props.onPublish).toHaveBeenCalledOnce();
  });

  it("preserves all relocated actions and closes the menu after each action", async () => {
    const { props, user } = setup();
    for (const [name, callback] of [
      ["导出 PDF", props.onExportPdf],
      ["导出 HTML", props.onExportHtml],
      ["长图分享", props.onShareLongImage],
    ] as const) {
      await user.click(screen.getByRole("button", { name: "更多操作" }));
      expect(screen.queryByRole("menuitem", { name: "AI 增强" })).toBeNull();
      const item = screen.getByRole("menuitem", { name });
      expect(item.textContent).toBe("");
      expect(item.getAttribute("title")).toBe(name);
      await user.click(item);
      expect(callback).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).toBeNull();
    }
  });

  it("keeps AI progress visible through each phase and clears it when finished", () => {
    const { props, rerender } = setup({
      isAnalyzing: true,
      aiEnhanceStage: "preparing",
    });
    expect(screen.getByRole("status").textContent).toContain("正在准备笔记");
    expect(
      screen
        .getByRole("button", { name: "AI 增强中" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    rerender(<Toolbar {...props} aiEnhanceStage="analyzing" />);
    expect(screen.getByRole("status").textContent).toContain(
      "正在分析并优化内容",
    );
    expect(screen.getByRole("status").textContent).toContain("原文暂不修改");
    rerender(<Toolbar {...props} aiEnhanceStage="reviewing" />);
    expect(screen.getByRole("status").textContent).toContain(
      "正在整理增强结果",
    );
    rerender(<Toolbar {...props} isAnalyzing={false} aiEnhanceStage={null} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "AI 增强" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("supports menu keyboard navigation, Escape and outside dismissal", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: "更多操作" });
    await user.click(trigger);
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "导出 PDF" }),
    );
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "导出 HTML" }),
    );
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "导出 PDF" }),
    );
    await user.keyboard("{End}{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "导出 PDF" }),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByText("演示笔记"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the global assistant available when no note is selected", async () => {
    const { props, user } = setup({ fileName: "" });
    await user.click(screen.getByRole("button", { name: "小知助手" }));
    expect(props.onAskVault).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: "发布" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(
      screen
        .getAllByRole("menuitem")
        .every((item) => (item as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("blocks document operations for preview-only attachments", async () => {
    const { user } = setup({ isPreviewOnlyFile: true });
    for (const name of ["小知助手", "AI 增强", "实时预览", "发布"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(
      screen
        .getAllByRole("menuitem")
        .every((item) => (item as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("prevents duplicate exports and skips disabled actions during keyboard navigation", async () => {
    exportState.inFlight = true;
    const { user } = setup({ isAnalyzing: true });
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(
      (screen.getByRole("button", { name: "AI 增强中" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    for (const name of ["导出 PDF", "导出 HTML"]) {
      expect(
        (screen.getByRole("menuitem", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    const share = screen.getByRole("menuitem", { name: "长图分享" });
    expect(document.activeElement).toBe(share);
    await user.keyboard("{ArrowDown}{Home}");
    expect(document.activeElement).toBe(share);
  });
});
