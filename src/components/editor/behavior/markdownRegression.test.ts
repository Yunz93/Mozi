// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { EditorState, type StateCommand } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentUnit, syntaxTree } from "@codemirror/language";
import { history, undo, redo } from "@codemirror/commands";
import { createEditorMarkdownLanguage } from "@/components/editor/editorMarkdown";
import {
  handleSmartEnter,
  createHandleSmartTab,
  createHandleSmartShiftTab,
  handleSmartBackspace,
  handleStructuredPaste,
} from "@/components/editor/behavior/input";
import {
  toggleInlineCode,
  toggleBold,
} from "@/components/editor/behavior/commands/inline";
import { insertTableRowBelow } from "@/components/editor/behavior/tables";
import { renderMarkdown } from "@/utils/markdown";
import { isInsideFencedCode } from "@/components/editor/behavior/core";
import { getStrictOrderedListNormalizationChanges } from "./nestedListBehavior";
import { findClickableEditorLinkAt } from "../livePreview/clickableLinks";

function state(doc: string, pos = doc.length, head = pos, unit = "    ") {
  return EditorState.create({
    doc,
    selection: { anchor: pos, head },
    extensions: [
      createEditorMarkdownLanguage(),
      indentUnit.of(unit),
      EditorState.tabSize.of(unit === "  " ? 2 : 4),
      history(),
    ],
  });
}
function run(before: EditorState, cmd: StateCommand) {
  let next = before;
  const handled = cmd({
    state: before,
    dispatch: (tr) => {
      next = tr.state;
    },
  });
  expect(handled).toBe(true);
  return next;
}
function html(doc: string) {
  const host = document.createElement("div");
  host.innerHTML = renderMarkdown(doc);
  return host;
}
const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
});
function view(before: EditorState) {
  const v = new EditorView({ state: before, parent: document.body });
  views.push(v);
  return v;
}
function paste(text: string) {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  return new ClipboardEvent("paste", { clipboardData: data });
}

describe("independent edit edge probes", () => {
  it("keeps a fake closing fence with info text inside the existing fenced block", () => {
    const doc = "```markdown\n```not-a-close\n- literal\n```";
    const pos = doc.indexOf("- literal") + "- literal".length;
    const before = state(doc, pos);
    expect(syntaxTree(before).toString()).toContain("FencedCode");
    const after = run(before, handleSmartEnter);
    expect(after.doc.toString()).toBe(
      "```markdown\n```not-a-close\n- literal\n\n```",
    );
  });
  it("does not continue list markers inside a blockquote fenced code block", () => {
    const doc = "> ```text\n> - literal\n> ```";
    const pos = doc.indexOf("- literal") + "- literal".length;
    const before = state(doc, pos);
    expect(syntaxTree(before).toString()).toContain("FencedCode");
    const after = run(before, handleSmartEnter);
    expect(after.doc.toString()).toBe("> ```text\n> - literal\n> \n> ```");
  });
  it("outdents one configured two-space level outside code", () => {
    let before = state("word", 0, 0, "  ");
    before = run(before, createHandleSmartTab("strict"));
    before = run(before, createHandleSmartTab("strict"));
    expect(before.doc.toString()).toBe("    word");
    const after = run(before, createHandleSmartShiftTab("strict"));
    expect(after.doc.toString()).toBe("  word");
  });
  it("outdents one configured two-space level inside code", () => {
    const doc = "```\n    const x = 1;\n```";
    const pos = doc.indexOf("const");
    const after = run(
      state(doc, pos, pos, "  "),
      createHandleSmartShiftTab("strict"),
    );
    expect(after.doc.toString()).toBe("```\n  const x = 1;\n```");
  });
  it("keeps the caret at content start after removing a quote marker with Backspace", () => {
    const after = run(state("> hello", 2), handleSmartBackspace);
    expect(after.doc.toString()).toBe("hello");
    expect(after.selection.main.head).toBe(0);
  });
  it("restores the original selected text when bold is toggled twice", () => {
    const original = state("foo", 0, 3);
    const once = run(original, toggleBold);
    expect(once.doc.toString()).toBe("**foo**");
    const twice = run(once, toggleBold);
    expect(twice.doc.toString()).toBe("foo");
  });
  it("quotes selected literal backticks as one inline-code span", () => {
    const text = "name`part";
    const after = run(state(text, 0, text.length), toggleInlineCode);
    const rendered = html(after.doc.toString());
    expect(rendered.querySelectorAll("code")).toHaveLength(1);
    expect(rendered.querySelector("code")?.textContent).toBe(text);
  });
  it("preserves literal backslashes in table inline-code cells across row insertion", () => {
    const doc = "| path | label |\n| --- | --- |\n| `C:\\Temp\\notes` | x |";
    const pos = doc.indexOf("C:");
    const before = html(doc).querySelector("code")?.textContent;
    expect(before).toBe("C:\\Temp\\notes");
    const after = run(state(doc, pos), insertTableRowBelow);
    expect(html(after.doc.toString()).querySelector("code")?.textContent).toBe(
      before,
    );
  });
  it("recognizes a one-column table produced by the table picker", () => {
    const doc = "| only |\n| --- |\n| value |";
    const pos = doc.indexOf("value");
    expect(html(doc).querySelectorAll("table")).toHaveLength(1);
    const before = state(doc, pos);
    const after = run(before, createHandleSmartTab("strict"));
    expect(after.doc.toString()).toBe(doc + "\n|  |");
  });
  it("pastes a URL with an unmatched closing parenthesis without truncating the destination", () => {
    const v = view(state("link", 0, 4));
    const url = "https://example.com/a)b";
    expect(handleStructuredPaste(v, paste(url))).toBe(true);
    expect(
      html(v.state.doc.toString()).querySelector("a")?.getAttribute("href"),
    ).toBe(url);
  });
  it("preserves Unicode selection across bold formatting and Undo/Redo", () => {
    const doc = "前😀é后";
    const before = state(doc, 1, doc.length - 1);
    const after = run(before, toggleBold);
    expect(after.doc.toString()).toBe("前**😀é**后");
    const undone = run(after, undo);
    expect(undone.doc.toString()).toBe(doc);
    const redone = run(undone, redo);
    expect(redone.doc.toString()).toBe(after.doc.toString());
  });
  it("restores the full original document after undoing a table mutation", () => {
    const doc = "before\n\n| x | y |\n| --- | --- |\n| 😄 | 中文 |\n\nafter";
    const pos = doc.indexOf("😄");
    const changed = run(state(doc, pos), insertTableRowBelow);
    const undone = run(changed, undo);
    expect(undone.doc.toString()).toBe(doc);
  });
});

