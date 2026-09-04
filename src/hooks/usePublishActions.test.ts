import { describe, expect, it } from "vitest";
import { shouldApplyPublishWriteback } from "./usePublishActions";

describe("shouldApplyPublishWriteback", () => {
  it("发布期间内容变化 → 不覆盖", () => {
    expect(shouldApplyPublishWriteback("edited by user", "snapshot")).toBe(
      false,
    );
    expect(shouldApplyPublishWriteback("snapshot", "snapshot")).toBe(true);
    expect(shouldApplyPublishWriteback(undefined, "snapshot")).toBe(false);
  });
});
