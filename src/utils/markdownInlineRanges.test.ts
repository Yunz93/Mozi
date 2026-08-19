import { describe, expect, it } from "vitest";
import {
  collectMarkdownImageRanges,
  collectMarkdownLinkRanges,
} from "./markdownInlineRanges";

describe("markdownInlineRanges", () => {
  it("keeps a remote image destination that contains a space", () => {
    const doc =
      "![M 記](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1776170252301.png)";
    const [image] = collectMarkdownImageRanges(doc);
    expect(image).toBeDefined();
    expect(doc.slice(image!.from, image!.to)).toBe(doc);
    expect(image!.url).toBe(
      "https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1776170252301.png",
    );
    expect(doc.slice(image!.urlFrom, image!.urlTo)).toBe(image!.url);
  });

  it("keeps a local image destination after a leading space in the parens", () => {
    const doc = "![M 記]( 記-1776170252301.png)";
    const [image] = collectMarkdownImageRanges(doc);
    expect(image).toBeDefined();
    expect(image!.url).toBe("記-1776170252301.png");
    expect(doc.slice(image!.urlFrom, image!.urlTo)).toBe(
      "記-1776170252301.png",
    );
  });

  it("collects markdown links whose paths contain spaces", () => {
    const doc = "see [PRD](docs/完整 PRD.md) please";
    const [link] = collectMarkdownLinkRanges(doc);
    expect(link?.url).toBe("docs/完整 PRD.md");
    expect(link?.alt).toBe("PRD");
  });
});
