import { describe, expect, it } from "vitest";
import { shouldApplyPublishWriteback } from "./usePublishActions";
import { shouldAbortSimpleBlogPublishForMissingHosting } from "../utils/publish/markdownAssetPipeline";

describe("shouldApplyPublishWriteback", () => {
  it("发布期间内容变化 → 不覆盖", () => {
    expect(shouldApplyPublishWriteback("edited by user", "snapshot")).toBe(
      false,
    );
    expect(shouldApplyPublishWriteback("snapshot", "snapshot")).toBe(true);
    expect(shouldApplyPublishWriteback(undefined, "snapshot")).toBe(false);
  });

  it("未配置图床 + 含本地图片 → 不再中止发布", () => {
    expect(
      shouldAbortSimpleBlogPublishForMissingHosting({
        imageHostingConfigured: false,
        hasLocalImages: true,
      }),
    ).toBe(false);
  });
});
