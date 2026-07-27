/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreviewContextFacet } from "./context";
import { buildMathDecorations, livePreviewMath } from "./math";
import { buildTableDecorations, livePreviewTables } from "./tables";
import { buildCalloutDecorations, livePreviewCallouts } from "./callouts";

function mount(doc: string, extras: import("@codemirror/state").Extension[]) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length - 1 },
      extensions: [
        markdown({ base: markdownLanguage }),
        livePreviewContextFacet.of({
          sourceFilePath: null,
          rootFolderPath: null,
          files: [],
          themeMode: "light",
        }),
        ...extras,
      ],
    }),
    parent,
  });
  return view;
}

describe("live preview incremental block rebuilds", () => {
  it("keeps distant math coverage after an unrelated edit", () => {
    const head = "$a+b$\n\n";
    const mid = "para\n".repeat(40);
    const tail = "\n$$c+d$$\n";
    const doc = head + mid + tail;
    const before = buildMathDecorations(
      EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage }),
          livePreviewContextFacet.of({
            sourceFilePath: null,
            rootFolderPath: null,
            files: [],
          }),
        ],
      }),
    );
    expect(before.coverage.length).toBe(2);

    const view = mount(doc, [livePreviewMath]);
    const insertAt = head.length + 10;
    view.dispatch({
      changes: { from: insertAt, insert: "x" },
      selection: { anchor: insertAt + 1 },
    });

    const after = buildMathDecorations(view.state);
    expect(after.coverage.length).toBe(2);
    view.destroy();
    view.dom.parentElement?.remove();
  });

  it("keeps a distant table after editing far away", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n";
    const filler = "line\n".repeat(30);
    const doc = table + filler + "tail";
    const view = mount(doc, [livePreviewTables]);
    expect(view.dom.querySelector(".cm-live-preview-table")).not.toBeNull();

    const at = doc.length - 1;
    view.dispatch({
      changes: { from: at, insert: "!" },
      selection: { anchor: at + 1 },
    });

    expect(view.dom.querySelector(".cm-live-preview-table")).not.toBeNull();
    expect(buildTableDecorations(view.state).size).toBeGreaterThan(0);
    view.destroy();
    view.dom.parentElement?.remove();
  });

  it("keeps distant callout coverage after an unrelated edit", () => {
    const callout = "> [!note] Title\n> body\n\n";
    const filler = "x\n".repeat(25);
    const doc = callout + filler + "end";
    const before = buildCalloutDecorations(
      EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage }),
          livePreviewContextFacet.of({
            sourceFilePath: null,
            rootFolderPath: null,
            files: [],
            themeMode: "light",
          }),
        ],
      }),
    );
    expect(before.coverage.length).toBeGreaterThan(0);

    const view = mount(doc, [livePreviewCallouts]);
    const at = doc.length - 1;
    view.dispatch({
      changes: { from: at, insert: "y" },
      selection: { anchor: at + 1 },
    });

    const after = buildCalloutDecorations(view.state);
    expect(after.coverage.length).toBeGreaterThan(0);
    view.destroy();
    view.dom.parentElement?.remove();
  });
});
