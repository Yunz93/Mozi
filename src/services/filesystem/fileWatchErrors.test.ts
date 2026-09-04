import { describe, expect, it } from "vitest";
import { isFileNotFoundError } from "./fileWatchErrors";

describe("isFileNotFoundError", () => {
  it("matches English not-found messages", () => {
    expect(isFileNotFoundError(new Error("No such file or directory"))).toBe(
      true,
    );
    expect(isFileNotFoundError(new Error("file not found"))).toBe(true);
    expect(
      isFileNotFoundError(new Error("cannot find the path specified")),
    ).toBe(true);
  });

  it("matches Windows os error 2/3 even with Chinese system text", () => {
    expect(
      isFileNotFoundError(new Error("系统找不到指定的文件。 (os error 2)")),
    ).toBe(true);
    expect(
      isFileNotFoundError(new Error("系统找不到指定的路径。 (os error 3)")),
    ).toBe(true);
  });

  it("matches NotFound / ENOENT codes", () => {
    expect(
      isFileNotFoundError(Object.assign(new Error("io"), { code: "NotFound" })),
    ).toBe(true);
    expect(
      isFileNotFoundError(Object.assign(new Error("io"), { code: "ENOENT" })),
    ).toBe(true);
    expect(
      isFileNotFoundError(Object.assign(new Error("io"), { name: "NotFound" })),
    ).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isFileNotFoundError(new Error("permission denied"))).toBe(false);
    expect(isFileNotFoundError(new Error("os error 32"))).toBe(false);
    expect(isFileNotFoundError(new Error("资源正被占用"))).toBe(false);
  });
});
