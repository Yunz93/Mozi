import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPlatformIdentifier,
  isMacOSPlatform,
  isWindowsPlatform,
} from "./platform";

describe("platform detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats Windows user agents as Windows only", () => {
    vi.stubGlobal("navigator", {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });

    expect(getPlatformIdentifier()).toContain("win");
    expect(isWindowsPlatform()).toBe(true);
    expect(isMacOSPlatform()).toBe(false);
  });

  it("treats macOS user agents as macOS only", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    expect(isMacOSPlatform()).toBe(true);
    expect(isWindowsPlatform()).toBe(false);
  });
});
