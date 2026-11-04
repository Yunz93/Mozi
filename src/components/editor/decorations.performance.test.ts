/** @vitest-environment happy-dom */
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  type ViewUpdate,
  type ViewPlugin,
  type DecorationSet,
  type PluginValue,
} from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fencedCodeDecorations, markdownListDecorations } from "./decorations";
import { getLivePreviewDecorationRange } from "./livePreview/shared";

function viewport(state: EditorState, first: number, last: number): EditorView {
  return {
    state,
    visibleRanges: [
      { from: state.doc.line(first).from, to: state.doc.line(last).to },
    ],
  } as unknown as EditorView;
}
function createPlugin<T extends PluginValue>(
  plugin: ViewPlugin<T>,
  view: EditorView,
): T {
  // 测试以受控视口调用真实插件，避免 DOM 模拟器的零尺寸布局影响边界断言。
  return (plugin as unknown as { create(view: EditorView): T }).create(view);
}
function ranges(plugin: { decorations: DecorationSet }) {
  const found: Array<{ from: number; to: number; className: string }> = [];
  plugin.decorations.between(0, 1e9, (from, to, value) => {
    found.push({ from, to, className: String(value.spec.class ?? "") });
  });
  return found;
}
afterEach(() => vi.restoreAllMocks());

describe("editor viewport decoration work", () => {
  it("decorates only the nearby fenced-code window, including a fence that begins above it", () => {
    const doc = Array.from({ length: 1200 }, (_, i) =>
      i % 4 === 0 ? "```ts" : i % 4 === 3 ? "```" : "const n = 1;",
    ).join("\n");
    const state = EditorState.create({ doc, extensions: [markdown()] });
    const view = viewport(state, 601, 610);
    const window = getLivePreviewDecorationRange(view);
    const plugin = createPlugin(fencedCodeDecorations, view);
    const found = ranges(plugin);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((x) => x.className.includes("line-body"))).toBe(true);
    expect(
      found.every(
        (x) =>
          x.from >= state.doc.lineAt(window.from).from && x.from <= window.to,
      ),
    ).toBe(true);
  });
  it("keeps list marks near the viewport and leaves fenced-code lookalikes alone", () => {
    const doc = Array.from({ length: 3000 }, (_, i) => `- list ${i}`).join(
      "\n",
    );
    const state = EditorState.create({ doc });
    const view = viewport(state, 1500, 1510);
    const window = getLivePreviewDecorationRange(view);
    const plugin = createPlugin(markdownListDecorations, view);
    const found = ranges(plugin);
    expect(found.some((x) => x.className === "cm-markdown-list-marker")).toBe(
      true,
    );
    expect(
      found.every(
        (x) =>
          x.from >= state.doc.lineAt(window.from).from && x.from <= window.to,
      ),
    ).toBe(true);
  });
  it("does not rescan every line when only the syntax tree advances", () => {
    const state = EditorState.create({
      doc: Array.from({ length: 4000 }, (_, i) => `- list ${i}`).join("\n"),
      extensions: [markdown()],
    });
    const view = viewport(state, 2000, 2010);
    const plugin = createPlugin(markdownListDecorations, view);
    const next = EditorState.create({
      doc: state.doc,
      extensions: [markdown()],
    });
    const nextView = viewport(next, 2000, 2010);
    const line = vi.spyOn(state.doc, "line");
    plugin.update({
      startState: state,
      state: next,
      view: nextView,
      docChanged: false,
      viewportChanged: false,
    } as ViewUpdate);
    expect(line.mock.calls.length).toBe(0);
    expect(
      ranges(plugin).some((x) => x.className === "cm-markdown-list-marker"),
    ).toBe(true);
  });
  it("updates marks after scrolling outside the padded window without rescanning the document", () => {
    const state = EditorState.create({
      doc: Array.from({ length: 4000 }, (_, i) => `- list ${i}`).join("\n"),
    });
    const plugin = createPlugin(
      markdownListDecorations,
      viewport(state, 10, 20),
    );
    const line = vi.spyOn(state.doc, "line");
    const nextView = viewport(state, 3000, 3010);
    plugin.update({
      startState: state,
      state,
      view: nextView,
      docChanged: false,
      viewportChanged: true,
    } as ViewUpdate);
    const found = ranges(plugin);
    const window = getLivePreviewDecorationRange(nextView);
    expect(found.some((x) => x.from >= state.doc.line(3000).from)).toBe(true);
    expect(
      found.every(
        (x) =>
          x.from >= state.doc.lineAt(window.from).from && x.from <= window.to,
      ),
    ).toBe(true);
    expect(line.mock.calls.length).toBeLessThan(state.doc.lines / 2);
  });
  it("refreshes fence membership after a text edit", () => {
    const state = EditorState.create({ doc: "```\n- code\n```\n- visible" });
    const plugin = createPlugin(markdownListDecorations, viewport(state, 1, 4));
    expect(
      ranges(plugin)
        .filter((x) => x.className === "cm-markdown-list-marker")
        .map((x) => x.from),
    ).toEqual([state.doc.line(4).from]);
    const transaction = state.update({
      changes: { from: 0, to: 3, insert: "text" },
    });
    const next = transaction.state;
    plugin.update({
      startState: state,
      state: next,
      view: viewport(next, 1, 4),
      docChanged: true,
      viewportChanged: false,
    } as ViewUpdate);
    expect(
      ranges(plugin)
        .filter((x) => x.className === "cm-markdown-list-marker")
        .map((x) => x.from),
    ).toEqual([next.doc.line(2).from]);
  });
});
