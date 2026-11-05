/** @vitest-environment happy-dom */

import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLivePreviewPluginExtensions } from "./index";
import { livePreviewCaretAnchor } from "./caretAnchor";
import {
  bindLivePreviewImageMeasure,
  bindLivePreviewMediaMeasure,
  bindLivePreviewWidgetResizeMeasure,
} from "./shared";

type Measurement = NonNullable<Parameters<EditorView["requestMeasure"]>[0]>;

describe("Live image caret viewport anchoring", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) {
      const parent = view.dom.parentElement;
      view.destroy();
      parent?.remove();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount() {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const live = new Compartment();
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "图片前\n光标正文\n尾部\n",
        extensions: [
          livePreviewCaretAnchor,
          live.of(createLivePreviewPluginExtensions()),
        ],
      }),
    });
    views.push(view);
    const measurements = new Map<unknown, Measurement>();
    vi.spyOn(view, "requestMeasure").mockImplementation((request) => {
      if (request) measurements.set(request.key ?? request, request);
    });
    vi.spyOn(view, "hasFocus", "get").mockReturnValue(true);
    vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 540,
      left: 0,
      right: 800,
      width: 800,
      height: 500,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    });
    Object.defineProperties(view.scrollDOM, {
      clientHeight: { configurable: true, value: 500 },
      clientWidth: { configurable: true, value: 800 },
    });
    vi.spyOn(view, "coordsAtPos").mockReturnValue({
      top: 220,
      bottom: 240,
      left: 30,
      right: 31,
    });
    view.scrollDOM.scrollTop = 100;
    view.dispatch({ selection: { anchor: 6 } });
    const flush = () => {
      const pending = [...measurements.values()];
      measurements.clear();
      for (const request of pending) request.write?.(request.read(view), view);
    };
    flush();
    const createImage = () => {
      const img = document.createElement("img");
      Object.defineProperty(img, "complete", {
        configurable: true,
        value: false,
      });
      view.contentDOM.appendChild(img);
      bindLivePreviewImageMeasure(view, img);
      return img;
    };
    const img = createImage();
    const scroll = vi.spyOn(EditorView, "scrollIntoView");
    const consumeScroll = (head = 6, y: "start" | "center" = "start") =>
      view.state.facet(EditorView.scrollHandler).some((handler) =>
        handler(view, EditorSelection.cursor(head), {
          y,
          x: "nearest",
          yMargin: 180,
          xMargin: 5,
        }),
      );
    const verifyBaseline = () => {
      img.dispatchEvent(new Event("load"));
      expect(scroll).toHaveBeenCalledWith(
        6,
        expect.objectContaining({ y: "start", yMargin: 180 }),
      );
      expect(consumeScroll()).toBe(false);
      scroll.mockClear();
      return createImage();
    };
    return {
      view,
      img,
      scroll,
      flush,
      createImage,
      consumeScroll,
      verifyBaseline,
      live,
    };
  }

  it("anchors a visible caret to its previous screen position when an image loads", () => {
    const { view, img, scroll } = mount();
    vi.mocked(view.coordsAtPos).mockReturnValue({
      top: 1620,
      bottom: 1640,
      left: 30,
      right: 31,
    });
    img.dispatchEvent(new Event("load"));
    expect(scroll).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ y: "start", yMargin: 180 }),
    );
    expect(view.state.selection.main.anchor).toBe(6);
    expect(view.state.selection.main.head).toBe(6);
  });

  it("also anchors images inside an embedded note", () => {
    const { view, scroll } = mount();
    const embed = document.createElement("div");
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", {
      configurable: true,
      value: false,
    });
    embed.appendChild(img);
    view.contentDOM.appendChild(embed);
    bindLivePreviewMediaMeasure(view, embed);
    img.dispatchEvent(new Event("load"));
    expect(scroll).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ yMargin: 180 }),
    );
  });

  it("also anchors asynchronously resized note embeds and callouts", () => {
    let onResize!: ResizeObserverCallback;
    class ProbeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        onResize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    const { view, scroll } = mount();
    vi.stubGlobal("ResizeObserver", ProbeResizeObserver);
    const embed = document.createElement("div");
    view.contentDOM.appendChild(embed);
    const disconnect = bindLivePreviewWidgetResizeMeasure(view, embed);
    vi.mocked(view.coordsAtPos).mockReturnValue({
      top: 1620,
      bottom: 1640,
      left: 30,
      right: 31,
    });
    onResize([], {} as ResizeObserver);
    expect(scroll).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ yMargin: 180 }),
    );
    disconnect();
    vi.unstubAllGlobals();
  });

  it("leaves an intentionally offscreen caret alone", () => {
    const { view, scroll, flush, verifyBaseline } = mount();
    const img = verifyBaseline();
    vi.mocked(view.coordsAtPos).mockReturnValue({
      top: -30,
      bottom: -10,
      left: 30,
      right: 31,
    });
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    flush();
    img.dispatchEvent(new Event("load"));
    expect(scroll).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(6);
  });

  it("does not restore an old caret after the user scrolls or changes selection", () => {
    const { view, scroll, verifyBaseline } = mount();
    const img = verifyBaseline();
    view.contentDOM.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, bubbles: true }),
    );
    view.dispatch({ selection: { anchor: 9 } });
    img.dispatchEvent(new Event("load"));
    expect(scroll).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(9);
  });

  it("does not take focus from another control", () => {
    const { view, scroll, verifyBaseline } = mount();
    const img = verifyBaseline();
    vi.mocked(
      Object.getOwnPropertyDescriptor(view, "hasFocus")!.get!,
    ).mockReturnValue(false);
    img.dispatchEvent(new Event("load"));
    expect(scroll).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(6);
  });

  it.each([
    "detached image",
    "hidden editor",
    "resized viewport",
    "changed document",
    "source mode",
  ])("ignores a late load after %s", (condition) => {
    const { view, scroll, verifyBaseline } = mount();
    const img = verifyBaseline();
    if (condition === "detached image") img.remove();
    if (condition === "hidden editor")
      view.dom.setAttribute("aria-hidden", "true");
    if (condition === "resized viewport")
      Object.defineProperty(view.scrollDOM, "clientWidth", { value: 600 });
    if (condition === "changed document")
      view.dispatch({ changes: { from: 0, to: 1, insert: "新" } });
    if (condition === "source mode")
      view.dispatch({ effects: StateEffect.reconfigure.of([]) });
    img.dispatchEvent(new Event("load"));
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each(["wheel", "touchstart", "keydown", "selection", "document", "blur"])(
    "cancels a queued correction when %s wins the race",
    (condition) => {
      const { view, consumeScroll, verifyBaseline } = mount();
      const img = verifyBaseline();
      img.dispatchEvent(new Event("load"));
      if (condition === "wheel")
        view.contentDOM.dispatchEvent(
          new WheelEvent("wheel", { deltaY: 100, bubbles: true }),
        );
      if (condition === "touchstart")
        view.contentDOM.dispatchEvent(
          new TouchEvent("touchstart", { bubbles: true, targetTouches: [] }),
        );
      if (condition === "keydown")
        view.contentDOM.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      if (condition === "selection")
        view.dispatch({ selection: { anchor: 9 } });
      if (condition === "document")
        view.dispatch({ changes: { from: 0, to: 1, insert: "新" } });
      if (condition === "blur")
        vi.mocked(
          Object.getOwnPropertyDescriptor(view, "hasFocus")!.get!,
        ).mockReturnValue(false);
      expect(consumeScroll()).toBe(true);
    },
  );

  it("cancels queued image scrolling when Live is disabled and leaves source navigation alone", () => {
    const { view, img, live, consumeScroll, flush } = mount();
    img.dispatchEvent(new Event("load"));
    view.dispatch({ effects: live.reconfigure([]) });
    expect(consumeScroll()).toBe(true);
    const coords = vi.mocked(view.coordsAtPos);
    coords.mockClear();
    const measure = vi.mocked(view.requestMeasure);
    measure.mockClear();
    view.contentDOM.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    view.dispatch({ selection: { anchor: 9 } });
    flush();
    expect(coords).not.toHaveBeenCalled();
    expect(measure.mock.calls.every((args) => args[0] == null)).toBe(true);
    expect(consumeScroll(9, "center")).toBe(false);
  });

  it("does not swallow an explicit navigation that replaces the image correction", () => {
    const { img, consumeScroll } = mount();
    img.dispatchEvent(new Event("load"));
    expect(consumeScroll(9, "center")).toBe(false);
  });
});
