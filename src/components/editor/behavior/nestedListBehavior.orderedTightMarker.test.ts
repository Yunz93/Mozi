import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  calculateOrderedListNumbers,
  parseListItem,
} from "./nestedListBehavior";

describe("ordered list tight marker (no space after dot)", () => {
  it("parses 2.AIGC as ordered item 2 with content AIGC", () => {
    const item = parseListItem("2.AIGC", 1, 0);
    expect(item?.type).toBe("ordered");
    expect(item?.number).toBe(2);
    expect(item?.content).toBe("AIGC");
  });

  it("does not parse 1.2 as ordered list (digit after marker)", () => {
    expect(parseListItem("1.2", 1, 0)).toBeNull();
  });

  it("does not treat i.e. / e.g. paragraphs as ordered list items", () => {
    expect(parseListItem("i.e. that one", 1, 0)).toBeNull();
    expect(parseListItem("e.g. this one", 1, 0)).toBeNull();
  });

  it("still parses compact decimal markers like 1.foo", () => {
    const item = parseListItem("1.foo", 1, 0);
    expect(item?.type).toBe("ordered");
    expect(item?.number).toBe(1);
    expect(item?.content).toBe("foo");
  });

  it("restarts nested counter after a new top item written as N.Topic", () => {
    const doc = ["1. AI", "    1. a", "    2. b", "2.AIGC", "    6. x"].join(
      "\n",
    );
    const state = EditorState.create({ doc });
    const nums = calculateOrderedListNumbers(state);
    expect(nums.get(5)).toBe(1);
  });
});
