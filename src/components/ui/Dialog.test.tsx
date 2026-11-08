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
import { Dialog } from "./Dialog";
import { AppSelect } from "./AppSelect";

afterEach(cleanup);

describe("Dialog closable", () => {
  it("does not close on Escape or backdrop when closable is false", () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen title="Publish" onClose={onClose} closable={false}>
        <p>working</p>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    const backdrop = document.querySelector(".fixed.inset-0");
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape when closable defaults to true", () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen title="Publish" onClose={onClose}>
        <p>ready</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not steal input focus when onClose identity changes", async () => {
    const waitFrame = () =>
      act(async () => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      });

    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog isOpen title="Publish" onClose={() => {}}>
        <input aria-label="author" />
      </Dialog>,
    );

    await waitFrame();

    const input = screen.getByLabelText("author");
    input.focus();
    expect(document.activeElement).toBe(input);

    rerender(
      <Dialog isOpen title="Publish" onClose={onClose}>
        <input aria-label="author" />
      </Dialog>,
    );

    await waitFrame();

    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it("ignores IME Escape and lets an open dropdown consume Escape first", () => {
  const onClose = vi.fn();
  const { unmount } = render(
    <Dialog isOpen title="Input" onClose={onClose}>
      <input />
    </Dialog>,
  );
  fireEvent.keyDown(document, { key: "Escape", isComposing: true });
  fireEvent.keyDown(document, { key: "Escape", keyCode: 229 });
  const consumed = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  consumed.preventDefault();
  document.dispatchEvent(consumed);
  expect(onClose).not.toHaveBeenCalled();
  unmount();
});

it("keeps its visual backdrop out of pointer hit testing", () => {
  const onClose = vi.fn();
  const { unmount } = render(
    <Dialog isOpen title="Input" onClose={onClose}>
      <input />
    </Dialog>,
  );
  const shell = screen.getByRole("dialog", { name: "Input" }).parentElement!;
  expect(
    shell
      .querySelector(".backdrop-blur-sm")
      ?.classList.contains("pointer-events-none"),
  ).toBe(true);
  fireEvent.click(shell);
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
});

it("preserves an IME dropdown and closes only the dropdown on the next Escape", () => {
  const onClose = vi.fn();
  render(
    <Dialog isOpen title="Options" onClose={onClose}>
      <AppSelect
        value="a"
        options={[{ value: "a", label: "Alpha" }]}
        onChange={vi.fn()}
        aria-label="Choice"
      />
    </Dialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choice" }));
  fireEvent.keyDown(screen.getByRole("listbox"), {
    key: "Escape",
    isComposing: true,
  });
  expect(screen.queryByRole("listbox")).not.toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
