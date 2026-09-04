/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadingNode } from "./outline";
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
});
