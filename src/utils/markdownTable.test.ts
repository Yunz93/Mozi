import { describe, it, expect } from "vitest";
import {
  splitTableRow,
  findTableAt,
  serializeTable,
  serializeFormattedTable,
  nextCell,
  prevCell,
  insertRowBelow,
  insertRowAbove,
  deleteRow,
  insertColumn,
  deleteColumn,
  moveRow,
  moveColumn,
  setColumnAlignment,
  setTableCell,
  getCellContentRanges,
  locateCellInLine,
  resolveTableCursor,
  replaceTableLines,
  cellContentOffset,
  createEmptyTable,
  parseAlignmentCell,
} from "./markdownTable";

const SAMPLE = [
  "| Name | Age | City |",
  "| ---- | --- | ---- |",
  "| Ada  | 36  | London |",
  "| Bob  | 28  | Paris |",
];

describe("splitTableRow", () => {
  it("splits pipe rows with optional outer pipes", () => {
    expect(splitTableRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
    expect(splitTableRow("|  |  |")).toEqual(["", ""]);
  });

  it("keeps escaped pipes inside a single cell", () => {
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
    expect(splitTableRow("| a\\\\| b |")).toEqual(["a\\", "b"]);
  });
});

describe("serializeTableRow escapes", () => {
  it("escapes pipes and collapses newlines so cells round-trip", () => {
    const table = findTableAt(
      ["| Name | Note |", "| --- | --- |", "| Ada | x |"],
      0,
    )!;
    const updated = setTableCell(table, 1, 1, "a | b\nc");
    expect(serializeTable(updated)).toEqual([
      "| Name | Note |",
      "| --- | --- |",
      "| Ada | a \\| b c |",
    ]);
    const again = findTableAt(serializeTable(updated), 2)!;
    expect(again.body[0][1]).toBe("a | b c");
  });
});

describe("findTableAt / serializeTable", () => {
  it("finds a contiguous GFM table and round-trips", () => {
    const table = findTableAt(SAMPLE, 2);
    expect(table).not.toBeNull();
    expect(table!.columnCount).toBe(3);
    expect(table!.header).toEqual(["Name", "Age", "City"]);
    expect(table!.body).toHaveLength(2);
    expect(serializeTable(table!)).toEqual([
      "| Name | Age | City |",
      "| --- | --- | --- |",
      "| Ada | 36 | London |",
      "| Bob | 28 | Paris |",
    ]);
  });

  it("returns null without a separator row", () => {
    expect(findTableAt(["| a | b |", "| c | d |"], 0)).toBeNull();
  });

  it("parses alignment markers", () => {
    const lines = ["| a | b | c |", "| :--- | :---: | ---: |", "| 1 | 2 | 3 |"];
    const table = findTableAt(lines, 0)!;
    expect(table.alignments).toEqual(["left", "center", "right"]);
  });

  it("accepts Unicode dashes in separators", () => {
    const lines = ["| a | b |", "| — | — |", "| 1 | 2 |"];
    expect(findTableAt(lines, 2)).not.toBeNull();
  });
});

describe("parseAlignmentCell", () => {
  it("detects left/center/right/none", () => {
    expect(parseAlignmentCell(":---")).toBe("left");
    expect(parseAlignmentCell(":---:")).toBe("center");
    expect(parseAlignmentCell("---:")).toBe("right");
    expect(parseAlignmentCell("---")).toBe("none");
  });
});

describe("cell ranges / locate", () => {
  it("maps cursor into the correct cell", () => {
    const line = "| Ada | 36 | London |";
    const ranges = getCellContentRanges(line);
    expect(ranges).toHaveLength(3);
    expect(line.slice(ranges[0].from, ranges[0].to)).toBe("Ada");
    expect(line.slice(ranges[1].from, ranges[1].to)).toBe("36");
    expect(line.slice(ranges[2].from, ranges[2].to)).toBe("London");

    const loc = locateCellInLine(line, 0, ranges[1].from);
    expect(loc?.col).toBe(1);
  });

  it("treats escaped pipes as cell content", () => {
    const line = "| a \\| b | c |";
    const ranges = getCellContentRanges(line);
    expect(ranges).toHaveLength(2);
    expect(line.slice(ranges[0].from, ranges[0].to)).toBe("a \\| b");
    expect(line.slice(ranges[1].from, ranges[1].to)).toBe("c");
  });
});

describe("navigation", () => {
  it("Tab wraps to next row and requests append at end", () => {
    const table = findTableAt(SAMPLE, 0)!;
    expect(nextCell(table, 0, 0)).toEqual({
      logicalRow: 0,
      col: 1,
      appendRow: false,
    });
    expect(nextCell(table, 0, 2)).toEqual({
      logicalRow: 1,
      col: 0,
      appendRow: false,
    });
    expect(nextCell(table, 2, 2)).toEqual({
      logicalRow: 3,
      col: 0,
      appendRow: true,
    });
  });

  it("Shift-Tab stops at first cell", () => {
    const table = findTableAt(SAMPLE, 0)!;
    expect(prevCell(table, 0, 0)).toBeNull();
    expect(prevCell(table, 1, 0)).toEqual({ logicalRow: 0, col: 2 });
  });
});

describe("mutations", () => {
  it("inserts rows above and below", () => {
    const table = findTableAt(SAMPLE, 0)!;
    const below = insertRowBelow(table, 1);
    expect(below.body).toHaveLength(3);
    expect(below.body[1]).toEqual(["", "", ""]);

    const above = insertRowAbove(table, 1);
    expect(above.body[0]).toEqual(["", "", ""]);
    expect(above.body[1]).toEqual(["Ada", "36", "London"]);
  });

  it("deletes body rows and refuses deleting last column", () => {
    const table = findTableAt(SAMPLE, 0)!;
    const deleted = deleteRow(table, 1)!;
    expect(deleted.body).toHaveLength(1);
    expect(deleted.body[0][0]).toBe("Bob");

    const oneCol = deleteColumn(deleteColumn(findTableAt(SAMPLE, 0)!, 2)!, 1)!;
    expect(oneCol.columnCount).toBe(1);
    expect(deleteColumn(oneCol, 0)).toBeNull();
  });

  it("inserts and moves columns", () => {
    const table = findTableAt(SAMPLE, 0)!;
    const withCol = insertColumn(table, 0, "left");
    expect(withCol.columnCount).toBe(4);
    expect(withCol.header[0]).toBe("");
    expect(withCol.header[1]).toBe("Name");

    const moved = moveColumn(withCol, 1, "left")!;
    expect(moved.header[0]).toBe("Name");
    expect(moved.header[1]).toBe("");
  });

  it("moves body rows and sets alignment", () => {
    const table = findTableAt(SAMPLE, 0)!;
    const moved = moveRow(table, 1, "down")!;
    expect(moved.body[0][0]).toBe("Bob");
    expect(moved.body[1][0]).toBe("Ada");

    const aligned = setColumnAlignment(table, 1, "center");
    expect(serializeTable(aligned)[1]).toContain(":---:");
  });

  it("sets a single cell value", () => {
    const table = findTableAt(SAMPLE, 0)!;
    const header = setTableCell(table, 0, 1, "Years");
    expect(header.header[1]).toBe("Years");
    const body = setTableCell(table, 2, 2, "Berlin");
    expect(body.body[1][2]).toBe("Berlin");
  });
});

describe("format / replace / cursor", () => {
  it("formats column widths", () => {
    const table = findTableAt(SAMPLE, 0)!;
    const lines = serializeFormattedTable(table);
    expect(lines[0]).toMatch(/^\| Name/);
    expect(lines[2]).toContain("London");
  });

  it("replaceTableLines updates the document lines", () => {
    const prefix = ["# Title", ""];
    const lines = [...prefix, ...SAMPLE, "", "tail"];
    const table = findTableAt(lines, 3)!;
    const next = insertRowBelow(table, 2);
    const {
      lines: out,
      startLine,
      endLine,
    } = replaceTableLines(lines, table, next);
    expect(out[0]).toBe("# Title");
    expect(out[out.length - 1]).toBe("tail");
    expect(endLine - startLine + 1).toBe(5);
  });

  it("resolveTableCursor reports logical row and cell", () => {
    const doc = SAMPLE.join("\n");
    const lines = SAMPLE;
    const lineIndex = 2;
    let lineFrom = 0;
    for (let i = 0; i < lineIndex; i += 1) lineFrom += lines[i].length + 1;
    const ranges = getCellContentRanges(lines[lineIndex]);
    const pos = lineFrom + ranges[1].from;
    const cursor = resolveTableCursor(lines, lineIndex, lineFrom, pos)!;
    expect(cursor.logicalRow).toBe(1);
    expect(cursor.col).toBe(1);
    expect(cursor.onSeparator).toBe(false);
    expect(doc.slice(cursor.cellFrom, cursor.cellTo)).toBe("36");
  });

  it("cellContentOffset points at rewritten cells", () => {
    const table = createEmptyTable(2, 3);
    const lines = serializeTable(table);
    const offset = cellContentOffset(lines, 0, 0)!;
    expect(lines.join("\n").slice(offset.from, offset.to)).toBe("列1");
  });
});
