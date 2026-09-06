/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { KnowledgeBaseHeader } from "./KnowledgeBaseHeader";

describe("KnowledgeBaseHeader", () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { ...defaultSettings, language: "zh-CN" },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the knowledge base name and opens settings from the gear", async () => {
    const onSwitch = vi.fn();
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();

    render(
      <KnowledgeBaseHeader
        name="Lingbot"
        path="/vault/Lingbot"
        onSwitch={onSwitch}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByText("Lingbot")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("switches the knowledge base from the name, not the gear", async () => {
    const onSwitch = vi.fn();
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();

    render(
      <KnowledgeBaseHeader
        name="Lingbot"
        onSwitch={onSwitch}
        onOpenSettings={onOpenSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Lingbot" }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
});
