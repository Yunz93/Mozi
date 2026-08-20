/** @vitest-environment happy-dom */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRefocusPointerSelectionExtension,
  refocusPointerTracker,
  resolveRefocusMouseSelectionStyle,
  shouldForceSingleClickSelection,
} from "./refocusPointerSelection";

describe("shouldForceSingleClickSelection", () => {
  it("ignores non-left clicks and genuine single clicks", () => {
    expect(
      shouldForceSingleClickSelection(false, { button: 2, detail: 3 }, true),
    ).toBe(false);
    expect(
      shouldForceSingleClickSelection(false, { button: 0, detail: 1 }, true),
    ).toBe(false);
  });

  it("treats a multi-click after chrome / blur as a single caret click", () => {
    expect(
      shouldForceSingleClickSelection(true, { button: 0, detail: 2 }, true),
    ).toBe(true);
    expect(
      shouldForceSingleClickSelection(false, { button: 0, detail: 3 }, false),
    ).toBe(true);
  });

  it("keeps in-editor double and triple click", () => {
    expect(
      shouldForceSingleClickSelection(true, { button: 0, detail: 2 }, false),
    ).toBe(false);
    expect(
      shouldForceSingleClickSelection(true, { button: 0, detail: 3 }, false),
    ).toBe(false);
  });
});

describe("refocus pointer tracker", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length) {
      const view = views.pop();
      view?.destroy();
      view?.dom.parentElement?.remove();
    }
  });

  function mount(doc = "hello world\nsecond line") {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: createRefocusPointerSelectionExtension(),
      }),
      parent,
    });
    views.push(view);
    return view;
  }

  it("remembers that the previous pointer-down was outside the editor", () => {
    const view = mount();
    const tracker = view.plugin(refocusPointerTracker);
    expect(tracker).toBeTruthy();

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    expect(tracker!.previousPointerWasOutsideEditor).toBe(true);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true, detail: 2 }),
    );
    expect(tracker!.previousPointerWasOutsideEditor).toBe(true);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true, detail: 1 }),
    );
    expect(tracker!.previousPointerWasOutsideEditor).toBe(false);
    outside.remove();
  });

  it("forces a caret style instead of inheriting a triple-click from chrome", () => {
    const view = mount();
    view.contentDOM.blur();
    const event = new MouseEvent("mousedown", {
      button: 0,
      detail: 3,
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    });
    const style = resolveRefocusMouseSelectionStyle(view, event, true);
    expect(style).not.toBeNull();
    const selection = style!.get(event, false, false);
    expect(selection.main.empty).toBe(true);
  });
});
