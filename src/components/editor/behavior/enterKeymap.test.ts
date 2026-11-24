/** @vitest-environment happy-dom */

import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import { createEditorMarkdownLanguage } from "../editorMarkdown";
import { createMarkdownKeyBindings } from "./index";
import { defaultKeymapWithoutEnter, editorImeGuardPlugin } from "./imeGuard";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.remove();
  }
});

function mount(doc: string, anchor: number, head = anchor) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [
        createEditorMarkdownLanguage(),
        history(),
        editorImeGuardPlugin,
        keymap.of(defaultKeymapWithoutEnter()),
        Prec.high(keymap.of(createMarkdownKeyBindings("strict"))),
      ],
    }),
  });
  views.push(view);
  return view;
}

function pressEnter(view: EditorView, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("Enter keymap owns plain text newlines", () => {
  it.each([
    {
      name: "paragraph end",
      doc: "第一段",
      anchor: 3,
      expected: "第一段\n",
      caret: 4,
    },
    {
      name: "between paragraphs",
      doc: "第一段\n\n第二段",
      anchor: 3,
      expected: "第一段\n\n\n第二段",
      caret: 4,
    },
    {
      name: "blank line",
      doc: "第一段\n\n第二段",
      anchor: 4,
      expected: "第一段\n\n\n第二段",
      caret: 5,
    },
    {
      name: "paragraph middle",
      doc: "第一段文字",
      anchor: 3,
      expected: "第一段\n文字",
      caret: 4,
    },
    {
      name: "between brackets in prose",
      doc: "正文 ()",
      anchor: 4,
      expected: "正文 (\n)",
      caret: 5,
    },
    {
      name: "before spaces in prose",
      doc: "正文  后续文字",
      anchor: 2,
      expected: "正文\n  后续文字",
      caret: 3,
    },
    {
      name: "selection",
      doc: "第一段文字",
      anchor: 1,
      head: 4,
      expected: "第\n字",
      caret: 2,
    },
    {
      name: "backward selection",
      doc: "第一段文字",
      anchor: 4,
      head: 1,
      expected: "第\n字",
      caret: 2,
    },
  ])(
    "inserts one newline at $name and undoes in one step",
    ({ doc, anchor, head, expected, caret }) => {
      const view = mount(doc, anchor, head);
      expect(view.state.selection.main.anchor).toBe(anchor);
      expect(view.state.selection.main.head).toBe(head ?? anchor);
      const event = pressEnter(view);

      expect(view.state.doc.toString()).toBe(expected);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.selection.main.head).toBe(caret);
      expect(view.state.selection.main.empty).toBe(true);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
    },
  );

  it("keeps the editor focused after inserting a newline", () => {
    const view = mount("正文", 2);
    view.focus();
    expect(pressEnter(view).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("正文\n");
    expect(view.hasFocus).toBe(true);
  });

  it.each([
    ["- item", "- item\n- "],
    ["> quote", "> quote\n> "],
    ["# heading", "# heading\n"],
    ["```text\n  code", "```text\n  code\n  "],
  ])("keeps smart continuation for %s", (doc, expected) => {
    const view = mount(doc, doc.length);
    expect(pressEnter(view).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  });

  it("keeps Shift-Enter as a single newline", () => {
    const view = mount("正文", 2);
    expect(pressEnter(view, true).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("正文\n");
  });

  it("does not add a newline for the Enter confirming an IME candidate", () => {
    const view = mount("正文", 2);
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(pressEnter(view).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("正文");
  });
});
