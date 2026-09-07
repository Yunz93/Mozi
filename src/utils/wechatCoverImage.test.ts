/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import {
  buildPastedCoverImageName,
  clipboardHasPlainText,
  getClipboardImageFile,
  shouldApplyPastedCoverImage,
} from "./wechatCoverImage";

function mockDataTransfer(options: {
  files?: File[];
  text?: string;
}): DataTransfer {
  const files = options.files ?? [];
  return {
    files: files as unknown as FileList,
    items: files.map((file) => ({
      type: file.type,
      getAsFile: () => file,
    })),
    getData: (type: string) =>
      type === "text/plain" ? (options.text ?? "") : "",
  } as unknown as DataTransfer;
}

describe("wechatCoverImage", () => {
  it("prefers an image file from the clipboard", () => {
    const image = new File(["x"], "shot.png", { type: "image/png" });
    expect(getClipboardImageFile(mockDataTransfer({ files: [image] }))).toBe(
      image,
    );
    expect(
      getClipboardImageFile(mockDataTransfer({ text: "hello" })),
    ).toBeNull();
  });

  it("uses a pasted image unless a text field is receiving plain text", () => {
    const image = new File(["x"], "shot.png", { type: "image/png" });
    const input = document.createElement("input");
    const cover = document.createElement("div");
    cover.setAttribute("data-wechat-cover-drop", "");

    expect(
      shouldApplyPastedCoverImage(mockDataTransfer({ files: [image] }), cover),
    ).toBe(true);
    expect(
      shouldApplyPastedCoverImage(mockDataTransfer({ files: [image] }), input),
    ).toBe(true);
    expect(
      shouldApplyPastedCoverImage(
        mockDataTransfer({ files: [image], text: "标题" }),
        input,
      ),
    ).toBe(false);
    expect(clipboardHasPlainText(mockDataTransfer({ text: "  标题  " }))).toBe(
      true,
    );
  });

  it("names pasted covers after the current note", () => {
    expect(
      buildPastedCoverImageName("/notes/发布说明.md", "image/jpeg", 123),
    ).toBe("发布说明-wechat-cover-123.jpg");
  });
});
