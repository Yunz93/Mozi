import { describe, expect, it } from "vitest";
import {
  applySimpleBlogPublishInput,
  extractSimpleBlogPublishDefaults,
  prepareSimpleBlogPublish,
  ensureSimpleBlogPublishBinding,
} from "./simpleBlogPublish";

describe("Simple Blog 发布归属", () => {
  it("不同目录同名新笔记使用不同远端正文和资源路径", async () => {
    const first = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/vault/work/Notes.md",
      markdownContent: "# Work",
    });
    const second = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/vault/personal/Notes.md",
      markdownContent: "# Personal",
    });
    expect(first.postRelativePath).not.toBe(second.postRelativePath);
    expect(first.assetDirectoryRelativePath).not.toBe(
      second.assetDirectoryRelativePath,
    );
  });

  it("记录发布身份后改名仍更新同一远端文章，切换仓库则建立新归属", async () => {
    const bound = ensureSimpleBlogPublishBinding(
      "# Note",
      "/vault/Note.md",
      "https://github.com/example/blog",
      "https://example.com",
    );
    const first = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/vault/Note.md",
      markdownContent: bound,
    });
    const moved = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/vault/folder/Renamed.md",
      markdownContent: first.markdownContent,
    });
    expect(moved.postRelativePath).toBe(first.postRelativePath);
    const other = ensureSimpleBlogPublishBinding(
      bound,
      "/vault/Note.md",
      "https://github.com/example/other",
      "https://other.example.com",
    );
    const otherPrepared = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/vault/Note.md",
      markdownContent: other,
    });
    expect(otherPrepared.postRelativePath).not.toBe(first.postRelativePath);
  });

  it("既有已发布文章保留旧目标并携带原slug进行首次归属校验", async () => {
    const bound = ensureSimpleBlogPublishBinding(
      "---\nis_publish: true\nslug: existing-note\nlink: https://example.com/posts/existing-note/\n---\n# Note",
      "/vault/Note.md",
      "https://github.com/example/blog",
      "https://example.com",
    );
    const prepared = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/vault/Note.md",
      markdownContent: bound,
    });
    expect(prepared.postRelativePath).toBe("posts/Note.md");
    expect(prepared.legacySlug).toBe("existing-note");
    expect(prepared.publishId).toMatch(/^[a-f0-9-]{36}$/);
    const restored = ensureSimpleBlogPublishBinding(
      bound,
      "/vault/Original.md",
      "https://github.com/example/blog",
      "https://example.com",
    );
    const restoredPrepared = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/vault/Original.md",
      markdownContent: restored,
    });
    expect(restoredPrepared.postRelativePath).toBe("posts/Original.md");
    expect(restoredPrepared.publishId).toBe(prepared.publishId);
  });
});

describe("prepareSimpleBlogPublish", () => {
  it("writes the selected markdown style preset into published frontmatter", async () => {
    const prepared = await prepareSimpleBlogPublish({
      files: [],
      currentFilePath: "/notes/styled-post.md",
      markdownContent: `---
title: Styled Post
---

正文`,
      markdownStylePreset: "topaz",
    });

    expect(prepared.markdownContent).toContain("markdown_style: topaz");
  });
});

describe("extractSimpleBlogPublishDefaults", () => {
  it("新笔记的同名默认URL在确认前已按文档路径区分，反复打开保持稳定", () => {
    const first = extractSimpleBlogPublishDefaults(
      "# Work",
      "/vault/work/Notes.md",
    );
    const second = extractSimpleBlogPublishDefaults(
      "# Personal",
      "/vault/personal/Notes.md",
    );
    expect(first.slug).not.toBe(second.slug);
    expect(first.slug).toMatch(/^Notes-[a-f0-9]{16}$/);
    expect(
      extractSimpleBlogPublishDefaults("# Later edits", "/vault/work/Notes.md")
        .slug,
    ).toBe(first.slug);
  });

  it("不改变用户显式设置的URL和既有已发布文章的默认URL", () => {
    expect(
      extractSimpleBlogPublishDefaults(
        "---\nslug: chosen-url\n---\nbody",
        "/vault/Notes.md",
      ).slug,
    ).toBe("chosen-url");
    expect(
      extractSimpleBlogPublishDefaults(
        "---\nis_publish: true\n---\nbody",
        "/vault/Notes.md",
      ).slug,
    ).toBe("Notes");
    expect(
      extractSimpleBlogPublishDefaults(
        "---\nlink: https://example.com/posts/Notes/\n---\nbody",
        "/vault/Notes.md",
      ).slug,
    ).toBe("Notes");
  });

  it("提交后使用用户确认的URL，不在准备发布时偷偷替换", async () => {
    const defaults = extractSimpleBlogPublishDefaults(
      "# Work",
      "/vault/work/Notes.md",
    );
    for (const slug of [defaults.slug, "my-explicit-choice"]) {
      const content = applySimpleBlogPublishInput("# Work", {
        title: defaults.title,
        aliases: defaults.aliases,
        slug,
      });
      const prepared = await prepareSimpleBlogPublish({
        files: [],
        currentFilePath: "/vault/work/Notes.md",
        markdownContent: content,
      });
      expect(
        extractSimpleBlogPublishDefaults(
          prepared.markdownContent,
          "/vault/work/Notes.md",
        ).slug,
      ).toBe(slug);
    }
  });

  it("prefills article metadata from frontmatter", () => {
    const defaults = extractSimpleBlogPublishDefaults(
      `---
title: Hello World
slug: hello
aliases:
  - hi
---

body`,
      "/notes/hello-world.md",
    );

    expect(defaults).toEqual({
      title: "Hello World",
      slug: "hello",
      aliases: "hi",
    });
  });
});

describe("prepareSimpleBlogPublish local images", () => {
  it("rewrites local markdown and wiki images, leaves http(s) links", async () => {
    const prepared = await prepareSimpleBlogPublish({
      files: [
        {
          id: "img-a",
          name: "a.png",
          type: "file",
          path: "/notes/a.png",
        },
        {
          id: "img-space",
          name: "my pic.png",
          type: "file",
          path: "/notes/my pic.png",
        },
      ],
      currentFilePath: "/notes/post.md",
      rootFolderPath: "/notes",
      markdownContent: `---
title: Images
---

![alt](./a.png)
![[a.png]]
![space](./my pic.png)
![remote](https://example.com/x.png)
`,
    });

    expect(prepared.assets.length).toBeGreaterThanOrEqual(2);
    expect(prepared.markdownContent).toMatch(
      /!\[alt\]\(\/resource\/.+a\.png\)/,
    );
    expect(prepared.markdownContent).toContain("https://example.com/x.png");
    expect(prepared.markdownContent).not.toContain("](./a.png)");
    expect(prepared.markdownContent).not.toContain("![[a.png]]");
  });
});

describe("applySimpleBlogPublishInput", () => {
  it("writes title slug aliases and clears empty slug", () => {
    const next = applySimpleBlogPublishInput(
      `---
title: Old
slug: old-slug
---

body`,
      {
        title: "New Title",
        slug: "",
        aliases: "a, b",
      },
    );

    expect(next).toContain("title: New Title");
    expect(next).toContain("aliases:");
    expect(next).toContain("- a");
    expect(next).toContain("- b");
    expect(next).not.toContain("slug:");
  });
});
