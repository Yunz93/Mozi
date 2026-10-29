/** @vitest-environment happy-dom */
import React, { useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  locked: false,
  blocker: undefined as
    | ((locked: boolean, reason?: "update" | "exit") => boolean)
    | undefined,
}));
vi.mock("../services/updateDocumentGuard", () => ({
  isUpdateInstallLocked: () => state.locked,
  registerUpdateInstallBlocker: (
    blocker: (locked: boolean, reason?: "update" | "exit") => boolean,
  ) => {
    state.blocker = blocker;
    return () => {
      state.blocker = undefined;
    };
  },
}));
vi.mock("../hooks/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === "toolbar_saving" ? "保存中..." : "正在安装更新...",
  }),
}));
import { UpdateInstallGuard } from "./UpdateInstallGuard";

beforeEach(() => {
  state.locked = false;
  state.blocker = undefined;
});
afterEach(cleanup);

describe("update installation input guard", () => {
  it("displays synchronously without requiring HTMLDialog.showModal and restores focus", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    render(<UpdateInstallGuard />);
    expect(state.blocker?.(true)).toBe(true);
    const overlay = screen.getByRole("dialog");
    expect(overlay.style.display).toBe("flex");
    expect(document.activeElement).toBe(overlay);
    state.blocker?.(false);
    expect(overlay.style.display).toBe("none");
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it.each([
    "keydown",
    "beforeinput",
    "paste",
    "cut",
    "pointerdown",
    "click",
    "drop",
    "dragover",
    "contextmenu",
  ])("blocks %s before global capture handlers while locked", (name) => {
    const globalHandler = vi.fn();
    function Harness() {
      useEffect(() => {
        window.addEventListener(name, globalHandler, true);
        return () => window.removeEventListener(name, globalHandler, true);
      }, []);
      return <UpdateInstallGuard />;
    }
    render(<Harness />);
    state.locked = true;
    state.blocker?.(true);
    const event = new Event(name, { bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(globalHandler).not.toHaveBeenCalled();
    state.locked = false;
    state.blocker?.(false);
    window.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
    expect(globalHandler).toHaveBeenCalledTimes(1);
  });
  it("uses saving copy for ordinary exit and installation copy for updates", () => {
    render(<UpdateInstallGuard />);
    state.blocker?.(true, "exit");
    expect(
      screen.getByRole("dialog", { name: "保存中..." }).textContent,
    ).toContain("保存中...");
    state.blocker?.(false);
    state.blocker?.(true, "update");
    expect(
      screen.getByRole("dialog", { name: "正在安装更新..." }).textContent,
    ).toContain("正在安装更新...");
  });
});
