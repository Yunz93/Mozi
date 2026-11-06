/** @vitest-environment happy-dom */

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWritingExperience, writingView } from "./writingExperience";

type Measurement = NonNullable<Parameters<EditorView["requestMeasure"]>[0]>;

describe("typewriter caret positioning", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) {
      const parent = view.dom.parentElement;
      view.destroy();
      parent?.remove();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mount(enabled = true) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const writing = new Compartment();
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "第一段\n第二段\n最后一段",
        extensions: writing.of(
          createWritingExperience({ typewriterMode: enabled }),
        ),
      }),
    });
    views.push(view);
    vi.spyOn(view, "hasFocus", "get").mockReturnValue(true);
    vi.spyOn(view, "coordsAtPos").mockReturnValue({
      top: 480,
      bottom: 500,
      left: 30,
      right: 31,
    });
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
    view.scrollDOM.scrollTop = 100;
    const measurements = new Map<unknown, Measurement>();
    vi.spyOn(view, "requestMeasure").mockImplementation((request) => {
      if (request) measurements.set(request.key ?? request, request);
    });
    const flush = () => {
      const pending = [...measurements.values()];
      measurements.clear();
      for (const request of pending) request.write?.(request.read(view), view);
    };
    const type = () =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "新" },
        selection: { anchor: view.state.doc.length + 1 },
        userEvent: "input.type",
      });
    const layout = () =>
      view.plugin(writingView)!.update({
        view,
        state: view.state,
        startState: view.state,
        transactions: [],
        docChanged: false,
        selectionSet: false,
        focusChanged: false,
        viewportChanged: false,
        geometryChanged: true,
      } as unknown as ViewUpdate);
    return { view, writing, flush, type, layout };
  }

  it("positions the current caret when enabled without changing the document or selection", () => {
    const { view, writing, flush } = mount(false);
    const content = view.state.doc;
    const selection = view.state.selection;
    view.dispatch({
      effects: writing.reconfigure(
        createWritingExperience({ typewriterMode: true }),
      ),
    });
    flush();
    expect(view.scrollDOM.scrollTop).toBe(315);
    expect(view.state.doc).toBe(content);
    expect(view.state.selection).toBe(selection);
  });

  it("keeps a typing correction through an unrelated layout transaction", () => {
    const { view, flush, type } = mount();
    type();
    view.dispatch({});
    flush();
    expect(view.scrollDOM.scrollTop).toBe(315);
  });

  it("follows keyboard caret movement", () => {
    const { view, flush } = mount();
    view.dispatch({ selection: { anchor: 6 }, userEvent: "select" });
    flush();
    expect(view.scrollDOM.scrollTop).toBe(315);
  });

  it("leaves pointer selections and external document refreshes alone", () => {
    const { view, flush } = mount();
    view.dispatch({
      selection: { anchor: 2, head: 8 },
      userEvent: "select.pointer",
    });
    view.dispatch({ changes: { from: 0, insert: "外部" } });
    flush();
    expect(view.scrollDOM.scrollTop).toBe(100);
    expect(view.state.selection.main.empty).toBe(false);
  });

  it("does not reposition a collapsed caret for an external refresh", () => {
    const { view, flush } = mount();
    view.dispatch({ changes: { from: 0, insert: "外部更新\n" } });
    flush();
    expect(view.scrollDOM.scrollTop).toBe(100);
  });

  it("cancels pending positioning after a manual wheel or blur", () => {
    const { view, flush, type } = mount();
    type();
    view.contentDOM.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: 100 }),
    );
    flush();
    expect(view.scrollDOM.scrollTop).toBe(100);
    type();
    vi.mocked(
      Object.getOwnPropertyDescriptor(view, "hasFocus")!.get!,
    ).mockReturnValue(false);
    flush();
    expect(view.scrollDOM.scrollTop).toBe(100);
  });

  it("cancels a delayed composition-end correction when the user scrolls", () => {
    const { view, flush } = mount();
    vi.useFakeTimers();
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    view.contentDOM.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: 100 }),
    );
    vi.advanceTimersByTime(60);
    flush();
    expect(view.scrollDOM.scrollTop).toBe(100);
  });

  it("keeps manual browsing through later layout changes until typing resumes", () => {
    const { view, flush, type, layout } = mount();
    view.scrollDOM.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    view.scrollDOM.scrollTop = 150;
    layout();
    flush();
    expect(view.scrollDOM.scrollTop).toBe(150);
    type();
    flush();
    expect(view.scrollDOM.scrollTop).toBe(365);
  });

  it("cancels pending positioning when the native scrollbar is grabbed", () => {
    const { view, flush, type } = mount();
    type();
    view.scrollDOM.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    view.scrollDOM.scrollTop = 700;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    flush();
    expect(view.scrollDOM.scrollTop).toBe(700);
  });

  it("invalidates a delayed composition correction after an external refresh", () => {
    const { view, flush } = mount();
    vi.useFakeTimers();
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    view.dispatch({ changes: { from: 0, insert: "外部更新" } });
    vi.advanceTimersByTime(60);
    flush();
    expect(view.scrollDOM.scrollTop).toBe(100);
  });
});
