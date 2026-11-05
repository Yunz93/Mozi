/** @vitest-environment happy-dom */

import React, { useEffect, useLayoutEffect } from "react";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCodeMirror } from "./useCodeMirror";
import { livePreviewImages } from "../livePreview/images";

function Harness({
  documentKey,
  content,
  onChange,
  onReady,
  livePreviewEnabled = false,
  themeMode = "light",
  wordWrap = true,
}: {
  documentKey: string | null;
  content: string;
  onChange: (content: string) => void;
  onReady: (cm: ReturnType<typeof useCodeMirror>) => void;
  livePreviewEnabled?: boolean;
  themeMode?: "light" | "dark";
  wordWrap?: boolean;
}) {
  const cm = useCodeMirror({
    documentKey,
    content,
    onChange,
    placeholder: "",
    themeMode,
    wordWrap,
    livePreviewEnabled,
  });
  useLayoutEffect(() => {
    // 模拟新文件刚挂载、被保存或读取流程立即刷新的时序。
    if (documentKey === "next") cm.flushPendingContentChange();
  });
  useEffect(() => onReady(cm), [cm, onReady]);
  return documentKey ? <div ref={cm.editorRef} /> : <p>未选择文件</p>;
}

describe("CodeMirror document detach", () => {
  it("restores cached text and history with the current theme, wrap and source settings", async () => {
    let cm: ReturnType<typeof useCodeMirror> | null = null;
    const onReady = (next: ReturnType<typeof useCodeMirror>) => {
      cm = next;
    };
    const onChange = vi.fn();
    const first = "# A\n\n正文";
    const page = (key: string | null, content: string, updated = false) => (
      <Harness
        documentKey={key}
        content={content}
        onReady={onReady}
        onChange={onChange}
        themeMode={updated ? "dark" : "light"}
        wordWrap={!updated}
        livePreviewEnabled={!updated}
      />
    );
    const { rerender } = render(page("A", first));
    await waitFor(() => expect(cm?.view?.state.doc.toString()).toBe(first));
    expect(cm!.view!.state.facet(EditorView.darkTheme)).toBe(false);
    expect(cm!.view!.contentDOM.classList.contains("cm-lineWrapping")).toBe(
      true,
    );
    expect(cm!.view!.plugin(livePreviewImages)).toBeTruthy();
    rerender(page("B", "# B"));
    rerender(page("B", "# B", true));
    rerender(page(null, "", true));
    await waitFor(() => expect(cm?.view).toBeNull());
    rerender(page("A", first, true));
    await waitFor(() => expect(cm?.view?.state.doc.toString()).toBe(first));
    const view = cm!.view!;
    const checkSettings = () => {
      expect(view.state.facet(EditorView.darkTheme)).toBe(true);
      expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
      expect(view.plugin(livePreviewImages)).toBeNull();
    };
    checkSettings();
    act(() => {
      view.dispatch({
        changes: { from: first.length, insert: "新" },
        selection: { anchor: first.length + 1 },
        userEvent: "input",
      });
      cm!.flushPendingContentChange();
    });
    rerender(page("A", first + "新", true));
    checkSettings();
    expect(view.state.selection.main.head).toBe(first.length + 1);
    act(() => {
      expect(undo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe(first);
  });

  it.each([false, true])(
    "uses the latest content when a cached document remounts (Live: %s)",
    async (livePreviewEnabled) => {
      let cm: ReturnType<typeof useCodeMirror> | null = null;
      const onReady = (next: ReturnType<typeof useCodeMirror>) => {
        cm = next;
      };
      const onChange = vi.fn();
      const oldDoc = "---\ntitle: 原标题\n---\n\n旧正文\n";
      const newDoc = "---\ntitle: 外部更新\n---\n\n磁盘上的新正文\n";
      const { rerender } = render(
        <Harness
          documentKey="cached"
          content={oldDoc}
          onChange={onChange}
          onReady={onReady}
          livePreviewEnabled={livePreviewEnabled}
        />,
      );
      await waitFor(() => expect(cm?.view?.state.doc.toString()).toBe(oldDoc));
      act(() =>
        cm!.view!.dispatch({
          selection: { anchor: oldDoc.indexOf("旧正文") + 1 },
        }),
      );
      rerender(
        <Harness
          documentKey={null}
          content=""
          onChange={onChange}
          onReady={onReady}
          livePreviewEnabled={livePreviewEnabled}
        />,
      );
      await waitFor(() => expect(cm?.view).toBeNull());
      rerender(
        <Harness
          documentKey="cached"
          content={newDoc}
          onChange={onChange}
          onReady={onReady}
          livePreviewEnabled={livePreviewEnabled}
        />,
      );
      await waitFor(() => expect(cm?.view?.state.doc.toString()).toBe(newDoc));
      const view = cm!.view!;
      const pos = newDoc.indexOf("新正文") + 1;
      act(() => {
        view.dispatch({
          changes: { from: pos, insert: "新" },
          selection: { anchor: pos + 1 },
          userEvent: "input",
        });
        cm!.flushPendingContentChange();
      });
      expect(onChange).toHaveBeenLastCalledWith(
        newDoc.slice(0, pos) + "新" + newDoc.slice(pos),
        { skipHistory: false },
      );
      expect(view.state.selection.main.head).toBe(pos + 1);
    },
  );

  it.each([false, true])(
    "keeps the first typed caret after a delayed editor mount (Live: %s)",
    async (livePreviewEnabled) => {
      let cm: ReturnType<typeof useCodeMirror> | null = null;
      const onReady = (next: ReturnType<typeof useCodeMirror>) => {
        cm = next;
      };
      const onChange = vi.fn();
      const doc = "---\ntitle: 属性\n---\n\n正文输入位置\n";
      const { rerender } = render(
        <Harness
          documentKey={null}
          content=""
          onChange={onChange}
          onReady={onReady}
          livePreviewEnabled={livePreviewEnabled}
        />,
      );
      rerender(
        <Harness
          documentKey="new-note"
          content={doc}
          onChange={onChange}
          onReady={onReady}
          livePreviewEnabled={livePreviewEnabled}
        />,
      );
      await waitFor(() => expect(cm?.view?.state.doc.toString()).toBe(doc));
      const view = cm!.view!;
      const pos = doc.indexOf("正文") + 2;
      act(() => {
        view.dispatch({
          changes: { from: pos, insert: "新" },
          selection: { anchor: pos + 1 },
          userEvent: "input.type.compose.start",
        });
        cm!.flushPendingContentChange();
      });
      const edited = view.state.doc.toString();
      expect(onChange).toHaveBeenLastCalledWith(edited, { skipHistory: false });
      rerender(
        <Harness
          documentKey="new-note"
          content={edited}
          onChange={onChange}
          onReady={onReady}
          livePreviewEnabled={livePreviewEnabled}
        />,
      );
      expect(cm!.view).toBe(view);
      expect(view.state.selection.main.head).toBe(pos + 1);
      expect(view.state.doc.toString()).toBe(edited);
      expect(view.state.doc.sliceString(0, doc.indexOf("正文"))).toBe(
        doc.slice(0, doc.indexOf("正文")),
      );
      act(() => {
        expect(undo(view)).toBe(true);
      });
      expect(view.state.doc.toString()).toBe(doc);
      act(() => {
        expect(redo(view)).toBe(true);
      });
      expect(view.state.doc.toString()).toBe(edited);
    },
  );

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
