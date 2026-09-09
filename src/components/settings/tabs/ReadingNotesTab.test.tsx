/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../../store/uiStore";
import { ReadingNotesTab } from "./ReadingNotesTab";

vi.mock("../useSecureSettings", () => ({
  useSecureSettings: () => ({
    handleSecureSettingChange: vi.fn(),
    renderSecureSaveState: () => null,
  }),
}));

afterEach(() => {
  cleanup();
});

describe("ReadingNotesTab", () => {
  it("uses an independent reading-notes tab with WeRead as the current module", () => {
    render(
      <ReadingNotesTab
        settings={defaultSettings}
        onUpdateSettings={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "读书笔记同步" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "微信读书" })).toBeTruthy();
    expect(screen.getByText("微信读书 API Key")).toBeTruthy();
  });
});
