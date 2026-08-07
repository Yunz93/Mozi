import { describe, expect, it } from "vitest";
import { classifyWindowLabel, isPrimaryAppWindow } from "./appWindow";

describe("appWindow", () => {
  it("classifies primary and secondary window labels", () => {
    expect(classifyWindowLabel("main")).toBe("main");
    expect(classifyWindowLabel("file-123-uuid")).toBe("file");
    expect(classifyWindowLabel("win-123-uuid")).toBe("window");
    expect(classifyWindowLabel("unknown")).toBe("other");
    expect(isPrimaryAppWindow("main")).toBe(true);
    expect(isPrimaryAppWindow("file-1")).toBe(false);
  });
});
