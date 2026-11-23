/** @vitest-environment happy-dom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeBaseOnboarding } from "./KnowledgeBaseOnboarding";

describe("KnowledgeBaseOnboarding", () => {
  it("offers opening a vault, opening one file, or skipping setup", () => {
    const onOpen = vi.fn();
    const onOpenFile = vi.fn();
    const onSkip = vi.fn();
    render(
      <KnowledgeBaseOnboarding
        uiScaleStyle={{}}
        uiFontFamily="sans-serif"
        onOpen={onOpen}
        onOpenFile={onOpenFile}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开知识库" }));
    fireEvent.click(screen.getByRole("button", { name: "打开 Markdown 文件" }));
    fireEvent.click(screen.getByRole("button", { name: "稍后设置" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledOnce();
  });
});
