import { describe, it, expect, vi } from "vitest";
import type { Frontmatter } from "../types";
import {
  parseFrontmatter,
  generateFrontmatter,
  updateFrontmatter,
  removeFrontmatter,
  getFrontmatterValue,
  setFrontmatterValue,
  replaceFrontmatterInner,
} from "./frontmatter";

function runtimeFrontmatter(value: Record<string, unknown>): Frontmatter {
  return value as unknown as Frontmatter;
}

describe("parseFrontmatter", () => {
  it("returns null frontmatter for empty content", () => {
    const result = parseFrontmatter("");
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe("");
  });

  it("returns null frontmatter for content without frontmatter", () => {
    const result = parseFrontmatter("# Hello\n\nThis is content");
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe("# Hello\n\nThis is content");
  });

  it("parses simple frontmatter", () => {
    const content = "---\ntitle: Hello World\n---\n\n# Body";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({ title: "Hello World" });
    expect(result.body).toBe("# Body");
  });

  it("parses frontmatter with multiple fields", () => {
    const content =
      "---\ntitle: Test\ndate: 2026-01-01\ntags:\n  - a\n  - b\n---\n\nBody";
    const result = parseFrontmatter(content);
    expect(result.frontmatter?.title).toBe("Test");
    expect(result.frontmatter?.date).toBe("2026-01-01");
    expect(result.frontmatter?.tags).toEqual(["a", "b"]);
  });

  it("normalizes Date objects to ISO date strings", () => {
    const content = "---\ncreate_time: 2026-04-14\n---\n\nBody";
    const result = parseFrontmatter(content);
    expect(typeof result.frontmatter?.create_time).toBe("string");
  });

  it("handles invalid YAML gracefully", () => {
    const content = "---\n: invalid yaml [\n---\n\nBody";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles frontmatter with Windows line endings", () => {
    const content = "---\r\ntitle: Hello\r\n---\r\n\r\nBody";
    const result = parseFrontmatter(content);
    expect(result.frontmatter?.title).toBe("Hello");
    expect(result.body).toBe("Body");
  });

  it("returns null frontmatter for empty YAML block", () => {
    const content = "---\n\n---\n\nBody";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe("Body");
  });
});

describe("generateFrontmatter", () => {
  it("returns empty string for empty object", () => {
    expect(generateFrontmatter({})).toBe("");
  });

  it("generates simple frontmatter", () => {
    const result = generateFrontmatter({ title: "Hello" });
    expect(result).toBe("---\ntitle: Hello\n---\n\n");
  });

  it("skips undefined values", () => {
    const result = generateFrontmatter({ title: "Hello", hidden: undefined });
    expect(result).not.toContain("hidden");
  });

  it("handles array values", () => {
    const result = generateFrontmatter({ tags: ["a", "b"] });
    expect(result).toContain("tags:");
    expect(result).toContain("- a");
    expect(result).toContain("- b");
  });

  it("quotes strings that look like booleans", () => {
    const result = generateFrontmatter({ status: "true" });
    expect(result).toContain('"true"');
  });

  it("quotes strings that look like dates", () => {
    const result = generateFrontmatter({ date: "2026-01-01" });
    expect(result).toContain('"2026-01-01"');
  });

  it("handles empty arrays", () => {
    const result = generateFrontmatter({ tags: [] });
    expect(result).toContain("tags:");
    expect(result).toContain("- ");
  });

  it("returns empty string when generation throws", () => {
    // Create a circular reference that will cause JSON.stringify to throw
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = generateFrontmatter(runtimeFrontmatter({ bad: circular }));
    expect(result).toBe("");
  });

  it("handles empty object values", () => {
    const result = generateFrontmatter(runtimeFrontmatter({ meta: {} }));
    expect(result).toContain("meta:");
  });

  it("handles nested objects with multi-line values", () => {
    const result = generateFrontmatter(
      runtimeFrontmatter({ meta: { tags: ["a", "b"] } }),
    );
    expect(result).toContain("meta:");
    expect(result).toContain("  tags:");
    expect(result).toContain("    - a");
    expect(result).toContain("    - b");
  });

  it("handles arrays containing nested objects", () => {
    const result = generateFrontmatter(
      runtimeFrontmatter({ items: [{ name: "a" }] }),
    );
    expect(result).toContain("items:");
    expect(result).toContain("  - name: a");
  });

  it("handles arrays containing nested arrays", () => {
    const result = generateFrontmatter(
      runtimeFrontmatter({ matrix: [["a", "b"]] }),
    );
    expect(result).toContain("matrix:");
    expect(result).toContain("  - - a");
    expect(result).toContain("    - b");
  });

  it("handles various scalar types", () => {
    const result = generateFrontmatter({
      count: 42,
      active: true,
      empty: "",
      nil: null,
      missing: undefined,
    });
    expect(result).toContain("count: 42");
    expect(result).toContain("active: true");
    expect(result).toContain("empty:");
    expect(result).toContain("nil:");
    expect(result).not.toContain("missing");
  });

  it("handles undefined inside arrays", () => {
    const result = generateFrontmatter(
      runtimeFrontmatter({ items: [undefined, "a"] }),
    );
    expect(result).toContain("items:");
    expect(result).toContain("- ");
    expect(result).toContain("- a");
  });

  it("falls back to JSON.stringify for exotic values", () => {
    const result = generateFrontmatter({
      sym: Symbol("test") as unknown as string,
    });
    // Symbol serializes to undefined in JSON.stringify, so output should be 'sym:'
    expect(result).toContain("sym:");
  });
});

