/** @vitest-environment happy-dom */

import React, { useEffect, useLayoutEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCodeMirror } from "./useCodeMirror";

function Harness({
  documentKey,
  content,
  onChange,
  onReady,
}: {
  documentKey: string | null;
  content: string;
  onChange: (content: string) => void;
  onReady: (cm: ReturnType<typeof useCodeMirror>) => void;
}) {
  const cm = useCodeMirror({
    documentKey,
    content,
    onChange,
    placeholder: "",
    themeMode: "light",
  });
  useLayoutEffect(() => {
    // 模拟新文件刚挂载、被保存或读取流程立即刷新的时序。
    if (documentKey === "next") cm.flushPendingContentChange();
  });
  useEffect(() => onReady(cm), [cm, onReady]);
  return documentKey ? <div ref={cm.editorRef} /> : <p>未选择文件</p>;
}

describe("CodeMirror document detach", () => {
  it("does not emit the previous note into the empty workspace or the next note", async () => {
    let cm: ReturnType<typeof useCodeMirror> | null = null;
    const onReady = (next: ReturnType<typeof useCodeMirror>) => {
      cm = next;
    };
    const firstChange = vi.fn();
    const emptyChange = vi.fn();
    const nextChange = vi.fn();
    const { rerender, unmount, container } = render(
      <Harness
        documentKey="first"
        content="第一篇"
        onChange={firstChange}
        onReady={onReady}
      />,
    );
    await waitFor(() => expect(cm?.view).toBeTruthy());
    act(() => {
      cm!.view!.dispatch({
        changes: { from: 3, insert: "修改" },
        userEvent: "input",
      });
      cm!.flushPendingContentChange();
    });
    expect(firstChange).toHaveBeenLastCalledWith("第一篇修改", {
      skipHistory: false,
    });

    rerender(
      <Harness
        documentKey={null}
        content=""
        onChange={emptyChange}
        onReady={onReady}
      />,
    );
    await waitFor(() => expect(cm?.view).toBeNull());
    expect(emptyChange).not.toHaveBeenCalled();

    rerender(
      <Harness
        documentKey="next"
        content="第二篇"
        onChange={nextChange}
        onReady={onReady}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".cm-content")?.textContent).toBe(
        "第二篇",
      ),
    );
    expect(nextChange).not.toHaveBeenCalled();
    unmount();
  });
});
