// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsModal } from "./SettingsModal";
import { defaultSettings } from "../../store/appStore";

afterEach(cleanup);

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
