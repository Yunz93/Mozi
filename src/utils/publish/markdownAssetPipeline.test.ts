import { describe, expect, it } from "vitest";
import {
  isImageHostingConfigured,
  markdownHasLocalImages,
  shouldAbortSimpleBlogPublishForMissingHosting,
} from "./markdownAssetPipeline";

describe("markdownHasLocalImages", () => {
  it("识别标准 Markdown 本地图片", () => {
    expect(markdownHasLocalImages("![alt](./a.png)")).toBe(true);
  });

  it("识别 wiki 嵌入图片", () => {
    expect(markdownHasLocalImages("![[a.png]]")).toBe(true);
  });

  it("识别带空格路径", () => {
    expect(markdownHasLocalImages("![alt](./my image.png)")).toBe(true);
  });

  it("不处理 http(s) 链接", () => {
    expect(markdownHasLocalImages("![alt](https://example.com/a.png)")).toBe(
      false,
    );
    expect(markdownHasLocalImages("![alt](http://example.com/a.png)")).toBe(
      false,
    );
  });
});

describe("shouldAbortSimpleBlogPublishForMissingHosting", () => {
  it("未配置图床且含本地图片时不再中止", () => {
    expect(
      shouldAbortSimpleBlogPublishForMissingHosting({
        imageHostingConfigured: false,
        hasLocalImages: true,
      }),
    ).toBe(false);
    expect(
      isImageHostingConfigured({ imageHosting: { provider: "none" } }),
    ).toBe(false);
  });
});
