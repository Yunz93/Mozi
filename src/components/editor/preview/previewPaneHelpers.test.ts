import { describe, expect, it } from "vitest";
import { isExternalLink, isValidExternalUrl } from "./previewPaneHelpers";

describe("previewPaneHelpers external urls", () => {
  it("accepts mailto and tel as valid external urls", () => {
    expect(isExternalLink("mailto:hi@example.com")).toBe(true);
    expect(isExternalLink("tel:+8613800138000")).toBe(true);
    expect(isValidExternalUrl("mailto:hi@example.com")).toBe(true);
    expect(isValidExternalUrl("tel:+8613800138000")).toBe(true);
    expect(isValidExternalUrl("https://example.com")).toBe(true);
    expect(isValidExternalUrl("javascript:alert(1)")).toBe(false);
  });
});
