/** @vitest-environment happy-dom */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore, defaultSettings } from "../../../store/appStore";
import { createWritingExperience, writingView } from "./writingExperience";

// 保留专注装饰检查，并确认历史配置和旧快捷键不能重新启用已移除的滚动行为。
describe("writing focus without typewriter positioning", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) {
      const parent = view.dom.parentElement;
      view.destroy();
      parent?.remove();
    }
    vi.restoreAllMocks();
  });
  function mount() {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const writing = new Compartment();
    const legacyPreferences = { focusMode: false, typewriterMode: true };
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "第一段\n第二段\n最后一段",
        extensions: writing.of(createWritingExperience(legacyPreferences)),
      }),
    });
    views.push(view);
    view.scrollDOM.scrollTop = 100;
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
    vi.spyOn(view, "requestMeasure").mockImplementation((request) => {
      if (request) request.write?.(request.read(view), view);
    });
    return { view, writing };
  }
  it("retains focus decorations without changing document, selection or scroll", () => {
    const { view, writing } = mount();
    const content = view.state.doc;
    const selection = view.state.selection;
    view.dispatch({
      effects: writing.reconfigure(
        createWritingExperience({ focusMode: true }),
      ),
    });
    expect(view.plugin(writingView)!.decorations.size).toBeGreaterThan(0);
    expect(view.dom.getAttribute("data-writing-focus")).toBe("true");
    expect(view.dom.hasAttribute("data-typewriter-mode")).toBe(false);
    expect(view.state.doc).toBe(content);
    expect(view.state.selection).toBe(selection);
    expect(view.scrollDOM.scrollTop).toBe(100);
  });
  it("does not center the caret while typing even when a legacy setting is present", () => {
    const { view } = mount();
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "新" },
      selection: { anchor: view.state.doc.length + 1 },
      userEvent: "input.type",
    });
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(view.scrollDOM.scrollTop).toBe(100);
  });
  it("does not toggle editor settings with the removed F9 binding", () => {
    const legacy = { ...defaultSettings, typewriterMode: true };
    useAppStore.setState({ settings: legacy });
    const { view } = mount();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F9", bubbles: true }),
    );
    expect(useAppStore.getState().settings).toBe(legacy);
  });
});
