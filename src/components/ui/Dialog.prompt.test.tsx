/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptDialog } from "./Dialog";

vi.mock("../../hooks/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    language: "en",
  }),
}));

afterEach(() => {
  cleanup();
});

describe("PromptDialog", () => {
  it("submits only once when confirm is clicked repeatedly", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(
      <PromptDialog
        isOpen
        title="New Drawing"
        defaultValue="Robby"
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );

    const confirm = screen.getByRole("button", { name: "common_confirm" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Robby");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
