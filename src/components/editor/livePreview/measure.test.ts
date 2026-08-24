/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorMarkdownLanguage } from "../editorMarkdown";
import { livePreviewContextFacet } from "./context";
import { livePreviewImages } from "./images";
import {
  bindLivePreviewClickToReveal,
  bindLivePreviewImageMeasure,
  bindLivePreviewWidgetCaret,
  bindLivePreviewWidgetResizeMeasure,
  cancelPendingLivePreviewReveals,
  isLivePreviewRevealCurrent,
  scheduleLivePreviewMeasure,
  scheduleLivePreviewReveal,
} from "./shared";
import { livePreviewWiki } from "./wiki";

describe("live preview geometry remasure", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length) {
      const view = views.pop();
      view?.destroy();
      view?.dom.parentElement?.remove();
    }
    vi.restoreAllMocks();
  });

  it("scheduleLivePreviewMeasure coalesces to one rAF requestMeasure", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "hello" }),
      parent,
    });
    views.push(view);
    const spy = vi.spyOn(view, "requestMeasure");
    scheduleLivePreviewMeasure(view);
    scheduleLivePreviewMeasure(view);
    expect(spy).not.toHaveBeenCalled();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(spy).toHaveBeenCalled();
  });

  it("bindLivePreviewWidgetResizeMeasure remasures on ResizeObserver callbacks", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "hello" }),
      parent,
    });
    views.push(view);
    const spy = vi.spyOn(view, "requestMeasure");
    const root = document.createElement("div");
    parent.appendChild(root);

    const disconnect = bindLivePreviewWidgetResizeMeasure(view, root);
    expect(callbacks.length).toBeGreaterThanOrEqual(1);
    const widgetCb = callbacks[callbacks.length - 1]!;

    // ResizeObserver helper rAF-coalesces, then scheduleLivePreviewMeasure rAF-coalesces.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(spy).toHaveBeenCalled();
    spy.mockClear();

    widgetCb([], {} as ResizeObserver);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(spy).toHaveBeenCalled();
    disconnect();
  });

  it("bindLivePreviewImageMeasure remasures on load", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "hello" }),
      parent,
    });
    views.push(view);
    const spy = vi.spyOn(view, "requestMeasure");

    const img = document.createElement("img");
    Object.defineProperty(img, "complete", {
      configurable: true,
      get: () => false,
    });
    bindLivePreviewImageMeasure(view, img);
    expect(spy).not.toHaveBeenCalled();

    img.dispatchEvent(new Event("load"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(spy).toHaveBeenCalled();
  });

  it("bindLivePreviewImageMeasure remasures for already-complete images", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "hello" }),
      parent,
    });
    views.push(view);
    const spy = vi.spyOn(view, "requestMeasure");

    const img = document.createElement("img");
    Object.defineProperty(img, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(img, "naturalHeight", {
      configurable: true,
      get: () => 120,
    });
    bindLivePreviewImageMeasure(view, img);
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(spy).toHaveBeenCalled();
  });
});

