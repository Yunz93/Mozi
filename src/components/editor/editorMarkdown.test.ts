/** @vitest-environment happy-dom */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { markdownHighlightStyle } from "./decorations";
import { createEditorMarkdownLanguage } from "./editorMarkdown";

function collectNodeNames(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [createEditorMarkdownLanguage()],
  });
  const names: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

function highlightedHtml(doc: string): string {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        createEditorMarkdownLanguage(),
        syntaxHighlighting(markdownHighlightStyle),
      ],
    }),
  });
  const html = view.contentDOM.innerHTML;
  view.destroy();
  parent.remove();
  return html;
}

describe("createEditorMarkdownLanguage", () => {
  it("does not parse a paragraph followed by a lone hyphen as a setext heading", () => {
    const names = collectNodeNames(
      "墨知提供了两种便捷的博客发布方式：微信公众号 + Simple Blog, 其中:\n-",
    );
    expect(names.some((name) => name.startsWith("SetextHeading"))).toBe(false);
  });

  it("does not parse a paragraph followed by hyphen-plus-space as a setext heading", () => {
    const names = collectNodeNames("正文内容\n- ");
    expect(names.some((name) => name.startsWith("SetextHeading"))).toBe(false);
  });

  it("does not parse foo\\n--- as a setext heading", () => {
    const names = collectNodeNames("foo\n---");
    expect(names.some((name) => name.startsWith("SetextHeading"))).toBe(false);
    expect(names).toContain("HorizontalRule");
  });

  it("does not parse foo\\n=== as a setext heading", () => {
    const names = collectNodeNames("foo\n===");
    expect(names.some((name) => name.startsWith("SetextHeading"))).toBe(false);
  });

  it("still parses ATX headings", () => {
    const names = collectNodeNames("# heading1\n\n## heading2");
    expect(names).toContain("ATXHeading1");
    expect(names).toContain("ATXHeading2");
  });

  it("still parses a bullet list after a paragraph once the item has text", () => {
    const names = collectNodeNames("其中:\n- Simple Blog");
    expect(names.some((name) => name.startsWith("SetextHeading"))).toBe(false);
    expect(names).toContain("BulletList");
  });

  it("does not apply heading highlight classes to a paragraph plus list hyphen", () => {
    const html = highlightedHtml(
      "墨知提供了两种便捷的博客发布方式：微信公众号 + Simple Blog, 其中:\n-",
    );
    expect(html).not.toContain("mp-tok-heading");
  });

  it("still applies heading highlight classes to ATX headings", () => {
    const html = highlightedHtml("# 标题");
    expect(html).toContain("mp-tok-heading-1");
  });

  it("does not parse subscript / superscript into syntax nodes", () => {
    const names = collectNodeNames("H~2~O and X^2^");
    expect(names).not.toContain("Subscript");
    expect(names).not.toContain("Superscript");
  });
});
