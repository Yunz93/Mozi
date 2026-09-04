import { describe, expect, it } from "vitest";
import {
  applySimpleBlogPublishInput,
  extractSimpleBlogPublishDefaults,
  prepareSimpleBlogPublish,
} from "./simpleBlogPublish";

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
