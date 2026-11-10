// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsModal } from "./SettingsModal";
import { defaultSettings, useAppStore } from "../../store/appStore";

afterEach(() => {
  cleanup();
  useAppStore.setState({ settingsFocusTab: null });
  vi.restoreAllMocks();
});

it("keeps IME Escape in settings, contains Tab, and restores the opener", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const onClose = vi.fn();
  const { unmount } = render(
    <SettingsModal
      isOpen
      onClose={onClose}
      settings={defaultSettings}
      onUpdateSettings={vi.fn()}
    />,
  );
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  const dialog = screen.getByRole("dialog");
  expect(dialog.contains(document.activeElement)).toBe(true);
  const first = within(dialog).getAllByRole("button")[0];
  first.focus();
  fireEvent.keyDown(first!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).not.toBe(first);
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first!, { key: "Escape", isComposing: true });
  fireEvent.keyDown(first!, { key: "Escape", keyCode: 229 });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(first!, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
  vi.restoreAllMocks();
});

it("设置中的下拉菜单选项可通过 Tab 到达，并与设置窗口共同保持焦点循环", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const user = userEvent.setup();
  render(
    <SettingsModal
      isOpen
      onClose={vi.fn()}
      settings={defaultSettings}
      onUpdateSettings={vi.fn()}
    />,
  );
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  const dialog = screen.getByRole("dialog");
  const first = within(dialog).getAllByRole("button")[0];
  const trigger = dialog.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="listbox"]',
  )!;
  trigger.focus();
  await user.keyboard("{Enter}");
  const options = within(screen.getByRole("listbox")).getAllByRole("option");
  within(dialog).getByRole("button", { name: "拖拽调整设置窗口大小" }).focus();
  await user.tab();
  expect(document.activeElement).toBe(options[0]);
  options[options.length - 1].focus();
  await user.tab();
  expect(document.activeElement).toBe(first);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(options[options.length - 1]);
});

it.each([null, "tasks", "readingNotes"] as const)(
  "首次打开时焦点与实际选中的设置页一致（%s）",
  async (requestedTab) => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    useAppStore.setState({ settingsFocusTab: requestedTab });
    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        settings={defaultSettings}
        onUpdateSettings={vi.fn()}
      />,
    );
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    const selected = screen
      .getByRole("dialog")
      .querySelector('[aria-current="page"]');
    expect(selected?.textContent).toBe(
      requestedTab === "tasks"
        ? "待办与日程"
        : requestedTab === "readingNotes"
          ? "读书笔记同步"
          : "编辑器",
    );
    expect(document.activeElement).toBe(selected);
  },
);

it("再次打开时聚焦上次选中的设置页并在关闭后还原入口焦点", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const props = {
    onClose: vi.fn(),
    settings: defaultSettings,
    onUpdateSettings: vi.fn(),
  };
  const view = render(<SettingsModal {...props} isOpen />);
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: /^元数据$/,
    }),
  );
  view.rerender(<SettingsModal {...props} isOpen={false} />);
  expect(document.activeElement).toBe(opener);
  view.rerender(<SettingsModal {...props} isOpen />);
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  const selected = screen
    .getByRole("dialog")
    .querySelector('[aria-current="page"]');
  expect(selected?.textContent).toBe("元数据");
  expect(document.activeElement).toBe(selected);
  view.unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});
