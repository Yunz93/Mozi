import { describe, expect, it } from "vitest";
import { classifyExportError } from "./exportErrors";

describe("classifyExportError", () => {
  it("detects timeouts", () => {
    expect(
      classifyExportError("PDF export timed out while preparing HTML"),
    ).toBe("timeout");
  });

  it("detects empty canvases", () => {
    expect(classifyExportError("Export produced an empty blob")).toBe(
      "emptyBlob",
    );
  });

  it("detects size/memory failures", () => {
    expect(classifyExportError("Canvas exceeds max canvas dimension")).toBe(
      "tooLarge",
    );
  });

  it("falls back to generic", () => {
    expect(classifyExportError("something else")).toBe("generic");
  });
});
