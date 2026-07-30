import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { createHandleSmartTab } from "./input";
import { mapColumnAfterLineUpdate } from "./core";

function apply(doc: string, anchor: number, unit = "    ", head = anchor) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: [indentUnit.of(unit)],
  });
  let next = state;
  createHandleSmartTab("strict")({
    state,
    dispatch: (tr) => {
      next = tr.state;
    },
  });
  const line = next.doc.lineAt(next.selection.main.head);
  const col = next.selection.main.head - line.from;
  const markerCol = line.text.search(/[-*+]/);
  return { line: line.text, col, markerCol, doc: next.doc.toString() };
}

describe("list Tab keeps cursor after list marker", () => {
  it("space unit + existing tab indent: cursor stays after marker", () => {
    const doc = "- parent\n\t- child";
    const pos = doc.indexOf("child");
    const result = apply(doc, pos);
    expect(result.col).toBeGreaterThan(result.markerCol);
    expect(result.line.slice(0, result.col)).toContain("-");
  });

  it("cursor on marker with tab-indented line ends after marker", () => {
    const doc = "- parent\n\t- ";
    const pos = doc.indexOf("\t- ") + 1; // on '-'
    const result = apply(doc, pos);
    expect(result.col).toBeGreaterThan(result.markerCol);
  });

  it("tab unit: cursor stays after marker", () => {
    const doc = "- parent\n- child";
    const pos = doc.indexOf("child");
    const result = apply(doc, pos, "\t");
    expect(result.col).toBeGreaterThan(result.markerCol);
  });

  it("screenshot-like empty nested bullet ends after marker", () => {
    const doc = [
      "- 对非 LeRobot3.0 版本展示「转换为 LeRobot」入口",
      "- MCAP 格式版本不展示「发布」和「创建训练任务」入口",
      "- LeRobot 格式版本在满足发布门禁后展示「发布」和「创建训练任务」入口",
      "- ",
    ].join("\n");
    const result = apply(doc, doc.length);
    expect(result.line).toMatch(/^\s+- $/);
    expect(result.col).toBeGreaterThan(result.markerCol);
  });

  it("selection Tab on list line does not leave caret before marker", () => {
    const doc = "- parent\n- child";
    const lineStart = "- parent\n".length;
    // Select from start of sibling (on '-') through content
    const result = apply(doc, lineStart, "    ", doc.length);
    expect(result.line).toMatch(/^\s+- /);
    expect(result.col).toBeGreaterThan(result.markerCol);
  });
});

describe("mapColumnAfterLineUpdate list awareness", () => {
  it("maps cursor on marker to content start after indent prepend", () => {
    expect(mapColumnAfterLineUpdate("- item", "    - item", 0)).toBe(6);
    expect(mapColumnAfterLineUpdate("- item", "    - item", 2)).toBe(6);
  });
});
