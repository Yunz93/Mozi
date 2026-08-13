import { describe, expect, it } from "vitest";
import {
  isExternalLink,
  isHtmlDocument,
  isImageAttachment,
  isMarkdownNote,
  isPdfAttachment,
  isValidExternalUrl,
} from "./previewUtils";

describe("previewUtils", () => {
  it("classifies attachment and document extensions", () => {
    expect(isImageAttachment("photo.webp")).toBe(true);
    expect(isMarkdownNote("note.markdown")).toBe(true);
    expect(isMarkdownNote("board.excalidraw.md")).toBe(false);
    expect(isPdfAttachment("paper.pdf")).toBe(true);
    expect(isHtmlDocument("page.HTML")).toBe(true);
  });

  it("detects external links and validates http(s) urls", () => {
    expect(isExternalLink("https://example.com")).toBe(true);
    expect(isExternalLink("mailto:hi@example.com")).toBe(true);
    expect(isExternalLink("../local/file.pdf")).toBe(false);
    expect(isValidExternalUrl("https://example.com/path")).toBe(true);
    expect(isValidExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isValidExternalUrl("not-a-url")).toBe(false);
  });
});
