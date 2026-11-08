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
import { defaultSettings } from "../../store/appStore";

afterEach(() => {
  cleanup();
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
  const first = document.activeElement;
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
