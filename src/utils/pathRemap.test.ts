import { describe, expect, it } from "vitest";
import { buildTabPathRemapState, remapPathBoundarySafe } from "./pathRemap";

describe("remapPathBoundarySafe", () => {
  it("remaps child paths without colliding on shared prefixes", () => {
    expect(
      remapPathBoundarySafe(
        "/project/testing/note.md",
        "/project/test",
        "/project/demo",
      ),
    ).toBe("/project/testing/note.md");
    expect(
      remapPathBoundarySafe(
        "/project/test/note.md",
        "/project/test",
        "/project/demo",
      ),
    ).toBe("/project/demo/note.md");
  });
});

describe("buildTabPathRemapState", () => {
  it("remaps the open document id and cached content keys", () => {
    const next = buildTabPathRemapState(
      {
        openTabs: ["/vault/old.md"],
        activeTabId: "/vault/old.md",
        currentFilePath: "/vault/old.md",
        fileContents: {
          "/vault/old.md": "old",
        },
        lastSavedContent: {
          "/vault/old.md": "old",
        },
        fileHistories: {},
      },
      { "/vault/old.md": "/vault/new.md" },
    );

    expect(next.openTabs).toEqual(["/vault/new.md"]);
    expect(next.activeTabId).toBe("/vault/new.md");
    expect(next.fileContents?.["/vault/new.md"]).toBe("old");
  });
});
