import { describe, expect, it, vi } from "vitest";
import {
  applySimpleBlogPublishInput,
  extractSimpleBlogPublishDefaults,
  prepareSimpleBlogPublish,
  ensureSimpleBlogPublishBinding,
  validateSimpleBlogPublishSource,
} from "./simpleBlogPublish";

describe("Simple Blog 发布归属", () => {
  it.each([
    ["https://github.com/example/blog", "git@github.com:example/blog.git"],
    ["git@github.com:Example/Blog.git", "https://github.com/example/blog"],
    ["example/blog", "https://github.com/EXAMPLE/BLOG"],
    ["github.com/example/blog", "git@github.com:EXAMPLE/BLOG.git"],
  ])(
    "同一仓库从 %s 改为 %s 后重发仍保留身份和远端路径",
    async (savedRepo, nextRepo) => {
      const path = "/vault/Note.md";
      const bound = ensureSimpleBlogPublishBinding(
        "---\nslug: existing-article\n---\n# Note",
        path,
        savedRepo,
      );
      const first = await prepareSimpleBlogPublish({
        files: [],
        currentFilePath: path,
        markdownContent: bound,
      });
      const rebound = ensureSimpleBlogPublishBinding(bound, path, nextRepo);
      const second = await prepareSimpleBlogPublish({
        files: [],
        currentFilePath: path,
        markdownContent: rebound,
      });
      expect(second.publishId).toBe(first.publishId);
      expect(second.postRelativePath).toBe(first.postRelativePath);
      expect(second.assetDirectoryRelativePath).toBe(
        first.assetDirectoryRelativePath,
      );
      expect(rebound).toBe(bound);
    },
  );

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

describe("发布身份的本地副本保护", () => {
  const repo = "https://github.com/example/blog";
  const site = "https://example.com";
  const note = (path: string) => ({
    id: path,
    name: path.split("/").at(-1)!,
    path,
    type: "file" as const,
  });
  const bound = () =>
    ensureSimpleBlogPublishBinding(
      "# Original",
      "/vault/Original.md",
      repo,
      site,
    );
  it.each([
    ["git@github.com:example/blog.git", repo],
    ["example/blog", repo],
    [repo, "git@github.com:EXAMPLE/BLOG.git"],
    [repo, "github.com/Example/Blog"],
  ])(
    "当前仓库 %s 与候选绑定 %s 为同一仓库时仍拒绝副本",
    async (currentRepo, candidateRepo) => {
      const content = bound();
      const candidate = content.replace(repo, candidateRepo);
      await expect(
        validateSimpleBlogPublishSource(
          content,
          "/vault/Copy.md",
          [note("/vault/Original.md"), note("/vault/Copy.md")],
          async () => candidate,
          currentRepo,
          site,
        ),
      ).rejects.toThrow("publishing association");
    },
  );
  it("真正切换到其他仓库时不把原仓库的副本当作关联冲突", async () => {
    const content = bound();
    const read = vi.fn(async () => content);
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Copy.md",
        [note("/vault/Original.md")],
        read,
        "git@github.com:example/other.git",
        site,
      ),
    ).resolves.toBe(content);
    expect(read).not.toHaveBeenCalled();
  });
  it("复制已发布笔记后不能接管仍存在的原文", async () => {
    const content = bound();
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Copy.md",
        [note("/vault/Original.md"), note("/vault/Copy.md")],
        async () => content,
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
  });
  it("原文已改名但尚未重发，副本仍不能借旧来源路径绕过检查", async () => {
    const content = bound();
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Copy.md",
        [note("/vault/Renamed.md"), note("/vault/Copy.md")],
        async () => content,
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
  });
  it("真正移动改名保留归属，正常更新只读取候选头而不读完整正文", async () => {
    const content = bound();
    const read = vi.fn(async () => "# Unrelated");
    const moved = await validateSimpleBlogPublishSource(
      content,
      "/vault/Moved.md",
      [note("/vault/Moved.md"), note("/vault/Other.md")],
      read,
      repo,
      site,
    );
    expect(moved).toBe(content);
    expect(read).toHaveBeenCalledExactlyOnceWith("/vault/Other.md");
    read.mockClear();
    expect(
      await validateSimpleBlogPublishSource(
        moved,
        "/vault/Moved.md",
        [note("/vault/Other.md")],
        read,
        repo,
        site,
      ),
    ).toBe(moved);
    expect(read).toHaveBeenCalledExactlyOnceWith("/vault/Other.md");
  });
  it("原文移动后副本回填旧路径仍不能覆盖原文", async () => {
    const content = bound();
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Original.md",
        [note("/vault/Original.md"), note("/vault/Moved.md")],
        async () => content,
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
  });
  it("不相关的空元数据或标量不阻止发布，损坏的元数据仍拒绝猜测", async () => {
    const content = bound();
    const files = [note("/vault/Other.md")];
    for (const header of [
      "---\n---\n",
      "---\nnull\n---\n",
      "---\nhello\n---\n",
      "---\n- item\n---\n",
    ]) {
      expect(
        await validateSimpleBlogPublishSource(
          content,
          "/vault/Original.md",
          files,
          async () => header,
          repo,
          site,
        ),
      ).toBe(content);
    }
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Original.md",
        files,
        async () => "---\nvalue: [\n---\n",
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
  });
  it("无UUID的旧版已发布笔记也拒绝重复迁移声明", async () => {
    const content =
      "---\nis_publish: true\nslug: original\nlink: https://example.com/posts/original/\n---\n# Legacy";
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/copy/Original.md",
        [note("/vault/Original.md")],
        async () => content,
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
  });
  it("缺失来源标记的旧UUID绑定会先检查副本，读取失败或头未闭合时拒绝猜测", async () => {
    const content = bound();
    const files = [note("/vault/Other.md")];
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Original.md",
        files,
        async () => content,
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Original.md",
        files,
        async () => "---\n" + "x".repeat(65536),
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
    await expect(
      validateSimpleBlogPublishSource(
        content,
        "/vault/Original.md",
        files,
        async () => {
          throw new Error("denied");
        },
        repo,
        site,
      ),
    ).rejects.toThrow("publishing association");
  });
});
