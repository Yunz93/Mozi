/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flattenHeadingNodes,
  parseHeadings,
  type HeadingNode,
} from "./outline";
import { applyPreviewHeadingAttributes } from "./previewHeadingAttributes";
import {
  __resetPreviewNavigationBridgeForTests,
  registerPreviewPane,
  requestPreviewHeadingScroll,
  unregisterPreviewPane,
} from "./previewNavigationBridge";

describe("applyPreviewHeadingAttributes", () => {
  const tabId = "target-note";
  let rafId = 0;

  beforeEach(() => {
    __resetPreviewNavigationBridgeForTests();
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      rafId += 1;
      return rafId;
    });
  });

  afterEach(() => {
    __resetPreviewNavigationBridgeForTests();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("flushes a pending cross-file heading scroll after headings render late", () => {
    const container = document.createElement("div");
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;
    container.innerHTML = '<article class="markdown-body"></article>';
    document.body.appendChild(container);
    registerPreviewPane(tabId, container);

    expect(requestPreviewHeadingScroll(tabId, "4.3 区块引用")).toBe(false);

    container.innerHTML =
      '<article class="markdown-body"><h4>4.3 区块引用</h4></article>';
    const headings: HeadingNode[] = [
      {
        id: "43-区块引用",
        level: 4,
        text: "4.3 区块引用",
        children: [],
        line: 12,
      },
    ];

    applyPreviewHeadingAttributes(container, headings, tabId);

    expect(container.querySelector("h4")?.dataset.headingText).toBe(
      "4.3 区块引用",
    );
    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "auto",
    });

    unregisterPreviewPane(tabId, container);
    container.remove();
  });

  it("clears heading attributes when DOM has more headings than data", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <article class="markdown-body">
        <h1>Title</h1>
        <h2>Subtitle</h2>
      </article>
    `;

    const headings: HeadingNode[] = [
      {
        id: "title",
        level: 1,
        text: "Title",
        children: [],
        line: 0,
      },
    ];

    applyPreviewHeadingAttributes(container, headings);

    const h1 = container.querySelector("h1");
    const h2 = container.querySelector("h2");

    expect(h1?.dataset.headingId).toBe("title");
    expect(h2?.dataset.headingId).toBeUndefined();
    expect(h2?.dataset.headingSlug).toBeUndefined();
    expect(h2?.dataset.headingText).toBeUndefined();
  });

  it("keeps later headings aligned when an extra DOM heading appears mid-document", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <article class="markdown-body">
        <h1>Intro</h1>
        <h2>Not in outline</h2>
        <h2>Chapter Two</h2>
      </article>
    `;

    const headings: HeadingNode[] = [
      {
        id: "intro",
        level: 1,
        text: "Intro",
        children: [],
        line: 1,
      },
      {
        id: "chapter-two",
        level: 2,
        text: "Chapter Two",
        children: [],
        line: 8,
      },
    ];

    applyPreviewHeadingAttributes(container, headings);

    const [first, second, third] = Array.from(
      container.querySelectorAll<HTMLElement>("h1, h2"),
    );
    expect(first.dataset.headingId).toBe("intro");
    expect(second.dataset.headingId).toBeUndefined();
    expect(third.dataset.headingId).toBe("chapter-two");
  });

  it("ignores headings inside embedded notes and strips outline inline marks", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <article class="markdown-body">
        <h1>Main Title</h1>
        <article class="markdown-body preview-note-embed-body">
          <h1>Embedded Title</h1>
        </article>
      </article>
    `;

    const headings: HeadingNode[] = [
      {
        id: "main-title",
        level: 1,
        text: "**Main Title**",
        children: [],
        line: 1,
      },
    ];

    applyPreviewHeadingAttributes(container, headings);

    const main = container.querySelector(
      "article.markdown-body > h1",
    ) as HTMLElement;
    const embedded = container.querySelector(
      ".preview-note-embed-body h1",
    ) as HTMLElement;
    expect(main.dataset.headingId).toBe("main-title");
    expect(embedded.dataset.headingId).toBeUndefined();
  });
  it("does not rewrite unchanged heading attributes on a retained preview", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<article class="markdown-body"><h2>Chapter</h2></article>';
    const headings: HeadingNode[] = [
      { id: "chapter", level: 2, text: "Chapter", line: 1, children: [] },
    ];
    applyPreviewHeadingAttributes(container, headings);
    const observer = new MutationObserver(() => {});
    observer.observe(container, { attributes: true, subtree: true });
    applyPreviewHeadingAttributes(container, headings);
    expect(observer.takeRecords()).toHaveLength(0);
    applyPreviewHeadingAttributes(container, [
      { ...headings[0], id: "updated-chapter" },
    ]);
    expect(container.querySelector("h2")?.id).toBe("updated-chapter");
    expect(
      observer.takeRecords().some((record) => record.attributeName === "id"),
    ).toBe(true);
    observer.disconnect();
  });

  it("matches reordered headings without repeatedly reading the whole outline", () => {
    const count = 150;
    let textReads = 0;
    const headings: HeadingNode[] = Array.from({ length: count }, (_, i) => ({
      id: `heading-${i}`,
      level: 2,
      get text() {
        textReads++;
        return `Heading ${i}`;
      },
      line: i,
      children: [],
    }));
    const container = document.createElement("div");
    container.innerHTML =
      '<article class="markdown-body">' +
      Array.from(
        { length: count },
        (_, i) => `<h2>Heading ${count - i - 1}</h2>`,
      ).join("") +
      "</article>";
    applyPreviewHeadingAttributes(container, headings);
    expect(
      Array.from(container.querySelectorAll("h2"), (node) => node.id),
    ).toEqual(
      Array.from({ length: count }, (_, i) => `heading-${count - i - 1}`),
    );
    expect(textReads).toBeLessThan(count * 5);
  });
  it("keeps repeated normalized titles assigned in outline order", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<article class="markdown-body"><h2><strong>Chapter</strong></h2><h2>Chapter</h2></article>';
    const headings: HeadingNode[] = [
      { id: "chapter", level: 2, text: "**Chapter**", line: 1, children: [] },
      { id: "chapter-1", level: 2, text: "Chapter", line: 3, children: [] },
    ];
    applyPreviewHeadingAttributes(container, headings);
    expect(
      Array.from(container.querySelectorAll("h2"), (node) => node.id),
    ).toEqual(["chapter", "chapter-1"]);
  });
  it("updates retained heading ids when source changes but rendered text is identical", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<article class="markdown-body"><h1>A &amp; B</h1></article>';
    applyPreviewHeadingAttributes(
      container,
      flattenHeadingNodes(parseHeadings("# A &amp; B")),
    );
    const heading = container.querySelector("h1")!;
    expect(heading.id).toBe("a-amp-b");
    applyPreviewHeadingAttributes(
      container,
      flattenHeadingNodes(parseHeadings("# A &#38; B")),
    );
    expect(container.querySelector("h1")).toBe(heading);
    expect(heading.id).toBe("a-38-b");
    expect(heading.dataset.headingId).toBe("a-38-b");
    applyPreviewHeadingAttributes(container, []);
    expect(heading.dataset.headingId).toBeUndefined();
  });
});
