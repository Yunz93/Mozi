import { describe, expect, it } from "vitest";
import {
  buildMarkdownDestination,
  parseMarkdownDestination,
  stripMarkdownDestination,
} from "./markdownDestination";

describe("markdownDestination", () => {
  it("returns empty result for empty string", () => {
    expect(parseMarkdownDestination("")).toEqual({
      path: "",
      angleBrackets: false,
      title: "",
    });
  });

  it("returns empty result for whitespace-only string", () => {
    expect(parseMarkdownDestination("   \t\n  ")).toEqual({
      path: "",
      angleBrackets: false,
      title: "",
    });
  });

  it("parses angle-bracket paths with titles", () => {
    expect(
      parseMarkdownDestination('<../resources/my file.png> "cover title"'),
    ).toEqual({
      path: "../resources/my file.png",
      angleBrackets: true,
      title: '"cover title"',
    });
  });

  it("parses plain paths with titles", () => {
    expect(
      parseMarkdownDestination('../resources/cover.png "cover title"'),
    ).toEqual({
      path: "../resources/cover.png",
      angleBrackets: false,
      title: '"cover title"',
    });
  });

  it("rebuilds angle-bracket paths without dropping titles", () => {
    expect(
      buildMarkdownDestination("../resources/new/my file.png", {
        path: "../resources/my file.png",
        angleBrackets: true,
        title: '"cover title"',
      }),
    ).toBe('<../resources/new/my file.png> "cover title"');
  });

  it("strips angle-bracket destinations with titles to the path", () => {
    expect(
      stripMarkdownDestination('<../resources/my file.png> "cover title"'),
    ).toBe("../resources/my file.png");
  });

  it("keeps bare destinations that contain spaces", () => {
    expect(parseMarkdownDestination("https://example.com/M 記-1.png")).toEqual({
      path: "https://example.com/M 記-1.png",
      angleBrackets: false,
      title: "",
    });
  });

  it("peels a quoted title off a destination that also has spaces", () => {
    expect(parseMarkdownDestination('resources/M 記.png "cover"')).toEqual({
      path: "resources/M 記.png",
      angleBrackets: false,
      title: '"cover"',
    });
  });

  it("wraps rebuilt destinations that contain spaces", () => {
    expect(
      buildMarkdownDestination("M 記.png", {
        path: "old.png",
        angleBrackets: false,
        title: "",
      }),
    ).toBe("<M 記.png>");
  });
});
