/** @vitest-environment happy-dom */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../../store/uiStore";
import { ReadingNotesTab } from "./ReadingNotesTab";
import { updateWereadSkill } from "../../../utils/weread/wereadApi";

vi.mock("../../../utils/weread/wereadApi", () => ({
  updateWereadSkill: vi.fn(),
}));
vi.mock("../../../types/filesystem", () => ({
  isTauriEnvironment: () => true,
}));

vi.mock("../useSecureSettings", () => ({
  useSecureSettings: () => ({
    handleSecureSettingChange: vi.fn(),
    renderSecureSaveState: () => null,
  }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
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

  it("keeps import and Skill update actions in the same row", () => {
    render(
      <ReadingNotesTab settings={defaultSettings} onUpdateSettings={vi.fn()} />,
    );
    const importButton = screen.getByRole("button", { name: "打开导入对话框" });
    const updateButton = screen.getByRole("button", {
      name: "更新微信读书 Skill",
    });
    expect(importButton.parentElement).toBe(updateButton.parentElement);
  });

  it("uses the shared dropdown to change the import directory structure", () => {
    const onUpdateSettings = vi.fn();
    render(
      <ReadingNotesTab
        settings={defaultSettings}
        onUpdateSettings={onUpdateSettings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "目录结构" }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    fireEvent.click(screen.getByRole("option", { name: "按作者分子目录" }));
    expect(onUpdateSettings).toHaveBeenCalledWith({
      wereadImportFolderMode: "author",
    });
  });

  it("prevents repeat updates and shows the installed Skill version", async () => {
    let finish: (version: string) => void = () => undefined;
    vi.mocked(updateWereadSkill).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <ReadingNotesTab settings={defaultSettings} onUpdateSettings={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "更新微信读书 Skill" }));
    const pending = screen.getByRole("button", {
      name: "正在更新 Skill…",
    }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(updateWereadSkill).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish("1.0.5");
    });
    expect(screen.getByRole("status").textContent).toContain("已更新至 1.0.5");
    expect(
      (
        screen.getByRole("button", {
          name: "更新微信读书 Skill",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows an update failure and lets the user try again", async () => {
    vi.mocked(updateWereadSkill).mockRejectedValueOnce(
      new Error("download interrupted"),
    );
    render(
      <ReadingNotesTab settings={defaultSettings} onUpdateSettings={vi.fn()} />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "更新微信读书 Skill" }),
      );
    });
    expect(screen.getByRole("status").textContent).toContain(
      "原版本已保留：download interrupted",
    );
    vi.mocked(updateWereadSkill).mockResolvedValueOnce("1.0.5");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "更新微信读书 Skill" }),
      );
    });
    expect(screen.getByRole("status").textContent).toContain("已更新至 1.0.5");
  });
});
