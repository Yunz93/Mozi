/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  livePreviewShouldRebuild,
  selectionAffectsCoverage,
  shouldRebuildLivePreviewDecorations,
  ViewportDecorationWindow,
  getLivePreviewDecorationRange,
} from "./shared";

describe("livePreviewShouldRebuild", () => {
  it("rebuilds marks on any selection change, but not widgets on same-line caret moves", () => {
    const start = EditorState.create({
      doc: "hello world\n\nmore",
      selection: { anchor: 1 },
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: start, parent });
    view.dispatch({ selection: { anchor: 3 } });
    const shim = {
      docChanged: false,
      viewportChanged: false,
      selectionSet: true,
      startState: start,
      state: view.state,
    } as never;
    expect(livePreviewShouldRebuild(shim, "marks")).toBe(true);
    expect(livePreviewShouldRebuild(shim, "widgets")).toBe(false);
    view.destroy();
    parent.remove();
  });

  it("rebuilds widgets when the caret crosses a line", () => {
    const start = EditorState.create({
      doc: "hello world\n\nmore",
      selection: { anchor: 1 },
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: start, parent });
    view.dispatch({ selection: { anchor: 14 } });
    const shim = {
      docChanged: false,
      viewportChanged: false,
      selectionSet: true,
      startState: start,
      state: view.state,
    } as never;
    expect(livePreviewShouldRebuild(shim, "widgets")).toBe(true);
    view.destroy();
    parent.remove();
  });

  it("does not treat viewportChanged alone as a content rebuild", () => {
    const start = EditorState.create({
      doc: "hello world\n\nmore",
      selection: { anchor: 1 },
    });
    const shim = {
      docChanged: false,
      viewportChanged: true,
      selectionSet: false,
      startState: start,
      state: start,
    } as never;
    expect(livePreviewShouldRebuild(shim, "marks")).toBe(false);
    expect(livePreviewShouldRebuild(shim, "widgets")).toBe(false);
  });
});

describe("ViewportDecorationWindow", () => {
  it("skips rebuild while the viewport stays inside the padded window", () => {
    const doc = "a\n".repeat(400);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: 0 } }),
      parent,
    });
    const window = new ViewportDecorationWindow(500);
    window.mark(view);

    const stay = {
      docChanged: false,
      viewportChanged: true,
      selectionSet: false,
      startState: view.state,
      state: view.state,
      view,
    } as never;
    expect(shouldRebuildLivePreviewDecorations(stay, "marks", window)).toBe(
      false,
    );

    view.destroy();
    parent.remove();
  });

  it("build range matches the marked decoration window pad", () => {
    const doc = `${"x".repeat(100)}\n`.repeat(80);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: 0 } }),
      parent,
    });
    const window = new ViewportDecorationWindow();
    window.mark(view);
    const buildRange = getLivePreviewDecorationRange(view);
    expect(buildRange).toEqual(window.range);
    expect(buildRange.to - buildRange.from).toBeGreaterThan(
      (view.visibleRanges[0]?.to ?? 0) - (view.visibleRanges[0]?.from ?? 0),
    );

    view.destroy();
    parent.remove();
  });
});

describe("selectionAffectsCoverage", () => {
  it("is false for caret nudges outside coverage", () => {
    const doc = "hello $x$ world";
    const start = EditorState.create({
      doc,
      selection: { anchor: 0 },
    });
    const next = EditorState.create({
      doc,
      selection: { anchor: 2 },
    });
    expect(selectionAffectsCoverage(start, next, [{ from: 6, to: 9 }])).toBe(
      false,
    );
  });
});
