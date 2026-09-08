import { describe, expect, it } from "vitest";
import { findExistingWereadNote } from "./wereadImport";
import type { FileNode } from "../../types";

describe("findExistingWereadNote", () => {
  it("matches weread_book_id even when the filename changed", async () => {
    const files: FileNode[] = [
      {
        id: "/vault/读书/旧名.md",
        name: "旧名.md",
        type: "file",
        path: "/vault/读书/旧名.md",
      },
    ];
    const found = await findExistingWereadNote({
      bookId: "123456",
      title: "三体",
      preferredPath: "/vault/读书/三体.md",
      files,
      readFile: async (path: string) => {
        if (path !== "/vault/读书/旧名.md") {
          throw new Error("missing");
        }
        return `---
title: 三体
source: weread
weread_book_id: "123456"
---

正文
`;
      },
    });
    expect(found?.path).toBe("/vault/读书/旧名.md");
  });
});
