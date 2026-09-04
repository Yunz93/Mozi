import { describe, expect, it, vi } from "vitest";
import { FileSystemError, reportUnhandledRuntimeError } from "./errorHandler";
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

describe("FileSystemError", () => {
  it("exposes FILE_EXISTS user copy", () => {
    const error = new FileSystemError("exists", "FILE_EXISTS", "/vault/a.md");
    expect(error.toUserMessage()).toBe("A file with this name already exists.");
  });
});
