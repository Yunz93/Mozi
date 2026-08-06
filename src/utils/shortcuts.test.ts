import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatShortcutForDisplay,
  uniqueFormattedShortcuts,
} from "./shortcuts";

describe("uniqueFormattedShortcuts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes Cmd/Ctrl aliases that collapse to the same display label on macOS", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Macintosh",
    });

    expect(
      uniqueFormattedShortcuts([
        "Cmd+-",
        "Ctrl+-",
        "Cmd+Shift+-",
        "Ctrl+Shift+-",
      ]),
    ).toEqual(["Cmd+-", "Cmd+Shift+-"]);
    expect(formatShortcutForDisplay("Ctrl+-")).toBe("Cmd+-");
  });

  it("dedupes Cmd/Ctrl aliases that collapse to the same display label on Windows", () => {
    vi.stubGlobal("navigator", {
      platform: "Win32",
      userAgent: "Windows",
    });

    expect(
      uniqueFormattedShortcuts([
        "Cmd+-",
        "Ctrl+-",
        "Cmd+Shift+0",
        "Ctrl+Shift+0",
      ]),
    ).toEqual(["Ctrl+-", "Ctrl+Shift+0"]);
  });

  it("keeps distinct chords such as zoom-in variants", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Macintosh",
    });

    expect(uniqueFormattedShortcuts(["Cmd+=", "Cmd+Shift+="])).toEqual([
      "Cmd+=",
      "Cmd+Shift+=",
    ]);
  });
});
