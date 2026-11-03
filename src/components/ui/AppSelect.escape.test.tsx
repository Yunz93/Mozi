/** @vitest-environment happy-dom */

import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { SettingsModal } from "../settings/SettingsModal";
import { AppSelect } from "./AppSelect";
import { Dialog } from "./Dialog";

beforeEach(() => {
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
    settingsFocusTab: null,
  });
});

afterEach(cleanup);

function SettingsHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const settings = useAppStore((state) => state.settings);
  return (
    <SettingsModal
      isOpen={open}
      settings={settings}
      onUpdateSettings={useAppStore.getState().updateSettings}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    />
  );
}

function DialogHarness({
  onClose,
  closable = true,
}: {
  onClose: () => void;
  closable?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("first");
  return (
    <Dialog
      isOpen={open}
      title="Parent dialog"
      closable={closable}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    >
      <AppSelect
        aria-label="Choice"
        value={value}
        options={[
          { value: "first", label: "First" },
          { value: "second", label: "Second" },
        ]}
        onChange={setValue}
      />
    </Dialog>
  );
}

describe("AppSelect Escape ownership", () => {
  it("closes the AI provider list before the actual settings modal", async () => {
    const onClose = vi.fn();
    useAppStore.setState({ settingsFocusTab: "ai" });
    render(<SettingsHarness onClose={onClose} />);
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "AI 提供商" });
    await user.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(6);
    screen.getByRole("option", { name: "Kimi" }).focus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(useAppStore.getState().settings.aiProvider).toBe(
      defaultSettings.aiProvider,
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("also consumes Escape before a generic Dialog document listener", async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Choice" });
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Parent dialog" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still selects an option without closing the parent dialog", async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Choice" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Second" }));
    expect(trigger.textContent).toBe("Second");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a nonclosable parent open after dismissing its dropdown", async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} closable={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Choice" }));
    await user.keyboard("{Escape}{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Parent dialog" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes its Escape listener when an open dropdown unmounts", async () => {
    const mounted = render(
      <AppSelect
        value="first"
        aria-label="Choice"
        options={[{ value: "first", label: "First" }]}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Choice" }));
    mounted.unmount();
    const onKeyDown = vi.fn();
    document.addEventListener("keydown", onKeyDown, true);
    try {
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onKeyDown).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("keydown", onKeyDown, true);
    }
  });
});
