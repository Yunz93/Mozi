import { describe, expect, it } from "vitest";
import { isImeComposingEvent, isPlainEnterKey } from "./imeKeyboard";

describe("isImeComposingEvent", () => {
  it("detects isComposing on the event", () => {
    expect(isImeComposingEvent({ isComposing: true })).toBe(true);
  });

  it("detects legacy keyCode 229", () => {
    expect(isImeComposingEvent({ keyCode: 229 })).toBe(true);
    expect(isImeComposingEvent({ which: 229 })).toBe(true);
  });

  it("detects React nativeEvent composition signals", () => {
    expect(
      isImeComposingEvent({
        nativeEvent: { isComposing: true },
      }),
    ).toBe(true);
    expect(
      isImeComposingEvent({
        nativeEvent: { keyCode: 229 },
      }),
    ).toBe(true);
  });

  it("is false for normal key events", () => {
    expect(
      isImeComposingEvent({
        isComposing: false,
        keyCode: 13,
      }),
    ).toBe(false);
  });
});

describe("isPlainEnterKey", () => {
  it("accepts unmodified Enter outside IME", () => {
    expect(
      isPlainEnterKey({
        key: "Enter",
        isComposing: false,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBe(true);
  });

  it("allows Shift+Enter for callers that branch on shift", () => {
    expect(
      isPlainEnterKey({
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBe(true);
  });

  it("rejects IME confirmation Enter", () => {
    expect(
      isPlainEnterKey({
        key: "Enter",
        isComposing: true,
      }),
    ).toBe(false);
    expect(
      isPlainEnterKey({
        key: "Enter",
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it("rejects modified Enter chords", () => {
    expect(
      isPlainEnterKey({
        key: "Enter",
        metaKey: true,
      }),
    ).toBe(false);
    expect(
      isPlainEnterKey({
        key: "Enter",
        ctrlKey: true,
      }),
    ).toBe(false);
  });
});
