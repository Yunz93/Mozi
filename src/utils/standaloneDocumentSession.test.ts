import { describe, expect, it } from "vitest";
import { isStandaloneDocumentSession } from "./standaloneDocumentSession";

describe("isStandaloneDocumentSession", () => {
  it("is true when files are open without a vault root", () => {
    expect(isStandaloneDocumentSession(null, 1)).toBe(true);
    expect(isStandaloneDocumentSession("", 2)).toBe(true);
    expect(isStandaloneDocumentSession("   ", 1)).toBe(true);
  });

  it("is false when a knowledge base is open or there are no files", () => {
    expect(isStandaloneDocumentSession("/vault", 1)).toBe(false);
    expect(isStandaloneDocumentSession(null, 0)).toBe(false);
    expect(isStandaloneDocumentSession("/vault", 0)).toBe(false);
  });
});
