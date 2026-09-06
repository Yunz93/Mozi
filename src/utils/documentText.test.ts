import { describe, expect, it } from "vitest";
import { normalizeTextForCompare, sameDocumentText } from "./documentText";

describe("documentText", () => {
  it("strips BOM and normalizes CRLF / CR to LF", () => {
    expect(normalizeTextForCompare("\uFEFFhello\r\nworld\r")).toBe(
      "hello\nworld\n",
    );
  });

  it("treats CRLF disk snapshots as equal to editor LF text", () => {
    expect(
      sameDocumentText("# Title\r\n\r\nBody\r\n", "# Title\n\nBody\n"),
    ).toBe(true);
  });

  it("still detects real content changes", () => {
    expect(sameDocumentText("# Title\r\nBody\r\n", "# Title\nEdited\n")).toBe(
      false,
    );
  });
});
