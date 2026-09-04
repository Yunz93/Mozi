import { describe, expect, it } from "vitest";
import { buildHostedImageFilename } from "./imageHostingFilename";

describe("buildHostedImageFilename", () => {
  it("returns the same name for the same content and filename", async () => {
    const bytes = new TextEncoder().encode("same-bytes");
    const a = await buildHostedImageFilename("cover.png", bytes);
    const b = await buildHostedImageFilename("cover.png", bytes);
    expect(a).toBe(b);
    expect(a).toMatch(/^cover-[0-9a-f]{8}\.png$/);
  });

  it("returns different names when content differs but filename is the same", async () => {
    const a = await buildHostedImageFilename(
      "cover.png",
      new TextEncoder().encode("one"),
    );
    const b = await buildHostedImageFilename(
      "cover.png",
      new TextEncoder().encode("two"),
    );
    expect(a).not.toBe(b);
    expect(a.startsWith("cover-")).toBe(true);
    expect(b.startsWith("cover-")).toBe(true);
  });
});
