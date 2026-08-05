/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreviewContextFacet } from "./context";
import { buildMathDecorations, livePreviewMath } from "./math";
import { buildMermaidDecorations, livePreviewMermaid } from "./mermaid";
import { buildCalloutDecorations, livePreviewCallouts } from "./callouts";
import { buildTableDecorations, livePreviewTables } from "./tables";
import { selectionAffectsCoverage } from "./shared";
import { getLivePreviewOptimizationMode, softOffReason } from "./softOff";
import { LARGE_FILE_THRESHOLDS } from "../../../utils/performance";

function docWithLines(lineCount: number, line = "x"): string {
  return Array.from({ length: lineCount }, () => line).join("\n");
}

function createState(
  doc: string,
  cursor = 0,
  extras: import("@codemirror/state").Extension[] = [],
) {
  return EditorState.create({
    doc,
    selection: { anchor: Math.min(cursor, doc.length) },
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
  });
}

describe("live preview soft-off boundaries", () => {
  it("classifies 1999/2001 and 4999/5001 line thresholds", () => {
    expect(
      getLivePreviewOptimizationMode(
        createState(
          docWithLines(LARGE_FILE_THRESHOLDS.LIVE_PREVIEW_HEAVY_LINE_COUNT),
        ),
      ),
    ).toBe("normal");
    expect(
      getLivePreviewOptimizationMode(
        createState(
          docWithLines(LARGE_FILE_THRESHOLDS.LIVE_PREVIEW_HEAVY_LINE_COUNT + 1),
        ),
      ),
    ).toBe("heavy");
    expect(
      getLivePreviewOptimizationMode(
        createState(docWithLines(LARGE_FILE_THRESHOLDS.LINE_COUNT)),
      ),
    ).toBe("heavy");
    expect(
      getLivePreviewOptimizationMode(
        createState(docWithLines(LARGE_FILE_THRESHOLDS.LINE_COUNT + 1)),
      ),
    ).toBe("large");
  });

  it("does not silently return empty for heavy tables/callouts/mermaid", () => {
    // Put mermaid/callout/table near the start so syntax tree parse covers them
    // even when the rest of the document is long.
    const heavyDoc =
      "```mermaid\nflowchart TD\n  A-->B\n```\n\n> [!note] Title\n> body\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n" +
      docWithLines(
        LARGE_FILE_THRESHOLDS.LIVE_PREVIEW_HEAVY_LINE_COUNT + 1,
        "para",
      );
    const state = createState(heavyDoc, heavyDoc.length - 1);
    expect(softOffReason("heavy", "table")).toBeTruthy();

    const tables = buildTableDecorations(state);
    let tableSoftOff = 0;
    tables.between(0, state.doc.length, (_f, _t, value) => {
      const widget = value.spec.widget as { kind?: string } | undefined;
      if (widget && "kind" in widget && widget.kind === "table") {
        tableSoftOff += 1;
      }
    });
    expect(tableSoftOff).toBeGreaterThan(0);

    const callouts = buildCalloutDecorations(state);
    expect(callouts.decorations.size).toBeGreaterThan(0);
    expect(callouts.coverage.length).toBeGreaterThan(0);

    const mermaid = buildMermaidDecorations(state);
    expect(mermaid.coverage.length).toBeGreaterThan(0);
    expect(mermaid.decorations.size).toBeGreaterThan(0);
  });

  it("large mode keeps math decorations empty but exposes a documented reason", () => {
    const largeDoc =
      docWithLines(LARGE_FILE_THRESHOLDS.LINE_COUNT + 1) + "\n\n$E=mc^2$\n";
    const state = createState(largeDoc, largeDoc.length - 1);
    expect(getLivePreviewOptimizationMode(state)).toBe("large");
    expect(softOffReason("large", "math")).toMatch(/Large-file mode/i);
    const math = buildMathDecorations(state);
    expect(math.decorations.size).toBe(0);
  });
});

describe("live preview block selection gating", () => {
  it("selectionAffectsCoverage detects enter/leave", () => {
    const doc = "aa $x$ bb";
    const start = createState(doc, 0);
    const next = createState(doc, 4);
    const coverage = [{ from: 3, to: 6 }];
    expect(selectionAffectsCoverage(start, next, coverage)).toBe(true);
    expect(selectionAffectsCoverage(next, next, coverage)).toBe(false);
  });

  it("math coverage includes selection-suppressed holes", () => {
    const doc = "before $E=mc^2$ after";
    const mathFrom = doc.indexOf("$");
    const mathTo = doc.lastIndexOf("$") + 1;
    const away = createState(doc, doc.length - 1);
    const inside = createState(doc, mathFrom + 2);

    const awayBuild = buildMathDecorations(away);
    expect(awayBuild.coverage).toEqual([{ from: mathFrom, to: mathTo }]);
    expect(awayBuild.decorations.size).toBe(1);

    const insideBuild = buildMathDecorations(inside);
    expect(insideBuild.coverage).toEqual([{ from: mathFrom, to: mathTo }]);
    expect(insideBuild.decorations.size).toBe(0);
  });

  it("mounts math/mermaid/callouts/tables without crashing on selection", () => {
    const doc =
      "$a$\n\n```mermaid\nflowchart TD\n  A-->B\n```\n\n> [!tip] Hi\n> body\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createState(doc, doc.length - 1, [
      livePreviewMath,
      livePreviewMermaid,
      livePreviewCallouts,
      livePreviewTables,
    ]);
    const view = new EditorView({ state, parent });
    view.dispatch({ selection: { anchor: 1 } });
    view.dispatch({ selection: { anchor: doc.length - 1 } });
    expect(view.state.doc.length).toBe(doc.length);
    view.destroy();
    parent.remove();
  });
});
