/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePropertiesDialog } from "./ImagePropertiesDialog";
import { useAppStore, defaultSettings } from "../../store/appStore";
import { collectMarkdownImageRanges } from "../../utils/markdownInlineRanges";
import { renderMarkdown } from "../../utils/markdown";

afterEach(cleanup);

it("修改尺寸时保留已有图片的悬停标题", () => {
  useAppStore.setState({ settings: { ...defaultSettings, language: "zh-CN" } });
  const onSave = vi.fn();
  render(
    <ImagePropertiesDialog
      image={{ src: "image.png", alt: "原图", from: 0, to: 30 }}
      original={'![原图](image.png "悬停提示")'}
      onClose={() => {}}
      onSave={onSave}
    />,
  );
  fireEvent.change(screen.getAllByRole("spinbutton")[0], {
    target: { value: "320" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "确定" }).closest("form")!,
  );
  const content = document.createElement("div");
  content.innerHTML = renderMarkdown(onSave.mock.calls[0][0]);
  expect(content.querySelector("img")?.getAttribute("title")).toBe("悬停提示");
  expect(content.querySelector("img")?.getAttribute("width")).toBe("320");
});

describe.each(["![原图](image.png)", "![[image.png|原图]]"])(
  "图片属性说明往返：%s",
  (original) => {
    it.each(["a[b", "[x]", String.raw`反斜杠\]`, "a|b"])(
      "保存 %s 后仍为同一张图片，Live 与 Markdown 读取到相同说明",
      (label) => {
        useAppStore.setState({
          settings: { ...defaultSettings, language: "zh-CN" },
        });
        const onSave = vi.fn();
        render(
          <ImagePropertiesDialog
            image={{ src: "image.png", alt: "原图", from: 0, to: 16 }}
            original={original}
            onClose={() => {}}
            onSave={onSave}
          />,
        );
        const fields = screen.getAllByRole("textbox");
        fireEvent.change(fields[1], { target: { value: label } });
        fireEvent.submit(fields[1].closest("form")!);
        expect(onSave).toHaveBeenCalledTimes(1);
        const markdown = onSave.mock.calls[0][0] as string;
        const content = document.createElement("div");
        content.innerHTML = renderMarkdown(markdown);
        expect(content.querySelector("img")?.getAttribute("alt")).toBe(label);
        expect(collectMarkdownImageRanges(markdown)[0]?.alt).toBe(label);
      },
    );
  },
);
