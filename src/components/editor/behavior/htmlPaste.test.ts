/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tryConvertHtmlPaste } from "./htmlPaste";

function viewWithDoc(doc: string, anchor: number): EditorView {
  const parent = document.createElement("div");
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
    }),
    parent,
  });
}

function htmlPasteEvent(html: string, plain = ""): ClipboardEvent {
  const data = new DataTransfer();
  data.setData("text/html", html);
  if (plain) data.setData("text/plain", plain);
  return new ClipboardEvent("paste", {
    clipboardData: data as unknown as DataTransfer,
  });
}

describe("tryConvertHtmlPaste", () => {
  it("inserts HTML as Markdown without doubling backslashes", () => {
    const view = viewWithDoc("", 0);
    const ev = htmlPasteEvent(
      "<p>curl https://example.com \\</p>",
      "curl https://example.com \\",
    );
    expect(tryConvertHtmlPaste(view, ev)).toBe(true);
    expect(view.state.doc.toString()).toBe("curl https://example.com \\");
  });

  it("does not convert HTML inside a fenced code block", () => {
    const doc = "```\n\n```";
    const view = viewWithDoc(doc, 4);
    const ev = htmlPasteEvent(
      "<p>curl https://example.com \\</p>",
      "curl https://example.com \\",
    );
    expect(tryConvertHtmlPaste(view, ev)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("does not convert HTML inside YAML frontmatter", () => {
    const doc = "---\ntitle: x\n---\n";
    const view = viewWithDoc(doc, 10);
    const ev = htmlPasteEvent("<p>C:\\Users</p>", "C:\\Users");
    expect(tryConvertHtmlPaste(view, ev)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
