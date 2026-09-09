import { describe, expect, it } from "vitest";
import {
  extractPublishYear,
  resolveWereadCoverPath,
  resolveWereadNotePath,
  sanitizeWereadPathSegment,
} from "./wereadPaths";

describe("wereadPaths", () => {
  it("nests by author and year", () => {
    const path = resolveWereadNotePath({
      rootFolderPath: "/vault",
      folder: "读书",
      mode: "authorYear",
      title: "三体",
      bookId: "123",
      author: "刘慈欣",
      publishTime: "2008-01-01",
    });
    expect(path.filePath).toBe("/vault/读书/刘慈欣/2008/三体.md");
  });

  it("keeps a flat layout by default", () => {
    const path = resolveWereadNotePath({
      rootFolderPath: "/vault",
      folder: "读书",
      mode: "flat",
      title: "三体",
      bookId: "123",
    });
    expect(path.filePath).toBe("/vault/读书/三体.md");
  });

  it("sanitizes illegal path characters", () => {
    expect(sanitizeWereadPathSegment('三体: "黑暗森林"?', "book")).toBe(
      "三体 黑暗森林",
    );
  });

  it("extracts a year from WeRead publishTime strings", () => {
    expect(extractPublishYear("2018-05-01 00:00:00")).toBe("2018");
    expect(extractPublishYear(1672531200)).toBe("2023");
  });

  it("stores covers under the resource folder", () => {
    const cover = resolveWereadCoverPath({
      rootFolderPath: "/vault",
      resourceFolder: "resources",
      bookId: "123",
    });
    expect(cover.destPath).toBe("/vault/resources/weread-covers/123.jpg");
  });
});
