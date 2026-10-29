// @vitest-environment happy-dom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import React, { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import {
  renderHook,
  cleanup,
  render,
  waitFor,
  act,
} from "@testing-library/react";
import { useCodeMirror } from "./useCodeMirror";
import { renderMarkdown, clearMarkdownCache } from "@/utils/markdown";
import { createShikiHighlighter } from "@/hooks/useShikiHighlighter";
import { usePreviewRenderer } from "@/components/editor/hooks/usePreviewRenderer";
function html(source: string) {
  const el = document.createElement("div");
  el.innerHTML = source;
  return el;
}
beforeEach(() => clearMarkdownCache());
afterEach(() => cleanup());
it("renders a changed equal-length tail beyond 10k through the real preview hook", () => {
  const prefix = "a".repeat(10000) + "\n\n";
  const hook = renderHook(
    ({ content }) =>
      usePreviewRenderer({
        content,
        files: [],
        fileContents: {},
        readFile: async () => "",
        isMarkdownPreview: true,
        isHtmlPreview: false,
        enabled: true,
      }),
    { initialProps: { content: prefix + "OLD" } },
  );
  expect(hook.result.current.parsedContent.bodyHTML).toContain("OLD");
  hook.rerender({ content: prefix + "NEW" });
  expect(hook.result.current.parsedContent.bodyHTML).toContain("NEW");
});
it("preserves text following a same-line display-math closer", () => {
  const out = renderMarkdown("$$x$$ tail\n\nnext");
  expect(html(out).textContent).toContain("next");
  expect(html(out).textContent).toContain("tail");
  expect(html(out).textContent).toContain("$$x$$ tail");
  expect(html(out).querySelector(".katex")).toBeNull();
  expect(html(renderMarkdown("$x$")).querySelector(".katex")).not.toBeNull();
});
it("preserves first-line indentation with the real configured Shiki highlighter", async () => {
  const highlighter = await createShikiHighlighter();
  expect(highlighter).not.toBeNull();
  const code = "    return value";
  const out = renderMarkdown("```python\n" + code + "\n```", { highlighter });
  const host = html(out);
  expect(host.querySelector("pre.shiki")).not.toBeNull();
  expect(host.querySelector("pre code")?.textContent).toBe(code + "\n");
}, 20000);
it("refreshes long previews when the tail changes length (control)", () => {
  const prefix = "a".repeat(10000) + "\n\n";
  renderMarkdown(prefix + "OLD");
  expect(renderMarkdown(prefix + "NEW!")).toContain("NEW!");
});
it("preserves code indentation without Shiki (control)", () => {
  expect(
    html(renderMarkdown("```python\n    return value\n```")).querySelector(
      "pre code",
    )?.textContent,
  ).toBe("    return value\n");
});

it("does not reuse cached HTML when different sources have the same hash", () => {
  expect(html(renderMarkdown("Aa")).textContent?.trim()).toBe("Aa");
  expect(html(renderMarkdown("BB")).textContent?.trim()).toBe("BB");
});

it("does not renumber literal code after typing elsewhere in strict mode", async () => {
  const doc =
    "```text\n1. literal one\n9. literal nine\n```\n\n1. actual one\n8. actual two\n\noutside";
  let editor: EditorView | null = null;
  function Harness() {
    const cm = useCodeMirror({
      content: doc,
      documentKey: "literal-code",
      orderedListMode: "strict",
      onChange: vi.fn(),
    });
    useEffect(() => {
      editor = cm.view;
    }, [cm.view]);
    return <div ref={cm.editorRef} />;
  }
  render(<Harness />);
  await waitFor(() => expect(editor).not.toBeNull());
  act(() =>
    editor!.dispatch({
      changes: { from: editor!.state.doc.length, insert: "x" },
      userEvent: "input.type",
    }),
  );
  await waitFor(() =>
    expect(editor!.state.doc.toString()).toContain("2. actual two"),
  );
  expect(editor!.state.doc.toString()).toBe(
    doc.replace("8. actual two", "2. actual two") + "x",
  );
});

it("routes native paste events through the application URL formatter", async () => {
  let editor: EditorView | null = null;
  function Harness() {
    const cm = useCodeMirror({
      content: "link",
      documentKey: "paste-url",
      onChange: vi.fn(),
    });
    useEffect(() => {
      editor = cm.view;
    }, [cm.view]);
    return <div ref={cm.editorRef} />;
  }
  render(<Harness />);
  await waitFor(() => expect(editor).not.toBeNull());
  act(() => {
    editor!.dispatch({ selection: { anchor: 0, head: 4 } });
    const data = new DataTransfer();
    data.setData("text/plain", "https://example.com/a)b");
    editor!.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  expect(editor!.state.doc.toString()).toBe(
    "[link](<https://example.com/a)b>)",
  );
  expect(
    html(renderMarkdown(editor!.state.doc.toString()))
      .querySelector("a")
      ?.getAttribute("href"),
  ).toBe("https://example.com/a)b");
});