it.each([
  [
    "```markdown\n> example\n- literal\n```",
    "```markdown\n> example\n- literal\n\n```",
  ],
  [
    "> ```markdown\n> > example\n> - literal\n> ```",
    "> ```markdown\n> > example\n> - literal\n> \n> ```",
  ],
  ["```text\n    ```\n- literal\n```", "```text\n    ```\n- literal\n\n```"],
  ["- ```text\n  - literal\n  ```", "- ```text\n  - literal\n  \n  ```"],
])(
  "keeps code literal under container and fence variations: %s",
  (doc, expected) => {
    const pos = doc.indexOf("- literal") + "- literal".length;
    const before = state(doc, pos);
    let node = syntaxTree(before).resolveInner(pos, -1);
    while (node.parent && node.name !== "FencedCode") node = node.parent;
    expect(node.name).toBe("FencedCode");
    expect(run(before, handleSmartEnter).doc.toString()).toBe(expected);
  },
);

it.each([
  "``",
  "`",
  "```literal``",
  "name`part",
  "a`b``c",
  " foo ",
  "`foo",
  "bar`",
])("preserves literal code and toggles it back: %s", (text) => {
  const once = run(state(text, 0, text.length), toggleInlineCode);
  expect(html(once.doc.toString()).querySelector("code")?.textContent).toBe(
    text,
  );
  expect(run(once, toggleInlineCode).doc.toString()).toBe(text);
});

it("formats a large selection without spreading matches onto the call stack", () => {
  const text = "a`".repeat(150000) + "a";
  const after = run(state(text, 0, text.length), toggleInlineCode);
  expect(html(after.doc.toString()).querySelector("code")?.textContent).toBe(
    text,
  );
});

it.each([
  "`C:\\Temp`",
  "``C:\\Temp ` x``",
  "\\`C:\\Temp\\`",
  "a\\*b",
  "`a\\|b`",
  "`\\\\|`",
  "a\\\\",
])("preserves table cell rendering across a structural edit: %s", (cell) => {
  const doc = "| A | B |\n| --- | --- |\n| " + cell + " | keep |";
  const original = html(doc).querySelector("tbody td")?.innerHTML;
  expect(original).toBeTruthy();
  const after = run(
    state(doc, doc.lastIndexOf("| keep") - 1),
    insertTableRowBelow,
  );
  expect(html(after.doc.toString()).querySelector("tbody td")?.innerHTML).toBe(
    original,
  );
});

it.each([false, true])(
  "keeps a parenthesized URL clickable in Live and Reading, selection=%s",
  (selected) => {
    const url = "https://example.com/a)b";
    const v = view(state("link", 0, selected ? 4 : 0));
    expect(handleStructuredPaste(v, paste(url))).toBe(true);
    const doc = v.state.doc.toString();
    expect(html(doc).querySelector("a")?.getAttribute("href")).toBe(url);
    expect(findClickableEditorLinkAt(doc, 1)).toEqual({
      kind: "href",
      href: url,
    });
  },
);

it.each([
  "```text\n1. literal one\n9. literal nine\n```",
  "> ```text\n> 1. literal one\n> 9. literal nine\n> ```",
  "- ```text\n  1. literal one\n  9. literal nine\n  ```",
  "    1. literal one\n    9. literal nine",
  "1. parent\n\n        9. literal one\n        8. literal two\n\n2. outside",
])(
  "does not normalize code markers or count them as external list items: %s",
  (doc) => {
    const source = doc + "\n\n1. actual one\n8. actual two";
    const before = state(source);
    const changes = getStrictOrderedListNormalizationChanges(before);
    expect(changes).not.toBeNull();
    expect(before.update({ changes: changes! }).state.doc.toString()).toBe(
      doc + "\n\n1. actual one\n2. actual two",
    );
  },
);
