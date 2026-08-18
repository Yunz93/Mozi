import { describe, expect, it } from "vitest";
import { globToRegExp, pathMatchesAnyGlob, pathMatchesGlob } from "./pathGlob";

describe("pathGlob", () => {
  it("matches .trash/** against vault-relative notes", () => {
    expect(pathMatchesGlob("/vault/.trash/old.md", ".trash/**", "/vault")).toBe(
      true,
    );
    expect(pathMatchesGlob("/vault/notes/a.md", ".trash/**", "/vault")).toBe(
      false,
    );
  });

  it("matches **/node_modules/** at any depth", () => {
    expect(
      pathMatchesGlob(
        "/vault/libs/node_modules/pkg/readme.md",
        "**/node_modules/**",
        "/vault",
      ),
    ).toBe(true);
  });

  it("rejects parent-segment globs", () => {
    expect(globToRegExp("../secret/**")).toBeNull();
  });

  it("matches any of several globs", () => {
    expect(
      pathMatchesAnyGlob(
        "/vault/tmp/draft.md",
        [".trash/**", "tmp/**"],
        "/vault",
      ),
    ).toBe(true);
  });
});
