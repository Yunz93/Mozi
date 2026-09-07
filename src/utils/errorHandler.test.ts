/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from "vitest";
import {
  FileSystemError,
  getErrorMessage,
  isIgnorableWindowErrorEvent,
  reportUnhandledRuntimeError,
} from "./errorHandler";
import { useAppStore } from "../store/appStore";

describe("reportUnhandledRuntimeError", () => {
  it("logs and attempts to show a notification", () => {
    const showNotification = vi.fn();
    useAppStore.setState({ showNotification });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportUnhandledRuntimeError(new Error("boom"), "unhandledrejection");

    expect(errorSpy).toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("getErrorMessage", () => {
  it("reads strings, Error, and invoke-style objects", () => {
    expect(getErrorMessage("  WeChat API error 40164  ")).toBe(
      "WeChat API error 40164",
    );
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage({ message: "invalid ip" })).toBe("invalid ip");
    expect(getErrorMessage(null)).toBe("");
  });
});

describe("isIgnorableWindowErrorEvent", () => {
  it("ignores image load failures without a script error", () => {
    const image = document.createElement("img");
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: image });
    expect(isIgnorableWindowErrorEvent(event)).toBe(true);
  });

  it("does not ignore real script exceptions", () => {
    const event = new ErrorEvent("error", {
      error: new Error("boom"),
      message: "boom",
    });
    expect(isIgnorableWindowErrorEvent(event)).toBe(false);
  });
});

describe("FileSystemError", () => {
  it("exposes FILE_EXISTS user copy", () => {
    const error = new FileSystemError("exists", "FILE_EXISTS", "/vault/a.md");
    expect(error.toUserMessage()).toBe("A file with this name already exists.");
  });
});
