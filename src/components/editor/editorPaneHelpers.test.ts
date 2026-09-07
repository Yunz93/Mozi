import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewMode } from "../../types";
import {
  findLocalImageAtPos,
  findWikiLinkNearPosition,
  isLivePreviewWidgetsEnabled,
  isMacPlatform,
  isPreviewModifierKey,
  isPreviewModifierPressed,
  isRemoteUrl,
  relocateImageMarkdown,
  shouldShowLiveSourceToggle,
} from "./editorPaneHelpers";

describe("editorPaneHelpers", () => {
  it("detects mac platforms from navigator-like objects", () => {
    expect(isMacPlatform({ platform: "MacIntel", userAgent: "Mozilla" })).toBe(
      true,
    );
    expect(isMacPlatform({ platform: "Win32", userAgent: "Mozilla" })).toBe(
      false,
    );
    expect(isMacPlatform({ platform: "Win32", userAgent: "" })).toBe(false);
  });

  it("falls back to global navigator when argument is undefined", () => {
    vi.stubGlobal("navigator", { platform: "Win32", userAgent: "" });
    expect(isMacPlatform(undefined)).toBe(false);
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "" });
    expect(isMacPlatform(undefined)).toBe(true);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("relocates image markdown near the original offset", () => {
    const original = "![cover](assets/photo.png)";
    const doc = `intro\n${original}\nmore`;
    const hint = doc.indexOf(original);
    expect(relocateImageMarkdown(doc, original, hint)).toBe(hint);
    expect(relocateImageMarkdown(`xx${doc}`, original, hint)).toBe(
      `xx${doc}`.indexOf(original),
    );
    expect(relocateImageMarkdown("no image here", original, 0)).toBe(-1);
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

  it("enables Live Preview widgets only in Live without source chrome", () => {
    expect(isLivePreviewWidgetsEnabled(ViewMode.LIVE, false)).toBe(true);
    expect(isLivePreviewWidgetsEnabled(ViewMode.LIVE, true)).toBe(false);
    expect(isLivePreviewWidgetsEnabled(ViewMode.PREVIEW, false)).toBe(false);
    expect(isLivePreviewWidgetsEnabled(ViewMode.PREVIEW, true)).toBe(false);
  });

  it("shows the source toggle only for markdown notes in Live", () => {
    expect(shouldShowLiveSourceToggle(ViewMode.LIVE, "/vault/note.md")).toBe(
      true,
    );
    expect(shouldShowLiveSourceToggle(ViewMode.PREVIEW, "/vault/note.md")).toBe(
      false,
    );
    expect(shouldShowLiveSourceToggle(ViewMode.LIVE, "/vault/scan.pdf")).toBe(
      false,
    );
    expect(
      shouldShowLiveSourceToggle(ViewMode.LIVE, "drawing.excalidraw.md"),
    ).toBe(false);
    expect(shouldShowLiveSourceToggle(ViewMode.LIVE, null)).toBe(false);
  });
});
