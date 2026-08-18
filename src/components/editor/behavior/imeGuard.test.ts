import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  IME_CONFIRM_SUPPRESS_MS,
  createImeCompositionState,
  defaultKeymapWithoutEnter,
  wrapImeConfirmCommand,
  wrapImePassthroughCommand,
} from "./imeGuard";

function fakeView(
  overrides: Partial<Pick<EditorView, "composing" | "compositionStarted">> & {
    confirmSuppress?: boolean;
    composingGuard?: boolean;
  } = {},
): EditorView {
  return {
    composing: overrides.composing ?? false,
    compositionStarted: overrides.compositionStarted ?? false,
    plugin: () =>
      overrides.confirmSuppress || overrides.composingGuard
        ? {
            isComposing: () =>
              Boolean(overrides.composingGuard || overrides.confirmSuppress),
            isInConfirmSuppressWindow: () => Boolean(overrides.confirmSuppress),
          }
        : null,
  } as unknown as EditorView;
}

describe("createImeCompositionState", () => {
  it("stays composing until end, then suppresses for a short window", () => {
    let now = 1_000;
    const ime = createImeCompositionState({
      now: () => now,
      suppressMs: IME_CONFIRM_SUPPRESS_MS,
    });

    expect(ime.isComposing()).toBe(false);
    ime.onStart();
    expect(ime.isComposing()).toBe(true);
    expect(ime.isInConfirmSuppressWindow()).toBe(false);

    ime.onEnd();
    expect(ime.isInConfirmSuppressWindow()).toBe(true);
    expect(ime.isComposing()).toBe(true);

    now += IME_CONFIRM_SUPPRESS_MS;
    expect(ime.isInConfirmSuppressWindow()).toBe(false);
    expect(ime.isComposing()).toBe(false);
  });
});

describe("wrapImeConfirmCommand", () => {
  it("does not steal Enter while an IME composition is active", () => {
    const run = vi.fn(() => true);
    const wrapped = wrapImeConfirmCommand(run);
    expect(wrapped(fakeView({ composing: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("swallows the stray confirm Enter after compositionend", () => {
    const run = vi.fn(() => true);
    const wrapped = wrapImeConfirmCommand(run);
    expect(wrapped(fakeView({ confirmSuppress: true }))).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the command outside IME", () => {
    const run = vi.fn(() => true);
    const wrapped = wrapImeConfirmCommand(run);
    expect(wrapped(fakeView())).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("wrapImePassthroughCommand", () => {
  it("returns false during IME so Tab/Backspace stay native", () => {
    const run = vi.fn(() => true);
    const wrapped = wrapImePassthroughCommand(run);
    expect(wrapped(fakeView({ composing: true }))).toBe(false);
    expect(wrapped(fakeView({ confirmSuppress: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("defaultKeymapWithoutEnter", () => {
  it("drops the default Enter/Shift-Enter binding", () => {
    const keys = defaultKeymapWithoutEnter().flatMap((binding) => [
      binding.key,
      binding.mac,
      binding.win,
      binding.linux,
    ]);
    expect(keys).not.toContain("Enter");
    expect(
      defaultKeymapWithoutEnter().some(
        (binding) => binding.key === "Mod-Enter",
      ),
    ).toBe(true);
  });
});