describe("updateFrontmatter", () => {
  it("adds frontmatter to content without it", () => {
    const result = updateFrontmatter("# Hello", { title: "Test" });
    expect(result).toMatch(/^---\ntitle: Test\n---\n/);
    expect(result).toContain("# Hello");
  });

  it("merges with existing frontmatter", () => {
    const content = "---\ntitle: Old\n---\n\n# Body";
    const result = updateFrontmatter(content, { slug: "new" });
    const parsed = parseFrontmatter(result);
    expect(parsed.frontmatter?.title).toBe("Old");
    expect(parsed.frontmatter?.slug).toBe("new");
  });

  it("overwrites existing frontmatter fields", () => {
    const content = "---\ntitle: Old\n---\n\n# Body";
    const result = updateFrontmatter(content, { title: "New" });
    const parsed = parseFrontmatter(result);
    expect(parsed.frontmatter?.title).toBe("New");
  });

  it("returns original content when new frontmatter is empty", () => {
    const content = "# Hello";
    const result = updateFrontmatter(content, {});
    expect(result).toBe(content);
  });
});

describe("removeFrontmatter", () => {
  it("removes frontmatter and returns body", () => {
    const content = "---\ntitle: Test\n---\n\n# Body\n\nContent";
    expect(removeFrontmatter(content)).toBe("# Body\n\nContent");
  });

  it("returns content unchanged if no frontmatter", () => {
    expect(removeFrontmatter("# Hello")).toBe("# Hello");
  });
});

describe("getFrontmatterValue", () => {
  it("returns value for existing key", () => {
    const content = "---\ntitle: Hello\n---\n\nBody";
    expect(getFrontmatterValue(content, "title")).toBe("Hello");
  });

  it("returns null for missing key", () => {
    const content = "---\ntitle: Hello\n---\n\nBody";
    expect(getFrontmatterValue(content, "missing")).toBeNull();
  });

  it("returns null for content without frontmatter", () => {
    expect(getFrontmatterValue("# Hello", "title")).toBeNull();
  });
});

describe("setFrontmatterValue", () => {
  it("sets a new value in existing frontmatter", () => {
    const content = "---\ntitle: Hello\n---\n\nBody";
    const result = setFrontmatterValue(content, "slug", "hello-world");
    const parsed = parseFrontmatter(result);
    expect(parsed.frontmatter?.slug).toBe("hello-world");
    expect(parsed.frontmatter?.title).toBe("Hello");
  });

  it("creates frontmatter if none exists", () => {
    const result = setFrontmatterValue("# Body", "title", "New");
    const parsed = parseFrontmatter(result);
    expect(parsed.frontmatter?.title).toBe("New");
  });
});

describe("replaceFrontmatterInner", () => {
  it("returns null when content has no frontmatter", () => {
    const result = replaceFrontmatterInner("# Hello", (inner) => inner);
    expect(result).toBeNull();
  });

  it("returns null when replacer returns null", () => {
    const content = "---\ntitle: Test\n---\n\nBody";
    const result = replaceFrontmatterInner(content, () => null);
    expect(result).toBeNull();
  });

  it("replaces inner content while preserving fences", () => {
    const content = "---\ntitle: Old\n---\n\nBody";
    const result = replaceFrontmatterInner(content, (inner) =>
      inner.replace("Old", "New"),
    );
    expect(result).toBe("---\ntitle: New\n---\n\nBody");
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\ntitle: Test\r\nstatus: draft\r\n---\r\n\r\nBody";
    const result = replaceFrontmatterInner(content, (inner, { lineEnding }) => {
      expect(lineEnding).toBe("\r\n");
      return inner.replace("Test", "Replaced");
    });
    expect(result).toBe(
      "---\r\ntitle: Replaced\r\nstatus: draft\r\n---\r\n\r\nBody",
    );
  });

  it("detects CRLF from fences when the YAML body is a single line", () => {
    const content = "---\r\ntitle: Test\r\n---\r\n\r\nBody";
    const result = replaceFrontmatterInner(content, (inner, { lineEnding }) => {
      expect(lineEnding).toBe("\r\n");
      return `${inner}${lineEnding}slug: hello`;
    });
    expect(result).toBe("---\r\ntitle: Test\r\nslug: hello\r\n---\r\n\r\nBody");
  });

  it("handles LF line endings", () => {
    const content = "---\ntitle: Test\nstatus: draft\n---\n\nBody";
    const result = replaceFrontmatterInner(content, (inner, { lineEnding }) => {
      expect(lineEnding).toBe("\n");
      return inner.replace("Test", "Replaced");
    });
    expect(result).toBe("---\ntitle: Replaced\nstatus: draft\n---\n\nBody");
  });

  it("returns null when frontmatter is not at start", () => {
    const content = "Some text\n---\ntitle: Test\n---\n\nBody";
    const result = replaceFrontmatterInner(content, (inner) =>
      inner.replace("Test", "Replaced"),
    );
    expect(result).toBeNull();
  });

  it("returns null when inner offset is negative (defensive)", () => {
    // This tests the defensive innerOffset < 0 branch.
    // We mock indexOf to return -1 to force that path.
    const content = "---\ntitle: Test\n---\n\nBody";
    const originalIndexOf = String.prototype.indexOf;
    const spy = vi
      .spyOn(String.prototype, "indexOf")
      .mockImplementation(function (
        this: string,
        searchString: string,
        position?: number,
      ) {
        if (searchString === "title: Test") {
          return -1;
        }
        return originalIndexOf.call(this, searchString, position);
      });
    const result = replaceFrontmatterInner(content, (inner) =>
      inner.replace("Test", "Replaced"),
    );
    expect(result).toBeNull();
    spy.mockRestore();
  });
});
