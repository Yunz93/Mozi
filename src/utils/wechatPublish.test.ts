// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  extractWechatDraftDefaults,
  prepareWechatDraftPublish,
} from "./wechatPublish";
import { clearMarkdownCache, renderMarkdown } from "./markdown";

describe("extractWechatDraftDefaults", () => {
  it("prefers frontmatter values when available", () => {
    const defaults = extractWechatDraftDefaults(
      `---
title: 自定义标题
author: 张三
digest: 自定义摘要
content_source_url: https://example.com/source
show_cover_pic: false
wechat_draft_media_id: MEDIA123
---

正文内容
`,
      "/tmp/post.md",
    );

    expect(defaults).toEqual({
      title: "自定义标题",
      author: "张三",
      digest: "自定义摘要",
      contentSourceUrl: "https://example.com/source",
      showCoverPic: false,
      existingDraftMediaId: "MEDIA123",
    });
  });

  it("falls back to file name and body excerpt", () => {
    const defaults = extractWechatDraftDefaults(
      `

第一段正文会被用来生成摘要。这里还有一些补充内容，保证摘要不是空字符串。

第二段内容。
`,
      "/notes/my-article.md",
    );

    expect(defaults.title).toBe("my-article");
    expect(defaults.author).toBe("");
    expect(defaults.digest).toContain("第一段正文会被用来生成摘要");
    expect(defaults.existingDraftMediaId).toBe("");
    expect(defaults.showCoverPic).toBe(true);
  });
});

describe("prepareWechatDraftPublish", () => {
  it("applies the selected markdown style preset to the prepared HTML", async () => {
    const prepared = await prepareWechatDraftPublish({
      files: [],
      currentFilePath: "/notes/styled-post.md",
      markdownContent: "# 标题\n\n> 引用\n\n`code`",
      settings: {
        previewFontFamily: "Arial",
        codeFontFamily: "Menlo",
        fontSize: 16,
        markdownStylePreset: "topaz",
      },
    });

    expect(prepared.contentHtml).toContain('data-markdown-style="topaz"');
    expect(prepared.contentHtml).toContain("color: #1f6f6d");
    expect(prepared.contentHtml).toContain("color: #255f5d");
  });

  it("keeps markdown links as WeChat-compatible hyperlinks", async () => {
    const prepared = await prepareWechatDraftPublish({
      files: [],
      currentFilePath: "/notes/link-post.md",
      markdownContent: "[OpenAI](https://openai.com/)",
      settings: {
        previewFontFamily: "Arial",
        codeFontFamily: "Menlo",
        fontSize: 16,
        markdownStylePreset: "nord",
      },
    });

    expect(prepared.contentHtml).toContain('href="https://openai.com/"');
    expect(prepared.contentHtml).toContain('target="_blank"');
    expect(prepared.contentHtml).toContain('data-linktype="2"');
    expect(prepared.contentHtml).toContain('linktype="text"');
    expect(prepared.contentHtml).toContain('tab="outerlink"');
    expect(prepared.contentHtml).toContain('textvalue="OpenAI"');
  });

  it("does not send preview-only blank-line markers to WeChat drafts", async () => {
    clearMarkdownCache();
    const markdownContent = [
      "引言",
      "",
      "- 第一项",
      "",
      "- 第二项",
      "",
      "结尾",
    ].join("\n");
    const settings = {
      previewFontFamily: "Arial",
      codeFontFamily: "Menlo",
      fontSize: 16,
      markdownStylePreset: "nord" as const,
    };

    expect(
      renderMarkdown(markdownContent, {
        themeMode: "light",
        markdownStylePreset: "nord",
      }),
    ).toContain("preview-source-blank-line");

    const prepared = await prepareWechatDraftPublish({
      files: [],
      currentFilePath: "/notes/list-post.md",
      markdownContent,
      settings,
    });

    expect(prepared.contentHtml).not.toContain("preview-source-blank-line");
    expect(prepared.contentHtml).not.toMatch(/<li[^>]*>\s*<\/li>/);
    expect(prepared.contentHtml).toContain("第一项");
    expect(prepared.contentHtml).toContain("第二项");
    expect(prepared.previewHtml).toContain("第一项");
    expect(prepared.previewHtml).not.toContain("preview-source-blank-line");
  });

  it("keeps local image paths in preview HTML and placeholders in publish HTML", async () => {
    const prepared = await prepareWechatDraftPublish({
      files: [
        {
          id: "/notes/cover.png",
          name: "cover.png",
          type: "file",
          path: "/notes/cover.png",
        },
      ],
      rootFolderPath: "/notes",
      currentFilePath: "/notes/post.md",
      markdownContent: "![封面](cover.png)",
      settings: {
        previewFontFamily: "Arial",
        codeFontFamily: "Menlo",
        fontSize: 16,
        markdownStylePreset: "nord",
      },
    });

    expect(prepared.imageAssets).toHaveLength(1);
    expect(prepared.contentHtml).toContain("__WECHAT_LOCAL_IMAGE_1__");
    expect(prepared.previewHtml).toContain("/notes/cover.png");
    expect(prepared.previewHtml).not.toContain("__WECHAT_LOCAL_IMAGE_1__");
    expect(prepared.unresolvedImages).toHaveLength(0);
  });
});
