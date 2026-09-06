/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingEditorRangeFocus,
  noteEditorUserGesture,
  registerActiveEditorView,
  requestEditorRangeFocus,
} from "./editorSelectionBridge";

describe("editorSelectionBridge pending focus", () => {
  afterEach(() => {
    clearPendingEditorRangeFocus();
    registerActiveEditorView(null, null);
    vi.useRealTimers();
  });

  it("expires unflushed focus requests after the final retry", () => {
    vi.useFakeTimers();

    const didFocus = requestEditorRangeFocus("note-a", 12, 18);
    expect(didFocus).toBe(false);

    vi.runAllTimers();

    const fakeView = {
      state: {
        doc: { length: 100 },
        selection: { main: { from: 0, to: 0 } },
      },
      focus: vi.fn(),
      dispatch: vi.fn(),
      lineBlockAt: () => ({ top: 0 }),
      scrollDOM: { clientHeight: 400, scrollTop: 0 },
    };

    registerActiveEditorView(fakeView as never, "note-a");
    expect(fakeView.dispatch).not.toHaveBeenCalled();
  });

  it("clears pending focus so a later register does not jump", () => {
    requestEditorRangeFocus("note-a", 40, 48);
    clearPendingEditorRangeFocus();

    const fakeView = {
      state: {
        doc: { length: 100 },
        selection: { main: { from: 0, to: 0 } },
      },
      focus: vi.fn(),
      dispatch: vi.fn(),
      lineBlockAt: () => ({ top: 0 }),
      scrollDOM: { clientHeight: 400, scrollTop: 0 },
    };

    registerActiveEditorView(fakeView as never, "note-a");
    expect(fakeView.dispatch).not.toHaveBeenCalled();
  });

  it("drops a pending retry after the user clicks or types in the editor", () => {
    vi.useFakeTimers();
    requestEditorRangeFocus("note-a", 12, 18);
    noteEditorUserGesture();

    const fakeView = {
      state: {
        doc: { length: 100 },
        selection: { main: { from: 0, to: 0 } },
      },
      focus: vi.fn(),
      dispatch: vi.fn(),
      lineBlockAt: () => ({ top: 0 }),
      scrollDOM: { clientHeight: 400, scrollTop: 0 },
    };

    registerActiveEditorView(fakeView as never, "note-a");
    vi.runAllTimers();
    expect(fakeView.dispatch).not.toHaveBeenCalled();
  });
});
