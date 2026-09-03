/** @vitest-environment happy-dom */

import React, { useEffect } from "react";
import { render, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { useCodeMirror } from "./useCodeMirror";

function Harness(props: {
  content: string;
  documentKey?: string;
  placeholder?: string;
  onChange: (content: string) => void;
  onView: (view: EditorView | null) => void;
}) {
  const cm = useCodeMirror({
    content: props.content,
    documentKey: props.documentKey ?? "file-1",
    placeholder: props.placeholder ?? "在此输入...",
    themeMode: "light",
    onChange: props.onChange,
  });

  useEffect(() => {
    props.onView(cm.view);
  }, [cm.view, props]);

  return <div ref={cm.editorRef} />;
}

describe("useCodeMirror content sync race", () => {
  it("does not wipe newer editor input on stale store echo", async () => {
    const onChange = vi.fn((_content: string) => undefined);
    let view: EditorView | null = null;

    const { rerender } = render(
      <Harness
        content="ab"
        onChange={onChange}
        onView={(v) => {
          view = v;
        }}
      />,
    );

    await waitFor(() => expect(view).not.toBeNull());

    vi.useFakeTimers();

    // 1) First user input triggers a debounced onChange("abc").
    act(() => {
      view!.dispatch({
        changes: {
          from: view!.state.doc.length,
          to: view!.state.doc.length,
          insert: "c",
        },
        userEvent: "input",
      });
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(onChange).toHaveBeenLastCalledWith("abc", {
      skipHistory: false,
    });
    expect(view!.state.doc.toString()).toBe("abc");

    // 2) User types again before the store flushes "abcd".
    act(() => {
      view!.dispatch({
        changes: {
          from: view!.state.doc.length,
          to: view!.state.doc.length,
          insert: "d",
        },
        userEvent: "input",
      });
    });
    expect(view!.state.doc.toString()).toBe("abcd");

    // 3) Parent re-renders with the older "abc" prop (stale store echo).
    await act(async () => {
      rerender(
        <Harness
          content="abc"
          onChange={onChange}
          onView={(v) => {
            view = v;
          }}
        />,
      );
      await Promise.resolve();
    });

    // Should NOT wipe the newer "abcd".
    expect(view!.state.doc.toString()).toBe("abcd");

    // 4) Real external content change must still be applied.
    await act(async () => {
      rerender(
        <Harness
          content="ZZZ"
          onChange={onChange}
          onView={(v) => {
            view = v;
          }}
        />,
      );
      await Promise.resolve();
    });
    expect(view!.state.doc.toString()).toBe("ZZZ");

    vi.useRealTimers();
  });
});
