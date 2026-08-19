import { describe, expect, it } from "vitest";
import {
  bodyRowsForVisualRows,
  clampTableInsertSize,
  parseTableInsertSlashQuery,
  TABLE_INSERT_DEFAULT_COLS,
  TABLE_INSERT_DEFAULT_ROWS,
} from "./tableInsert";

describe("parseTableInsertSlashQuery", () => {
  it("opens the size picker for a bare slash or table aliases", () => {
    expect(parseTableInsertSlashQuery("")).toMatchObject({ mode: "picker" });
    expect(parseTableInsertSlashQuery("表格")).toMatchObject({
      mode: "picker",
    });
    expect(parseTableInsertSlashQuery("table")).toMatchObject({
      mode: "picker",
    });
    expect(parseTableInsertSlashQuery("biao")).toMatchObject({
      mode: "picker",
    });
    expect(parseTableInsertSlashQuery("tab")).toMatchObject({ mode: "picker" });
  });

  it("parses visual rows × columns from slash queries", () => {
    expect(parseTableInsertSlashQuery("3x4")).toEqual({
      mode: "sized",
      visualRows: 3,
      cols: 4,
    });
    expect(parseTableInsertSlashQuery("表格 5×2")).toEqual({
      mode: "sized",
      visualRows: 5,
      cols: 2,
    });
    expect(parseTableInsertSlashQuery("table3x3")).toEqual({
      mode: "sized",
      visualRows: 3,
      cols: 3,
    });
  });

  it("ignores unrelated slash queries", () => {
    expect(parseTableInsertSlashQuery("code")).toMatchObject({ mode: "none" });
    expect(parseTableInsertSlashQuery("heading")).toMatchObject({
      mode: "none",
    });
  });

  it("clamps extreme sizes", () => {
    expect(clampTableInsertSize(1, 0)).toEqual({ visualRows: 2, cols: 1 });
    expect(clampTableInsertSize(99, 99)).toEqual({ visualRows: 12, cols: 10 });
    expect(bodyRowsForVisualRows(3)).toBe(2);
    expect(bodyRowsForVisualRows(2)).toBe(1);
  });

  it("keeps the default 3×3 size for picker queries", () => {
    expect(parseTableInsertSlashQuery("")).toEqual({
      mode: "picker",
      visualRows: TABLE_INSERT_DEFAULT_ROWS,
      cols: TABLE_INSERT_DEFAULT_COLS,
    });
  });
});
