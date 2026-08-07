import { describe, expect, it } from "vitest";
import {
  findLocalImageAtPos,
  findWikiLinkNearPosition,
  isMacPlatform,
  isPreviewModifierKey,
  isPreviewModifierPressed,
  isRemoteUrl,
} from "./editorPaneHelpers";

describe("editorPaneHelpers", () => {
  it("detects mac platforms from navigator-like objects", () => {
    expect(isMacPlatform({ platform: "MacIntel", userAgent: "Mozilla" })).toBe(
      true,
    );
    expect(isMacPlatform({ platform: "Win32", userAgent: "Mozilla" })).toBe(
      false,
    );
    expect(isMacPlatform(undefined)).toBe(false);
  });

  it("maps preview modifier keys by platform", () => {
    expect(
      isPreviewModifierPressed({ metaKey: true, ctrlKey: false }, true),
    ).toBe(true);
    expect(
      isPreviewModifierPressed({ metaKey: false, ctrlKey: true }, true),
    ).toBe(false);
    expect(
      isPreviewModifierPressed({ metaKey: false, ctrlKey: true }, false),
    ).toBe(true);
    expect(isPreviewModifierKey("Meta")).toBe(true);
    expect(isPreviewModifierKey("Control")).toBe(true);
    expect(isPreviewModifierKey("Alt")).toBe(false);
  });

  it("classifies remote image urls", () => {
    expect(isRemoteUrl("https://example.com/a.png")).toBe(true);
    expect(isRemoteUrl("data:image/png;base64,xx")).toBe(true);
    expect(isRemoteUrl("//cdn.example.com/a.png")).toBe(true);
    expect(isRemoteUrl("assets/photo.png")).toBe(false);
  });

  it("finds standard and obsidian local images under the caret", () => {
    const standard = "See ![cover](assets/photo.png) here";
    const imageStart = standard.indexOf("![");
    const standardHit = findLocalImageAtPos(10, standard, 10 + imageStart + 3);
    expect(standardHit).toMatchObject({
      src: "assets/photo.png",
      alt: "cover",
      from: 10 + imageStart,
      to: 10 + imageStart + "![cover](assets/photo.png)".length,
    });

    const wiki = "embed ![[lbxx.jpeg|图]] end";
    const wikiHit = findLocalImageAtPos(0, wiki, 12);
    expect(wikiHit).toMatchObject({
      src: "lbxx.jpeg",
      alt: "图",
    });

    expect(findLocalImageAtPos(0, "![r](https://x.com/a.png)", 4)).toBeNull();
    expect(findLocalImageAtPos(0, "plain text", 2)).toBeNull();
  });

  it("finds open wiki links near the caret with small offsets", () => {
    const text = "see [[01-Markdown-语法示例";
    const openAt = text.length;
    const hit = findWikiLinkNearPosition(text, openAt);
    expect(hit?.pathQuery).toContain("Markdown");
    // Off-by-one caret still resolves via nearby offsets.
    expect(findWikiLinkNearPosition(text, openAt - 1)?.pathQuery).toContain(
      "Markdown",
    );
  });
});
