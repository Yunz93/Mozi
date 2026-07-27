/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  bindLivePreviewImageMeasure,
  bindLivePreviewWidgetCaret,
  cancelPendingLivePreviewReveals,
  isLivePreviewRevealCurrent,
  scheduleLivePreviewMeasure,
  scheduleLivePreviewReveal,
} from "./shared";

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
});