describe("live preview click-to-reveal races", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    cancelPendingLivePreviewReveals();
    while (views.length) {
      const view = views.pop();
      view?.destroy();
      view?.dom.parentElement?.remove();
    }
    vi.restoreAllMocks();
  });

  it("cancels a deferred reveal when a newer reveal is scheduled", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "abcdefghij" }),
      parent,
    });
    views.push(view);

    const first = vi.fn();
    const second = vi.fn((generation: number) => {
      expect(isLivePreviewRevealCurrent(generation)).toBe(true);
      view.dispatch({
        selection: { anchor: 4, head: 7 },
        scrollIntoView: false,
      });
    });

    scheduleLivePreviewReveal(view, first);
    scheduleLivePreviewReveal(view, second);

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(view.state.selection.main.from).toBe(4);
    expect(view.state.selection.main.to).toBe(7);
  });

  it("cancels a deferred reveal on explicit cancel / new mousedown", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "abcdefghij" }),
      parent,
    });
    views.push(view);

    const apply = vi.fn();
    scheduleLivePreviewReveal(view, apply);
    cancelPendingLivePreviewReveals();

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    expect(apply).not.toHaveBeenCalled();
  });

  it("places a collapsed caret when clicking a passive widget", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "one\ntwo\nthree",
        selection: { anchor: 0, head: 3 },
      }),
      parent,
    });
    views.push(view);

    const el = document.createElement("div");
    parent.appendChild(el);
    bindLivePreviewWidgetCaret(view, el, 8);

    el.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(8);
  });

  it("does not move the caret on mousedown; click reveals after timeout", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "abcdefghij",
        selection: { anchor: 0 },
      }),
      parent,
    });
    views.push(view);

    const el = document.createElement("div");
    parent.appendChild(el);
    const apply = vi.fn();
    bindLivePreviewClickToReveal(view, el, apply);

    const down = new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(0);
    expect(apply).not.toHaveBeenCalled();

    const start = new Event("selectstart", { bubbles: true, cancelable: true });
    el.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);

    el.dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }),
    );
    expect(apply).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("reasserts the reveal after layout settles", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "abcdefghij",
        selection: { anchor: 0 },
      }),
      parent,
    });
    views.push(view);

    const el = document.createElement("div");
    parent.appendChild(el);
    const apply = vi.fn();
    bindLivePreviewClickToReveal(view, el, apply);

    el.dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }),
    );
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    expect(apply).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(isLivePreviewRevealCurrent(apply.mock.calls[1]![0] as number)).toBe(
      true,
    );
  });
});

describe("live preview image click selection", () => {
  const views: EditorView[] = [];

  const ignoreSelectionChange = (event: Event) => {
    event.stopImmediatePropagation();
  };

  beforeEach(() => {
    // Register before EditorView so happy-dom's sync selectionchange cannot
    // nest a CM update during click-to-reveal dispatches.
    document.addEventListener("selectionchange", ignoreSelectionChange, true);
  });

  afterEach(() => {
    document.removeEventListener(
      "selectionchange",
      ignoreSelectionChange,
      true,
    );
    cancelPendingLivePreviewReveals();
    while (views.length) {
      const view = views.pop();
      view?.destroy();
      view?.dom.parentElement?.remove();
    }
  });

  function mount(
    doc: string,
    extras: import("@codemirror/state").Extension[] = [],
  ) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length - 1 },
        extensions: [
          createEditorMarkdownLanguage(),
          livePreviewContextFacet.of({
            sourceFilePath: null,
            rootFolderPath: null,
            files: [],
          }),
          ...extras,
        ],
      }),
      parent,
    });
    views.push(view);
    return view;
  }

  async function clickImageAndSettle(wrap: HTMLElement) {
    wrap.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    wrap.dispatchEvent(
      new MouseEvent("mouseup", {
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    wrap.dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }),
    );
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  it("keeps markdown image click selection inside the image construct", async () => {
    const image = "![cat](https://example.com/cat.png)";
    const doc = `${image}\n\n### heading\n\naway`;
    const view = mount(doc, [livePreviewImages]);
    const wrap = view.dom.querySelector(
      ".cm-live-preview-image-wrap",
    ) as HTMLElement | null;
    expect(wrap).not.toBeNull();

    await clickImageAndSettle(wrap!);

    const sel = view.state.selection.main;
    expect(sel.from).toBeGreaterThanOrEqual(0);
    expect(sel.to).toBeLessThanOrEqual(image.length);
    expect(sel.to).toBeGreaterThan(sel.from);
    expect(view.state.doc.sliceString(sel.from, sel.to)).not.toContain(
      "heading",
    );
  });

  it("keeps wiki image click selection inside the embed", async () => {
    const embed = "![[resources/foo.png|400]]";
    const doc = `${embed}\n\n### 图片分享\n\naway`;
    const view = mount(doc, [livePreviewWiki]);
    const wrap = view.dom.querySelector(
      ".cm-live-preview-image-wrap",
    ) as HTMLElement | null;
    expect(wrap).not.toBeNull();

    await clickImageAndSettle(wrap!);

    const sel = view.state.selection.main;
    expect(sel.from).toBeGreaterThanOrEqual(0);
    expect(sel.to).toBeLessThanOrEqual(embed.length);
    expect(sel.to).toBeGreaterThan(sel.from);
    expect(view.state.doc.sliceString(sel.from, sel.to)).not.toContain(
      "图片分享",
    );
  });
});
