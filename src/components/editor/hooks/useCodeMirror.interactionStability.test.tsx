/** @vitest-environment happy-dom */

import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { useCodeMirror } from "./useCodeMirror";

function Harness({
  content,
  onReady,
}: {
  content: string;
  onReady: (view: EditorView | null) => void;
}) {
  const cm = useCodeMirror({
    content,
    documentKey: "note",
    placeholder: "",
    themeMode: "light",
    onChange: () => undefined,
  });
  useEffect(() => onReady(cm.view), [cm.view, onReady]);
  return (
    <>
      <input aria-label="搜索" />
      <div ref={cm.editorRef} />
    </>
  );
}

describe("external content refresh respects newer interaction", () => {
  afterEach(() => vi.restoreAllMocks());

  async function mount() {
    let view: EditorView | null = null;
    const onReady = (next: EditorView | null) => {
      view = next;
    };
    const doc = "---\ntitle: 原标题\n---\n\n正文\n".repeat(30);
    const rendered = render(<Harness content={doc} onReady={onReady} />);
    await waitFor(() => expect(view).toBeTruthy());
    const editor = view!;
    Object.defineProperties(editor.scrollDOM, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 500 },
    });
    vi.spyOn(editor.scrollDOM, "scrollTo").mockImplementation(
      (options: number | ScrollToOptions) => {
        if (typeof options === "object")
          editor.scrollDOM.scrollTop = options.top ?? 0;
      },
    );
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 100;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const refresh = () => {
      act(() => {
        editor.focus();
        editor.scrollDOM.scrollTop = 120;
        rendered.rerender(
          <Harness
            content={doc.replace("原标题", "新标题")}
            onReady={onReady}
          />,
        );
      });
      expect(editor.scrollDOM.scrollTop).toBe(120);
      expect(editor.state.doc.toString()).toContain("新标题");
    };
    const flushFrames = () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(performance.now());
      });
    return { ...rendered, editor, refresh, flushFrames };
  }

  it("does not steal focus from a search input before the next frame", async () => {
    const { editor, getByRole, refresh, flushFrames } = await mount();
    refresh();
    expect(editor.hasFocus).toBe(true);
    const search = getByRole("textbox", { name: "搜索" });
    search.focus();
    expect(document.activeElement).toBe(search);
    flushFrames();
    expect(document.activeElement).toBe(search);
  });

  it("does not undo a newer user scroll before the next frame", async () => {
    const { editor, refresh, flushFrames } = await mount();
    refresh();
    editor.scrollDOM.scrollTop = 350;
    editor.scrollDOM.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(editor.scrollDOM.scrollTop).toBe(350);
  });

  it("does not rewind scrolling after a newer caret move", async () => {
    const { editor, refresh, flushFrames } = await mount();
    refresh();
    act(() =>
      editor.dispatch({
        selection: { anchor: editor.state.doc.length - 2 },
        scrollIntoView: true,
      }),
    );
    editor.scrollDOM.scrollTop = 800;
    flushFrames();
    expect(editor.scrollDOM.scrollTop).toBe(800);
    expect(editor.state.selection.main.head).toBe(editor.state.doc.length - 2);
  });
});
