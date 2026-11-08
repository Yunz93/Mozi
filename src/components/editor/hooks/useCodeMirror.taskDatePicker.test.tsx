/** @vitest-environment happy-dom */

import React, { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCodeMirror } from "./useCodeMirror";

function Harness({
  onReady,
  live = false,
  content = "- [ ] 整理笔记 ",
  documentKey = "task-date-note",
}: {
  onReady: (view: EditorView | null) => void;
  live?: boolean;
  content?: string;
  documentKey?: string;
}) {
  const editor = useCodeMirror({
    content,
    documentKey,
    livePreviewEnabled: live,
    onChange: vi.fn(),
  });
  useEffect(() => onReady(editor.view), [editor.view, onReady]);
  return <div ref={editor.editorRef} />;
}

afterEach(cleanup);

async function mount(content = "- [ ] 整理笔记 ") {
  let view: EditorView | null = null;
  const onReady = (next: EditorView | null) => {
    view = next;
  };
  const rendered = render(<Harness content={content} onReady={onReady} />);
  await waitFor(() => expect(view).not.toBeNull());
  return { view: view!, rendered, onReady };
}

function type(view: EditorView, text: string, pos = view.state.doc.length) {
  act(() => {
    view.focus();
    view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length },
      userEvent: "input.type",
    });
  });
}

describe("task date picker in the editor", () => {
  it.each([false, true])(
    "opens after @ and inserts a day in live mode %s",
    async (live) => {
      let view: EditorView | null = null;
      render(
        <Harness
          live={live}
          onReady={(next) => {
            view = next;
          }}
        />,
      );
      await waitFor(() => expect(view).not.toBeNull());
      act(() => {
        const end = view!.state.doc.length;
        view!.focus();
        view!.dispatch({
          changes: { from: end, insert: "@" },
          selection: { anchor: end + 1 },
          userEvent: "input.type",
        });
      });
      const dialog = await screen.findByRole("dialog", {
        name: "选择到期日期",
      });
      expect(dialog).toBeTruthy();
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      fireEvent.click(screen.getByRole("button", { name: "今天" }));
      expect(view!.state.doc.toString()).toBe(`- [ ] 整理笔记 @${date}`);
      expect(view!.state.selection.main.head).toBe(view!.state.doc.length);
      expect(view!.hasFocus).toBe(true);
      expect(screen.queryByRole("dialog", { name: "选择到期日期" })).toBeNull();
    },
  );

  it("replaces a partial date, preserves surrounding text, and undoes in one step", async () => {
    const original = "- [ ] 编辑😀  相关资料";
    const { view } = await mount(original);
    const pos = original.indexOf("  ") + 1;
    type(view, "@2026-11-", pos);
    const dialog = await screen.findByRole("dialog", { name: "选择到期日期" });
    fireEvent.click(dialog.querySelector('[data-date="2026-11-20"]')!);
    expect(view.state.doc.toString()).toBe("- [ ] 编辑😀 @2026-11-20 相关资料");
    expect(view.state.selection.main.head).toBe(pos + "@2026-11-20".length);
    act(() => {
      expect(undo(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe("- [ ] 编辑😀 @2026-11- 相关资料");
    expect(screen.queryByRole("dialog", { name: "选择到期日期" })).toBeNull();
  });

  it("chooses a date after changing month", async () => {
    const { view } = await mount();
    type(view, "@2026-12-");
    const dialog = await screen.findByRole("dialog", { name: "选择到期日期" });
    fireEvent.click(screen.getByRole("button", { name: "下个月" }));
    fireEvent.click(dialog.querySelector('[data-date="2027-01-01"]')!);
    expect(view.state.doc.toString()).toBe("- [ ] 整理笔记 @2027-01-01");
  });

  it.each([
    { doc: "普通正文 ", pos: undefined, opens: false },
    {
      doc: "- [ ] 联系 person@example.com",
      pos: "- [ ] 联系 person".length,
      opens: false,
    },
    {
      doc: "```md\n- [ ] 示例 \n```",
      pos: "```md\n- [ ] 示例 ".length,
      opens: false,
    },
    {
      doc: "---\n- [ ] 元数据 \n---",
      pos: "---\n- [ ] 元数据 ".length,
      opens: false,
    },
    { doc: "- [ ] `code `", pos: "- [ ] `code ".length, opens: false },
    {
      doc: "- [ ] [参考 ](https://example.com)",
      pos: "- [ ] [参考 ".length,
      opens: false,
    },
    { doc: "1. [ ] 有序待办 ", pos: undefined, opens: true },
    { doc: "> - [ ] 引用待办 ", pos: undefined, opens: true },
  ])("handles @ in $doc", async ({ doc, pos, opens }) => {
    const { view } = await mount(doc);
    type(view, "@", pos);
    if (opens) {
      expect(
        await screen.findByRole("dialog", { name: "选择到期日期" }),
      ).toBeTruthy();
    } else {
      expect(screen.queryByRole("dialog", { name: "选择到期日期" })).toBeNull();
    }
  });

  it("cancels without changing text and ignores an IME Escape", async () => {
    const { view } = await mount();
    type(view, "@");
    const dialog = await screen.findByRole("dialog", { name: "选择到期日期" });
    fireEvent.keyDown(dialog, { key: "Escape", isComposing: true });
    expect(
      screen.queryByRole("dialog", { name: "选择到期日期" }),
    ).not.toBeNull();
    fireEvent.keyDown(view.contentDOM, { key: "Escape", keyCode: 27 });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "选择到期日期" })).toBeNull(),
    );
    expect(view.state.doc.toString()).toBe("- [ ] 整理笔记 @");
    expect(view.hasFocus).toBe(true);
  });

  it("closes on an outside click without taking back focus", async () => {
    const { view } = await mount();
    type(view, "@");
    await screen.findByRole("dialog", { name: "选择到期日期" });
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.mouseDown(input);
    input.focus();
    expect(screen.queryByRole("dialog", { name: "选择到期日期" })).toBeNull();
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("does not restore a stale picker when switching back to a cached note", async () => {
    const { view, rendered, onReady } = await mount();
    type(view, "@");
    await screen.findByRole("dialog", { name: "选择到期日期" });
    rendered.rerender(
      <Harness
        content="另一篇笔记"
        documentKey="other-note"
        onReady={onReady}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "选择到期日期" })).toBeNull();
    rendered.rerender(<Harness content="- [ ] 整理笔记 @" onReady={onReady} />);
    expect(screen.queryByRole("dialog", { name: "选择到期日期" })).toBeNull();
  });

  it("adds a separator when @ is typed immediately after task text", async () => {
    const { view } = await mount("- [ ] 整理笔记");
    type(view, "@2026-11-");
    const dialog = await screen.findByRole("dialog", { name: "选择到期日期" });
    fireEvent.click(dialog.querySelector('[data-date="2026-11-20"]')!);
    expect(view.state.doc.toString()).toBe("- [ ] 整理笔记 @2026-11-20");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });
});
