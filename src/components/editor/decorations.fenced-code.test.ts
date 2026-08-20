/** @vitest-environment happy-dom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import {
  fencedCodeDecorations,
  markdownHighlightStyle,
  markdownListDecorations,
} from "./decorations";
import { resolveEditorCodeLanguage } from "../../utils/editorCodeLanguages";

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ codeLanguages: resolveEditorCodeLanguage }),
        fencedCodeDecorations,
        syntaxHighlighting(markdownHighlightStyle),
      ],
    }),
    parent,
  });
}

describe("fencedCodeDecorations", () => {
  it("marks existing fenced code lines on initial render", () => {
    const view = createView("```java\nclass A {}\n```");

    const lines = Array.from(view.dom.querySelectorAll(".cm-line"));
    expect(
      lines.some((line) =>
        line.classList.contains("cm-fenced-code-line-start"),
      ),
    ).toBe(true);
    expect(
      lines.some((line) => line.classList.contains("cm-fenced-code-line-body")),
    ).toBe(true);
    expect(
      lines.some((line) => line.classList.contains("cm-fenced-code-line-end")),
    ).toBe(true);

    view.destroy();
  });
});

describe("markdownListDecorations", () => {
  it("does not draw indentation guide lines for nested lists", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "1. parent\n   1. child\n      1. grandchild",
        extensions: [markdownListDecorations],
      }),
      parent: document.createElement("div"),
    });

    expect(view.dom.querySelector(".cm-markdown-list-line")).toBeNull();
    expect(view.dom.querySelector(".cm-markdown-list-marker")).not.toBeNull();

    view.destroy();
  });

  it("keeps editor content inset in list hang padding-left", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "1. 列表正文",
        extensions: [markdownListDecorations],
      }),
      parent: document.createElement("div"),
    });

    const plugin = view.plugin(markdownListDecorations);
    const hangStyles: string[] = [];
    plugin?.decorations.between(
      0,
      view.state.doc.length,
      (_from, _to, value) => {
        const style = value.spec?.attributes?.style;
        if (typeof style === "string" && style.includes("padding-left")) {
          hangStyles.push(style);
        }
      },
    );

    expect(hangStyles.length).toBeGreaterThan(0);
    expect(hangStyles[0]).toContain("var(--pane-content-px");
    expect(hangStyles[0]).toContain("var(--mp-editor-list-hang-em-per-char");

    view.destroy();
  });
});

describe("editor fenced-code selection styles", () => {
  it("keeps fenced code chrome as opaque as Reading", () => {
    const css = readFileSync(
      resolve(__dirname, "../../styles/editor.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.editor-pane-layout\s+\.cm-fenced-code-line\s*\{[^}]*isolation:\s*isolate/s,
    );
    expect(css).toMatch(
      /\.editor-pane-layout\s+\.cm-fenced-code-line::before\s*\{[^}]*background-color:\s*var\(--editor-code-block-bg\)/s,
    );
    expect(css).toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*z-index:\s*-1/s,
    );
    expect(css).not.toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*z-index:\s*-2/s,
    );
    expect(css).not.toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*color-mix\([^)]*--editor-code-block-bg/s,
    );
    expect(css).toMatch(
      /\.cm-fenced-code-line::selection[\s\S]*?--mp-doc-selection/s,
    );
    expect(css).toMatch(
      /\.cm-fenced-code-line \.tok-inline-code[\s\S]*?background:\s*none/s,
    );
    expect(css).toMatch(
      /\.editor-pane-layout\s+\.cm-fenced-code-line::before\s*\{[^}]*left:\s*var\(--pane-content-px\)/s,
    );
    expect(css).toMatch(
      /\.editor-pane-layout\s+\.cm-content\s*\{[^}]*padding:\s*var\(--pane-content-top\)\s+0/s,
    );
    expect(css).toMatch(
      /\.editor-pane-layout\s+\.cm-line\s*\{[^}]*padding-left:\s*var\(--pane-content-px\)/s,
    );
  });

  it("hides native ::selection on Live Preview block widgets", () => {
    const css = readFileSync(
      resolve(__dirname, "../../styles/editor.css"),
      "utf8",
    );

    // Block widgets are siblings of `.cm-line`; CM only clears selection on lines.
    expect(css).toMatch(
      /\.cm-content\s*>\s*:not\(\.cm-line\)::selection[\s\S]*?background:\s*transparent\s*!important/,
    );
    expect(css).toMatch(
      /\.cm-content\s*>\s*:not\(\.cm-line\)\s+\*::selection[\s\S]*?background:\s*transparent\s*!important/,
    );
    expect(css).toMatch(
      /\[contenteditable="true"\]:focus::selection[\s\S]*?--mp-doc-selection/,
    );
  });
});
