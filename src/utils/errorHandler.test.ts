/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from "vitest";
import { t } from "./i18n";
import {
  FileSystemError,
  getErrorMessage,
  isIgnorableWindowErrorEvent,
  reportUnhandledRuntimeError,
  userFacingRuntimeErrorMessage,
} from "./errorHandler";
import { useAppStore } from "../store/appStore";

const WECHAT_IP_ERROR =
  "WeChat API error 40164 during fetching access token: invalid ip 1.2.3.4, not in whitelist";

describe("reportUnhandledRuntimeError", () => {
  it("logs and attempts to show a notification", () => {
    const showNotification = vi.fn();
    useAppStore.setState({
      showNotification,
      settings: { ...useAppStore.getState().settings, language: "zh-CN" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportUnhandledRuntimeError(new Error("boom"), "unhandledrejection");

    expect(errorSpy).toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith(
      t("zh-CN", "errorBoundary_fallbackMessage"),
      "error",
    );
    errorSpy.mockRestore();
  });

  it("surfaces mapped WeChat publish errors instead of the generic fallback", () => {
    const showNotification = vi.fn();
    useAppStore.setState({
      showNotification,
      settings: { ...useAppStore.getState().settings, language: "zh-CN" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportUnhandledRuntimeError(
      new Error(WECHAT_IP_ERROR),
      "unhandledrejection",
    );

    expect(showNotification).toHaveBeenCalledWith(
      t("zh-CN", "notifications_wechatIpAllowlist"),
      "error",
    );
    expect(showNotification.mock.calls[0][0]).not.toBe(
      t("zh-CN", "errorBoundary_fallbackMessage"),
    );
    errorSpy.mockRestore();
  });
});

describe("userFacingRuntimeErrorMessage", () => {
  it("keeps the generic fallback for unknown script exceptions", () => {
    expect(userFacingRuntimeErrorMessage(new Error("boom"), "zh-CN")).toBe(
      t("zh-CN", "errorBoundary_fallbackMessage"),
    );
  });

  it("maps WeChat invoke payloads to the stepwise publish copy", () => {
    expect(userFacingRuntimeErrorMessage(WECHAT_IP_ERROR, "zh-CN")).toBe(
      t("zh-CN", "notifications_wechatIpAllowlist"),
    );
    expect(
      userFacingRuntimeErrorMessage({ error: WECHAT_IP_ERROR }, "zh-CN"),
    ).toBe(t("zh-CN", "notifications_wechatIpAllowlist"));
  });
});

describe("getErrorMessage", () => {
  it("reads strings, Error, and invoke-style objects", () => {
    expect(getErrorMessage("  WeChat API error 40164  ")).toBe(
      "WeChat API error 40164",
    );
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage({ message: "invalid ip" })).toBe("invalid ip");
    expect(getErrorMessage({ error: WECHAT_IP_ERROR })).toBe(WECHAT_IP_ERROR);
    expect(
      getErrorMessage({
        errcode: 40164,
        errmsg: "invalid ip not in whitelist",
      }),
    ).toBe("WeChat API error 40164: invalid ip not in whitelist");
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

  it("ignores media load ErrorEvents so they cannot replace publish toasts", () => {
    const image = document.createElement("img");
    const event = new ErrorEvent("error", {
      error: new Error("Failed to load"),
      message: "Failed to load",
    });
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
