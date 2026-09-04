import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  buildListHierarchy,
  calculateOrderedListNumbers,
  formatOrderedMarkerValue,
  getOrderedListParentForContinuation,
  getStrictOrderedListNormalizationChanges,
  parseListItem,
} from "./nestedListBehavior";

describe("formatOrderedMarkerValue", () => {
  it("formats decimal markers", () => {
    expect(formatOrderedMarkerValue(3, "decimal", ".")).toBe("3.");
    expect(formatOrderedMarkerValue(10, "decimal", ")")).toBe("10)");
  });

  it("formats alpha markers", () => {
    expect(formatOrderedMarkerValue(1, "lower-alpha", ".")).toBe("a.");
    expect(formatOrderedMarkerValue(2, "upper-alpha", ".")).toBe("B.");
  });

  it("formats roman markers", () => {
    expect(formatOrderedMarkerValue(2, "lower-roman", ".")).toBe("ii.");
    expect(formatOrderedMarkerValue(4, "upper-roman", ".")).toBe("IV.");
  });
});

describe("buildListHierarchy", () => {
  it("tracks parent levels for three-level nested ordered lists", () => {
    const doc = ["1. top", "    1. mid", "        1. leaf"].join("\n");
    const hierarchy = buildListHierarchy(EditorState.create({ doc }).doc);

    expect(hierarchy.get(1)?.parentLevel).toBe(-1);
    expect(hierarchy.get(2)?.parentLevel).toBe(0);
    expect(hierarchy.get(3)?.parentLevel).toBe(1);
  });

  it("clears hierarchy after two consecutive blank lines", () => {
    const doc = ["1. first", "", "", "1. second"].join("\n");
    const hierarchy = buildListHierarchy(EditorState.create({ doc }).doc);

    expect(hierarchy.get(1)?.parentLevel).toBe(-1);
    expect(hierarchy.get(4)?.parentLevel).toBe(-1);
  });

  it("does not treat blockquote nested items as hierarchy siblings when quote prefixes differ", () => {
    const doc = ["1. root", "> 1. quote", ">     1. nested"].join("\n");
    const hierarchy = buildListHierarchy(EditorState.create({ doc }).doc);

    expect(hierarchy.get(1)?.parentLevel).toBe(-1);
    expect(hierarchy.get(2)?.parentLevel).toBe(-1);
    // `>     1. nested` 的 quotePrefix 为 `>     `，与 `> 1. quote` 的 `> ` 不同，层级栈不会接续
    expect(hierarchy.get(3)?.parentLevel).toBe(-1);
  });
});

describe("parseListItem blockquote context", () => {
  it("parses ordered list markers after a blockquote prefix", () => {
    const item = parseListItem("> 1. quote item", 1, 0);
    expect(item?.type).toBe("ordered");
    expect(item?.quotePrefix).toBe("> ");
    expect(item?.content).toBe("quote item");
  });

  it("keeps blockquote spacing inside quotePrefix when marker is indented under >", () => {
    const item = parseListItem(">     - nested", 2, 0);
    expect(item?.type).toBe("unordered");
    expect(item?.quotePrefix).toBe(">     ");
    expect(item?.indent).toBe("");
  });
});

describe("getOrderedListParentForContinuation", () => {
  it("returns parent when continuation indent meets marker content column", () => {
    const state = EditorState.create({ doc: "1. one\n   note" });
    expect(getOrderedListParentForContinuation(state, 2)?.number).toBe(1);
  });

  it("returns null when continuation indent is too shallow", () => {
    const state = EditorState.create({ doc: "1. one\n two" });
    expect(getOrderedListParentForContinuation(state, 2)).toBeNull();
  });
});

describe("calculateOrderedListNumbers", () => {
  it("independently counts each nesting depth", () => {
    const doc = ["1. a", "    1. b", "    2. c", "2. d", "    1. e"].join("\n");
    const nums = calculateOrderedListNumbers(EditorState.create({ doc }));

    expect(nums.get(1)).toBe(1);
    expect(nums.get(2)).toBe(1);
    expect(nums.get(3)).toBe(2);
    expect(nums.get(4)).toBe(2);
    expect(nums.get(5)).toBe(1);
  });

  it("keeps blockquote ordered lists in a separate numbering context", () => {
    const doc = ["1. root", "> 1. quote", "> 3. next quote", "2. root2"].join(
      "\n",
    );
    const nums = calculateOrderedListNumbers(EditorState.create({ doc }));

    expect(nums.get(1)).toBe(1);
    expect(nums.get(2)).toBe(1);
    expect(nums.get(3)).toBe(2);
    expect(nums.get(4)).toBe(2);
  });
});

describe("getStrictOrderedListNormalizationChanges Latin abbreviations", () => {
  it("does not rewrite i.e. / e.g. paragraphs", () => {
    const doc = "Some intro.\n\ne.g. this one\n\ni.e. that one";
    const state = EditorState.create({ doc });
    expect(getStrictOrderedListNormalizationChanges(state)).toBeNull();
  });

  it("still recognizes compact decimal 1.foo", () => {
    const doc = "1.foo\n3.bar";
    const state = EditorState.create({ doc });
    const changes = getStrictOrderedListNormalizationChanges(state);
    expect(changes).not.toBeNull();
    const next = state.update({ changes: changes! }).state.doc.toString();
    expect(next).toBe("1.foo\n2.bar");
  });

  it("normalizes a 1000-item flat list within 200ms", () => {
    const lines = Array.from({ length: 1000 }, () => "1. item");
    const state = EditorState.create({ doc: lines.join("\n") });
    const started = performance.now();
    const changes = getStrictOrderedListNormalizationChanges(state);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(200);
    expect(changes?.length).toBeGreaterThan(0);
  });
});
