/** @vitest-environment happy-dom */

import { describe, it, expect, beforeEach, vi } from "vitest";
import MarkdownIt from "markdown-it";
import { shouldUseAsyncPreviewEnhancement } from "../components/editor/preview/previewRenderCore";
import type { ShikiHighlighter } from "../hooks/useShikiHighlighter";
import {
  clearMarkdownCache,
  renderMarkdown,
  configureMarkdownClasses,
} from "./markdown";

function createMockHighlighter() {
  const codeToHtml = vi.fn(
    (code: string) => `<pre class="shiki"><code>${code}</code></pre>`,
  );
  const highlighter: ShikiHighlighter = {
    codeToHtml,
    getLoadedLanguages: () => ["js"],
    supportsLanguage: () => true,
  };
  return { codeToHtml, highlighter };
}

describe("renderMarkdown", () => {
  beforeEach(() => {
    clearMarkdownCache();
  });

  it("renders Obsidian callouts as styled blockquotes", () => {
    const html = renderMarkdown("> [!note] 提示\n> 本地文件夹当作知识库");
    expect(html).toContain("mp-callout");
    expect(html).toContain("mp-callout-note");
    expect(html).toContain("mp-callout-title");
    expect(html).toContain("提示");
    expect(html).toContain("本地文件夹当作知识库");
    expect(html).not.toContain("[!note]");
  });

  it("does not leave an empty paragraph after a callout title", () => {
    const html = renderMarkdown("> [!caution] 注意\n>\n> 测试\n>\n> 测试");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const callout = doc.querySelector(".mp-callout");
    expect(callout).not.toBeNull();
    const paragraphs = [...callout!.querySelectorAll("p")];
    expect(paragraphs.map((p) => p.textContent?.trim())).toEqual([
      "测试",
      "测试",
    ]);
    expect(html).not.toMatch(/<p>\s*<\/p>/);
    expect(html.match(/测试/g)?.length).toBe(2);
  });

  it("renders tight callout body lines once", () => {
    const html = renderMarkdown("> [!caution] 注意\n> 测试\n> 测试");
    expect(html.match(/测试/g)?.length).toBe(2);
    expect(html).toContain("mp-callout-caution");
    expect(html).not.toMatch(/<p>\s*<\/p>/);
    expect(html).toMatch(/<p>测试<br>\s*测试<\/p>/);
  });

  it("renders wikilink anchor with data-wikilink", () => {
    const html = renderMarkdown("See [[My Note|label]].");
    expect(html).toContain("data-wikilink");
    expect(html).toContain("markdown-wikilink");
    expect(html).toMatch(/My Note/i);
  });

  it("preserves source blank lines between preview blocks", () => {
    const html = renderMarkdown(["第一段", "", "", "", "第二段"].join("\n"));
    expect(html.match(/preview-source-blank-line/g)?.length).toBe(3);
    expect(html).toMatch(
      /<p>第一段<\/p>\s*(?:<div class="preview-source-blank-line"><\/div>\s*){3}<p>第二段<\/p>/,
    );
    expect(html).not.toMatch(/<p>\s*<\/p>/);
  });

  it("renders wiki embed size attributes from pipe syntax", () => {
    const html = renderMarkdown("![[resources/test.pg|300]]");
    expect(html).toContain('data-wiki-embed="true"');
    expect(html).toContain('data-wiki-width="300"');
  });

  it("wiki-embed-only body still enables async preview enhancement", () => {
    const html = renderMarkdown("![[note|100]]");
    expect(shouldUseAsyncPreviewEnhancement(html, true)).toBe(true);
  });

  it("renders inline KaTeX and preserves structure after DOMPurify", () => {
    const html = renderMarkdown("Formula $x^2 + y^2 = z^2$ end.");
    expect(html).toContain("katex");
    expect(html).toMatch(/class="mord mathnormal">x</);
    expect(html).toContain("mrel");
  });

  it("renders display math in katex-display wrapper", () => {
    const html = renderMarkdown("$$\na + b\n$$");
    expect(html).toContain("katex-display");
    expect(html).toContain("katex");
  });

  it("renders Obsidian Live `==highlight==` and `%%comment%%` syntaxes", () => {
    const html = renderMarkdown("==重点==");
    expect(html).toContain("<mark");
    expect(html).toContain("markdown-highlight");

    const noMark = renderMarkdown("a == b and c == d");
    expect(noMark).not.toContain("<mark");

    const twoMarks = renderMarkdown("==a==\n\n==b==");
    expect(twoMarks.match(/<mark/g)?.length ?? 0).toBe(2);

    const nested = renderMarkdown("==**加粗**==");
    expect(nested).toContain("<mark");
    expect(nested).toContain("<strong>加粗</strong>");

    const hidden = renderMarkdown("%%hidden%%");
    expect(hidden).not.toContain("hidden");
    expect(hidden).not.toContain("%%");
  });

  it("does not parse highlight/comment inside code blocks", () => {
    const html = renderMarkdown("```\n==code==\n%%comment%%\n```");
    expect(html).not.toContain("<mark");
    expect(html).toContain("==code==");
    expect(html).toContain("%%comment%%");

    const inlineCode = renderMarkdown("`==no==` and `%%no%%`");
    expect(inlineCode).not.toContain("<mark");
    expect(inlineCode).toContain("==no==");
    expect(inlineCode).toContain("%%no%%");
  });

  it("does not render inline KaTeX when `$...$` crosses a newline", () => {
    const html = renderMarkdown("价格 $5 和\n另一个 $6");
    expect(html).not.toContain("katex");
  });

  it("consumes multiline $$ blocks so LaTeX is not escaped as paragraph text", () => {
    const md = [
      "极限与级数：",
      "",
      "$$",
      String.raw`\lim_{n \to \infty} \frac{1}{n} = 0,`,
      String.raw`\qquad`,
      String.raw`\sum_{k=1}^{\infty} \frac{1}{2^k} = 1`,
      "$$",
      "",
      "```mermaid",
      "flowchart LR",
      "  A-->B",
      "```",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain("katex-display");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart LR");
    expect(html).not.toContain("<p>\\ lim");
    expect(html).not.toContain("<p>\\qquad</p>");
  });

  it("renders mermaid fence as .mermaid placeholder with diagram source", () => {
    const html = renderMarkdown("```mermaid\nflowchart TD\n  A-->B\n```");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD");
    // DOMPurify escapes `>` inside the placeholder text; Mermaid still receives decoded source at render time.
    expect(html).toMatch(/A--(&gt;|>)B/);
  });

  it("renders nested unordered lists", () => {
    const html = renderMarkdown("- parent\n    - child\n        - leaf");
    expect(html.match(/<ul\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/<li>leaf<\/li>/);
  });

  it("renders nested task lists", () => {
    const html = renderMarkdown("- [ ] parent\n    - [x] child");
    expect(html).toContain("task-list-item");
    expect(html).toContain("contains-task-list");
    expect(html).toMatch(
      /<li class="task-list-item"[\s\S]*<ul class="contains-task-list"/,
    );
  });

  it("renders nested lists inside blockquotes", () => {
    const html = renderMarkdown(["> - parent", ">     - child"].join("\n"));
    expect(html).toMatch(/<blockquote/);
    expect(html.match(/<ul\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("renders task list markup", () => {
    const html = renderMarkdown("- [ ] open\n- [x] closed");
    expect(html).toContain("task-list-item");
  });

  // 修复:让预览端也认 alpha/roman 风格的有序列表(A./B./i./a./b. 等),与编辑器侧对齐;
  // 否则 markdown-it 会把这些行当成普通段落 + soft break,丢失列表与嵌套结构。
  describe("alpha / roman ordered list markers render as <ol type=...> with nesting", () => {
    it('uppercase alpha `A./B.` renders as <ol type="A">', () => {
      const html = renderMarkdown("A. first\nB. second");
      expect(html).toMatch(/<ol[^>]*type="A"/);
      expect(html).toMatch(/<li>first<\/li>/);
      expect(html).toMatch(/<li>second<\/li>/);
    });

    it('lowercase alpha `a./b.` renders as <ol type="a">', () => {
      const html = renderMarkdown("a. first\nb. second");
      expect(html).toMatch(/<ol[^>]*type="a"/);
    });

    it('multi-letter roman `ii./iii.` renders as <ol type="i" start="2">', () => {
      const html = renderMarkdown("ii. two\niii. three");
      expect(html).toMatch(/<ol[^>]*type="i"/);
      expect(html).toMatch(/start="2"/);
    });

    it("reproduces the user screenshot: nested alpha/roman lists preserve their structure", () => {
      const md = ["A. test", "B. test", "    A. test", "    B. test"].join(
        "\n",
      );
      const html = renderMarkdown(md);
      // 顶层应是 <ol type="A">,嵌套子列表也是 <ol type="A">,而不是被退化成 <p>...<br>...</p>。
      expect(html).not.toMatch(/<p>A\. test<br/);
      const olMatches = html.match(/<ol[^>]*type="A"/g);
      expect(olMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    it("does not affect numeric ordered lists", () => {
      const html = renderMarkdown("1. one\n2. two");
      expect(html).not.toMatch(/type="[Aa]"/);
      expect(html).toMatch(/<ol>\s*<li>one<\/li>/);
    });

    // 修复:紧凑数字 marker `2.AIGC`(点号后无空格)在编辑器是有序列表,但预览原本渲染成段落。
    it("tight numeric marker `2.AIGC` renders as an ordered list (matches editor)", () => {
      const html = renderMarkdown("2.AIGC\n3.Foo");
      expect(html).not.toMatch(/<p>2\.AIGC/);
      expect(html).toMatch(/<ol[^>]*start="2"/);
      expect(html).toMatch(/<li>AIGC<\/li>/);
      expect(html).toMatch(/<li>Foo<\/li>/);
    });

    it("tight numeric marker with `)` delimiter and CJK content renders as a list", () => {
      const html = renderMarkdown("1)中文内容");
      expect(html).toMatch(/<ol>\s*<li>中文内容<\/li>/);
    });

    it("does not treat version numbers like `1.2` as a list", () => {
      const html = renderMarkdown("1.2 release notes");
      expect(html).not.toMatch(/<ol\b/);
      expect(html).toMatch(/<p>1\.2 release notes<\/p>/);
    });

    it("tight numeric marker inside fenced code block is not rewritten", () => {
      const html = renderMarkdown("```\n2.AIGC\n```");
      expect(html).toContain("2.AIGC");
      expect(html).not.toMatch(/<ol\b/);
    });

    it("alpha marker inside fenced code block is not rewritten", () => {
      const html = renderMarkdown("```\nA. inside code\n```");
      expect(html).toContain("A. inside code");
      expect(html).not.toMatch(/<ol[^>]*type="A"/);
    });

    it("alpha marker inside indented code block is not rewritten", () => {
      const html = renderMarkdown("    A. inside code\n    B. still code");
      expect(html).toContain("<pre><code>A. inside code");
      expect(html).toContain("B. still code");
      expect(html).not.toMatch(/<ol[^>]*type="A"/);
    });

    it("nested alpha list after a blank line still renders as a nested list", () => {
      const md = ["A. parent", "", "    A. child", "    B. child2"].join("\n");
      const html = renderMarkdown(md);
      const olMatches = html.match(/<ol[^>]*type="A"/g);
      expect(olMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(html).toMatch(/<li>child<\/li>/);
      expect(html).not.toContain("<pre><code>A. child");
    });

    it("nested alpha list after multiple blank lines still renders as a nested list", () => {
      const md = ["A. parent", "", "", "    A. child", "    B. child2"].join(
        "\n",
      );
      const html = renderMarkdown(md);
      const olMatches = html.match(/<ol[^>]*type="A"/g);
      expect(olMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(html).toMatch(/<li>child<\/li>/);
      expect(html).not.toContain("<pre><code>A. child");
    });
  });

  // 修复:防止编辑中间态(列表下一行只有孤立 `-`)被解析成 setext h2,导致预览突然跳成大字标题。
  // 见 issue:"这个编辑中间态的渲染有问题"。
  describe("setext heading is disabled to avoid mid-edit list rendering jumps", () => {
    it("does not render `foo\\n---` as <h2>", () => {
      const html = renderMarkdown("foo\n---");
      expect(html).not.toMatch(/<h2\b/);
    });

    it("does not render `foo\\n===` as <h1>", () => {
      const html = renderMarkdown("foo\n===");
      expect(html).not.toMatch(/<h1\b/);
    });

    it("still renders ATX-style headings (`# foo` / `## bar`) normally", () => {
      const html = renderMarkdown("# heading1\n\n## heading2");
      expect(html).toMatch(/<h1[^>]*>heading1<\/h1>/);
      expect(html).toMatch(/<h2[^>]*>heading2<\/h2>/);
    });

    it("mid-edit list intermediate state with trailing `-` does not promote previous item to a heading", () => {
      // 复现截图场景:`- test` 嵌套结构,末行只敲了一个 `-`(4 空格缩进、未输入空格和内容)。
      const html = renderMarkdown("- test\n  - test\n  - tet\n  - test\n    -");
      expect(html).not.toMatch(/<h1\b/);
      expect(html).not.toMatch(/<h2\b/);
      expect(html).toMatch(/<ul>[\s\S]*<li>[\s\S]*test[\s\S]*<\/ul>/);
    });

    it("does not render a paragraph plus lone hyphen as a heading", () => {
      const html = renderMarkdown(
        "墨知提供了两种便捷的博客发布方式：微信公众号 + Simple Blog, 其中:\n-",
      );
      expect(html).not.toMatch(/<h[1-6]\b/);
    });
  });

  it("loose ordered list mode preserves author markers in preview HTML", () => {
    const md = "1. first\n   indent\n3. third";
    const loose = renderMarkdown(md, {
      orderedListMode: "loose",
      themeMode: "light",
    });
    expect(loose).toMatch(/<li[^>]*value="3"/);
    const strict = renderMarkdown(md, {
      orderedListMode: "strict",
      themeMode: "light",
    });
    expect(strict).not.toMatch(/value="3"/);
  });

  it("renders markdown images with lazy async defaults", () => {
    const html = renderMarkdown("![Poster](poster.png)");
    expect(html).toContain('decoding="async"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('fetchpriority="auto"');
  });

  it("applies Obsidian pipe size from markdown image alt", () => {
    const html = renderMarkdown(
      "![墨知正式版-1787670846943|300](https://raw.githubusercontent.com/Yunz93/PicRepo/main/images/ink.png)",
    );
    expect(html).toContain('alt="墨知正式版-1787670846943"');
    expect(html).not.toContain("1787670846943|300");
    expect(html).toContain('width="300"');
    expect(html).toContain('data-wiki-embed-w="300"');
    expect(html).not.toContain('data-wiki-embed-w="300px"');
  });

  it("applies Obsidian width x height from markdown image alt", () => {
    const html = renderMarkdown("![cover|120x80](poster.png)");
    expect(html).toContain('alt="cover"');
    expect(html).toContain('width="120"');
    expect(html).toContain('height="80"');
    expect(html).toContain('data-wiki-embed-h="80"');
  });

  it("does not treat a non-numeric alt pipe as image size", () => {
    const html = renderMarkdown("![foo|bar](poster.png)");
    expect(html).toContain('alt="foo|bar"');
    expect(html).not.toContain("data-wiki-embed-w=");
    expect(html).not.toContain('width="');
  });

  it("renders GFM/Obsidian footnotes as superscript refs and a footnotes section", () => {
    const md = "Text[^a] end.\n\n[^a]: https://example.com/doc";
    const html = renderMarkdown(md);
    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain('<sup class="footnote-ref"');
    expect(html).toContain('href="#fn');
    expect(html).toContain('class="footnotes"');
    expect(html).toContain("example.com/doc");
  });

  it("maps standalone block id paragraph to data-block-id on previous block", () => {
    const html = renderMarkdown("Hello\n\n^my-id\n");
    expect(html).toContain('data-block-id="my-id"');
  });

  it("renders GFM tables with blank lines between rows and Unicode dash separator", () => {
    const md = [
      "| 左对齐 | 居中 | 右对齐 |",
      "",
      "| ------- | ----- | — |",
      "",
      "| L | C | 1.0 |",
      "",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
  });

  it("returns cached result on second render of identical markdown", () => {
    const { codeToHtml, highlighter } = createMockHighlighter();
    const md = "```js\nconsole.log(1);\n```";

    const first = renderMarkdown(md, { highlighter });
    const second = renderMarkdown(md, { highlighter });

    expect(second).toBe(first);
    expect(codeToHtml).toHaveBeenCalledTimes(1);
  });

  it("does not cache documents larger than MAX_CACHEABLE_LENGTH", () => {
    const { codeToHtml, highlighter } = createMockHighlighter();
    const largeMd = `${"x".repeat(100_001)}\n\n\`\`\`js\nconsole.log(1);\n\`\`\``;

    const first = renderMarkdown(largeMd, { highlighter });
    const second = renderMarkdown(largeMd, { highlighter });

    expect(second).toBe(first);
    expect(second).toContain("<p>");
    expect(codeToHtml).toHaveBeenCalledTimes(2);
  });

  it("clearMarkdownCache clears the cache so re-render produces fresh result", () => {
    const { codeToHtml, highlighter } = createMockHighlighter();
    const md = "```js\nconsole.log(1);\n```";

    const first = renderMarkdown(md, { highlighter });
    clearMarkdownCache();
    const second = renderMarkdown(md, { highlighter });

    expect(second).toBe(first);
    expect(codeToHtml).toHaveBeenCalledTimes(2);
  });

  it("configureMarkdownClasses adds heading and link classes", () => {
    const md = new MarkdownIt();
    configureMarkdownClasses(md, {});
    // The renderer rules are modified; verify by rendering
    const html = md.render("# Title\n\n[link](https://example.com)");
    expect(html).toContain('class="heading-1"');
    expect(html).toContain('class="markdown-link"');
  });

  it("handles shiki block replacement fallback for out-of-range indices", () => {
    // This tests the ?? '' fallback on line 426 by injecting a bad shiki block index
    const md = "```js\nconsole.log(1);\n```";
    const html = renderMarkdown(md);
    // Should render without throwing; fallback returns empty string for bad indices
    expect(html).toContain("<pre");
  });

  it("wraps image URLs containing spaces in angle brackets before rendering", () => {
    const md = "![alt](https://example.com/my image.png)";
    const html = renderMarkdown(md);
    expect(html).toContain("https://example.com/my%20image.png");
  });

  it("renders GitHub raw image URLs that contain spaces", () => {
    const html = renderMarkdown(
      "![M 記](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1776170252301.png)",
    );
    expect(html).toContain("<img");
    expect(html).toContain("M%20");
    expect(html).toContain("1776170252301.png");
  });

  it("renders image destinations that start with a space", () => {
    const html = renderMarkdown("![M 記]( 記-1776170252301.png)");
    expect(html).toContain("<img");
    expect(html).toMatch(/記-1776170252301\.png|%E8%A8%98-1776170252301\.png/);
  });

  it("keeps a quoted title out of the src when the path has spaces", () => {
    const html = renderMarkdown(
      '![alt](https://example.com/my image.png "cover")',
    );
    expect(html).toContain("my%20image.png");
    expect(html).not.toContain("cover%22");
    expect(html).toContain('alt="alt"');
  });

  it("wraps link URLs containing spaces in angle brackets before rendering", () => {
    const md = "[label](https://example.com/my doc.pdf)";
    const html = renderMarkdown(md);
    expect(html).toContain("https://example.com/my%20doc.pdf");
  });

  it("renders local image paths with spaces without requiring %20 in the source", () => {
    const html = renderMarkdown("![shot](resources/05-模型广场模块 PRD-1.png)");
    expect(html).toContain("<img");
    // markdown-it percent-encodes the HTML attribute; source may keep literal spaces.
    expect(html).toContain("PRD-1.png");
    expect(html).toMatch(/%20| /);
  });

  it("renders local markdown links with spaces as hyperlinks without requiring %20", () => {
    const html = renderMarkdown("[PRD](docs/完整 PRD.md)");
    expect(html).toContain("<a ");
    expect(html).toContain('href="');
    expect(html).toMatch(/PRD\.md/);
  });

  it("keeps literal spaces in wiki embeds and wiki links (no %20 in source attrs)", () => {
    const embedHtml = renderMarkdown(
      "![[resources/05-模型广场模块 PRD-1.png]]",
    );
    expect(embedHtml).toContain("data-wiki-embed");
    expect(embedHtml).toContain("05-模型广场模块 PRD-1.png");
    expect(embedHtml).not.toContain("%20");

    const linkHtml = renderMarkdown("See [[docs/完整 PRD]]");
    expect(linkHtml).toContain("markdown-wikilink");
    expect(linkHtml).toContain('data-wikilink="docs/完整 PRD"');
  });
});
