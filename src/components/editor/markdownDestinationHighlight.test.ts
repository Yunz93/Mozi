/** @vitest-environment happy-dom */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, afterEach } from "vitest";
import { buildSpacedDestinationDecorations } from "./markdownDestinationHighlight";

function mount(doc: string) {
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("markdownDestinationHighlight", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views) view.destroy();
    views.length = 0;
  });

  it("marks the full destination after a space in a remote image URL", () => {
    const doc =
      "![M 記](https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1.png)";
    const view = mount(doc);
    views.push(view);
    const deco = buildSpacedDestinationDecorations(view);
    let marked = "";
    deco.between(0, doc.length, (from, to) => {
      marked = doc.slice(from, to);
    });
    expect(marked).toBe(
      "https://raw.githubusercontent.com/Yunz93/PicRepo/main/image/M 記-1.png",
    );
    let destClass = "";
    deco.between(0, doc.length, (_from, _to, value) => {
      destClass = String(value.spec.class ?? "");
    });
    expect(destClass).toContain("cm-md-link-dest");
  });

  it("marks a CJK destination after a leading space in the parens", () => {
    const doc = "![M 記]( 記-1776170252301.png)";
    const view = mount(doc);
    views.push(view);
    const deco = buildSpacedDestinationDecorations(view);
    let marked = "";
    deco.between(0, doc.length, (from, to) => {
      marked = doc.slice(from, to);
    });
    expect(marked).toBe("記-1776170252301.png");
  });
});
