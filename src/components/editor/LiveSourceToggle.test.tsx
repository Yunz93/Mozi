/** @vitest-environment happy-dom */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveSourceToggle } from "./LiveSourceToggle";
import { useAppStore } from "../../store/appStore";

describe("LiveSourceToggle", () => {
  it("offers plain text when Live Preview is showing", async () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, language: "zh-CN" },
    });
    const onToggle = vi.fn();
    render(<LiveSourceToggle sourceMode={false} onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "显示纯文本" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("offers live preview when source chrome is on", async () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, language: "zh-CN" },
    });
    const onToggle = vi.fn();
    render(<LiveSourceToggle sourceMode onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "显示实时预览" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
