/**
 * GFM pipe-table model: parse, serialize, navigate, and structural mutations.
 * Pure functions — no CodeMirror dependency.
 */

import {
  isMarkdownTableSeparatorLine,
  isPotentialMarkdownTableRow,
  normalizeMarkdownTableSeparatorLine,
} from "./markdownTableNormalize";

export type ColumnAlignment = "left" | "center" | "right" | "none";

export interface MarkdownTable {
  /** Inclusive 0-based line index of the header row. */
  startLine: number;
  /** Inclusive 0-based line index of the last body row (or separator if no body). */
  endLine: number;
  header: string[];
  alignments: ColumnAlignment[];
  body: string[][];
  columnCount: number;
}

export interface TableCellRef {
  /** 0 = header, >= 1 = body row index + 1 (separator is not a cell row). */
  row: number;
  col: number;
}

export interface TableCursorPos {
  table: MarkdownTable;
  /** Logical row: 0 = header, 1..n = body. Separator is skipped. */
  logicalRow: number;
  col: number;
  /** Absolute character offset of cell content start in the source line. */
  cellFrom: number;
  /** Absolute character offset of cell content end in the source line. */
  cellTo: number;
}

export function isTablePartLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  return (
    isPotentialMarkdownTableRow(line) || isMarkdownTableSeparatorLine(line)
  );
}

/** Unescape GFM table cell escapes (`\|` → `|`, `\\` → `\`). */
export function unescapeTableCellText(value: string): string {
  return value.replace(/\\([\\|])/g, "$1");
}

/**
 * Normalize cell text before serialization:
 * - collapse newlines (GFM cells are single-line)
 * - escape literal `|` and `\` so round-trips stay one column
 */
export function escapeTableCellText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
}

/**
 * Split a pipe row into cell texts (trimmed).
 * Honors escaped pipes (`\|`) so `a \| b` stays one cell.
 */
export function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    // Only strip a trailing pipe that is not escaped.
    let escapes = 0;
    for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === "\\"; i -= 1) {
      escapes += 1;
    }
    if (escapes % 2 === 0) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  if (trimmed.length === 0) return [""];

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (ch === "|") {
      cells.push(unescapeTableCellText(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (escaped) {
    // Trailing lone backslash — keep as literal text.
  }
  cells.push(unescapeTableCellText(current.trim()));
  return cells;
}

export function parseAlignmentCell(cell: string): ColumnAlignment {
  const ascii = cell.replace(
    /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g,
    "-",
  );
  const t = ascii.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

export function alignmentToSeparatorCell(align: ColumnAlignment): string {
  switch (align) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

function normalizeRowWidth(cells: string[], columnCount: number): string[] {
  const next = cells.slice(0, columnCount);
  while (next.length < columnCount) next.push("");
  return next;
}

export function serializeTableRow(cells: string[]): string {
  return `| ${cells.map((c) => escapeTableCellText(c.trim())).join(" | ")} |`;
}

export function serializeSeparator(alignments: ColumnAlignment[]): string {
  return `| ${alignments.map(alignmentToSeparatorCell).join(" | ")} |`;
}

/** Serialize a table to GFM lines (header + separator + body). */
export function serializeTable(table: MarkdownTable): string[] {
  const col = table.columnCount;
  const header = normalizeRowWidth(table.header, col);
  const alignments =
    table.alignments.length >= col
      ? table.alignments.slice(0, col)
      : [
          ...table.alignments,
          ...Array.from(
            { length: col - table.alignments.length },
            () => "none" as ColumnAlignment,
          ),
        ];
  const body = table.body.map((row) => normalizeRowWidth(row, col));
  return [
    serializeTableRow(header),
    serializeSeparator(alignments),
    ...body.map(serializeTableRow),
  ];
}

/**
 * Find a GFM table whose contiguous block includes `lineIndex`.
 * Requires a separator as the second row of the block.
 */
export function findTableAt(
  lines: string[],
  lineIndex: number,
): MarkdownTable | null {
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  if (!isTablePartLine(lines[lineIndex])) return null;

  let start = lineIndex;
  while (start > 0 && isTablePartLine(lines[start - 1])) {
    start -= 1;
  }
  let end = lineIndex;
  while (end + 1 < lines.length && isTablePartLine(lines[end + 1])) {
    end += 1;
  }

  if (end - start < 1) return null;

  const headerLine = lines[start];
  const separatorLine = normalizeMarkdownTableSeparatorLine(lines[start + 1]);
  if (!isMarkdownTableSeparatorLine(separatorLine)) return null;

  const header = splitTableRow(headerLine);
  const sepCells = splitTableRow(separatorLine);
  const alignments = sepCells.map(parseAlignmentCell);
  const columnCount = Math.max(header.length, alignments.length, 1);

  const body: string[][] = [];
  for (let i = start + 2; i <= end; i += 1) {
    if (isMarkdownTableSeparatorLine(lines[i])) {
      // Extra separator — treat as body text row for resilience
      body.push(normalizeRowWidth(splitTableRow(lines[i]), columnCount));
      continue;
    }
    body.push(normalizeRowWidth(splitTableRow(lines[i]), columnCount));
  }

  const normalizedAlignments = Array.from(
    { length: columnCount },
    (_, i) => alignments[i] ?? ("none" as ColumnAlignment),
  );

  return {
    startLine: start,
    endLine: end,
    header: normalizeRowWidth(header, columnCount),
    alignments: normalizedAlignments,
    body,
    columnCount,
  };
}

/**
 * Map absolute document offset within a line to a cell index and content range.
 * `lineText` is the full line; `lineFrom` is the document offset of the line start;
 * `pos` is the absolute cursor offset.
 */
export function locateCellInLine(
  lineText: string,
  lineFrom: number,
  pos: number,
): { col: number; cellFrom: number; cellTo: number } | null {
  const cells = splitTableRow(lineText);
  if (cells.length === 0) return null;

  // Walk the raw line to find pipe-delimited segments matching split semantics.
  const ranges = getCellContentRanges(lineText);
  if (ranges.length === 0) return null;

  const offsetInLine = Math.max(0, Math.min(pos - lineFrom, lineText.length));
  for (let i = 0; i < ranges.length; i += 1) {
    const { from, to } = ranges[i];
    // Prefer the cell whose content range contains the cursor; pipe boundaries
    // belong to the following cell (except trailing pipe after last cell).
    if (offsetInLine >= from && offsetInLine <= to) {
      return { col: i, cellFrom: lineFrom + from, cellTo: lineFrom + to };
    }
    if (offsetInLine < from) {
      return { col: i, cellFrom: lineFrom + from, cellTo: lineFrom + to };
    }
  }

  const last = ranges[ranges.length - 1];
  return {
    col: ranges.length - 1,
    cellFrom: lineFrom + last.from,
    cellTo: lineFrom + last.to,
  };
}

/**
 * Content ranges (trimmed) for each cell relative to the start of `lineText`.
 * Escaped pipes (`\|`) stay inside a cell and do not start a new range.
 */
export function getCellContentRanges(
  lineText: string,
): Array<{ from: number; to: number }> {
  const trimmedStart = lineText.match(/^\s*/)?.[0].length ?? 0;
  let working = lineText.slice(trimmedStart);
  let base = trimmedStart;

  if (working.startsWith("|")) {
    working = working.slice(1);
    base += 1;
  }

  let endTrim = 0;
  if (working.endsWith("|")) {
    let escapes = 0;
    for (let i = working.length - 2; i >= 0 && working[i] === "\\"; i -= 1) {
      escapes += 1;
    }
    if (escapes % 2 === 0) {
      working = working.slice(0, -1);
      endTrim = 1;
    }
  }

  if (working.length === 0 && endTrim === 1) {
    // "| |" style empty single cell after stripping both pipes → empty middle
    return [{ from: base, to: base }];
  }

  const ranges: Array<{ from: number; to: number }> = [];
  let partStart = 0;
  let escaped = false;

  const pushRange = (partEnd: number) => {
    const part = working.slice(partStart, partEnd);
    const lead = part.match(/^\s*/)?.[0].length ?? 0;
    const trail = part.match(/\s*$/)?.[0].length ?? 0;
    const contentFrom = partStart + lead;
    const contentTo = partEnd - trail;
    ranges.push({ from: base + contentFrom, to: base + contentTo });
  };

  for (let i = 0; i < working.length; i += 1) {
    const ch = working[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") {
      pushRange(i);
      partStart = i + 1;
    }
  }
  pushRange(working.length);

  return ranges;
}

/** Logical row count = 1 (header) + body rows. */
export function logicalRowCount(table: MarkdownTable): number {
  return 1 + table.body.length;
}

export function getLogicalRowCells(
  table: MarkdownTable,
  logicalRow: number,
): string[] {
  if (logicalRow <= 0) return table.header;
  return table.body[logicalRow - 1] ?? table.header;
}

export interface ResolvedTableCursor extends TableCursorPos {
  onSeparator: boolean;
}

/**
 * Resolve cursor position inside a table. Returns null if not in a table.
 * Separator row sets `onSeparator: true` and maps logicalRow to header (0).
 */
export function resolveTableCursor(
  lines: string[],
  lineIndex: number,
  lineFrom: number,
  pos: number,
): ResolvedTableCursor | null {
  const table = findTableAt(lines, lineIndex);
  if (!table) return null;

  const relative = lineIndex - table.startLine;
  const loc = locateCellInLine(lines[lineIndex], lineFrom, pos);
  const col = Math.min(loc?.col ?? 0, table.columnCount - 1);

  if (relative === 1) {
    return {
      table,
      logicalRow: 0,
      col,
      cellFrom: loc?.cellFrom ?? lineFrom,
      cellTo: loc?.cellTo ?? lineFrom,
      onSeparator: true,
    };
  }

  const logicalRow = relative === 0 ? 0 : relative - 1;
  return {
    table,
    logicalRow,
    col,
    cellFrom: loc?.cellFrom ?? lineFrom,
    cellTo: loc?.cellTo ?? lineFrom,
    onSeparator: false,
  };
}

/** Document line index for a logical row (0=header, 1+=body). */
export function lineIndexForLogicalRow(
  table: MarkdownTable,
  logicalRow: number,
): number {
  if (logicalRow <= 0) return table.startLine;
  return table.startLine + 1 + logicalRow; // +1 skips separator
}

export function nextCell(
  table: MarkdownTable,
  logicalRow: number,
  col: number,
): { logicalRow: number; col: number; appendRow: boolean } {
  if (col + 1 < table.columnCount) {
    return { logicalRow, col: col + 1, appendRow: false };
  }
  const rows = logicalRowCount(table);
  if (logicalRow + 1 < rows) {
    return { logicalRow: logicalRow + 1, col: 0, appendRow: false };
  }
  return { logicalRow: rows, col: 0, appendRow: true };
}

export function prevCell(
  table: MarkdownTable,
  logicalRow: number,
  col: number,
): { logicalRow: number; col: number } | null {
  if (col > 0) {
    return { logicalRow, col: col - 1 };
  }
  if (logicalRow > 0) {
    return { logicalRow: logicalRow - 1, col: table.columnCount - 1 };
  }
  return null;
}

export function insertRowAbove(
  table: MarkdownTable,
  logicalRow: number,
): MarkdownTable {
  const empty = Array.from({ length: table.columnCount }, () => "");
  if (logicalRow <= 0) {
    // Inserting above header: push header down into body and put empty as new header?
    // Obsidian typically inserts a body row above current body row; for header,
    // insert as first body row instead.
    return {
      ...table,
      body: [empty, ...table.body],
      endLine: table.endLine + 1,
    };
  }
  const bodyIndex = logicalRow - 1;
  const body = [
    ...table.body.slice(0, bodyIndex),
    empty,
    ...table.body.slice(bodyIndex),
  ];
  return { ...table, body, endLine: table.endLine + 1 };
}

export function insertRowBelow(
  table: MarkdownTable,
  logicalRow: number,
): MarkdownTable {
  const empty = Array.from({ length: table.columnCount }, () => "");
  const bodyIndex = logicalRow <= 0 ? 0 : logicalRow;
  const body = [
    ...table.body.slice(0, bodyIndex),
    empty,
    ...table.body.slice(bodyIndex),
  ];
  return { ...table, body, endLine: table.endLine + 1 };
}

export function deleteRow(
  table: MarkdownTable,
  logicalRow: number,
): MarkdownTable | null {
  if (logicalRow <= 0) {
    // Don't delete header; if body exists, promote first body to header
    if (table.body.length === 0) return null;
    const [first, ...rest] = table.body;
    return {
      ...table,
      header: first,
      body: rest,
      endLine: table.endLine - 1,
    };
  }
  if (table.body.length <= 1 && logicalRow === 1) {
    // Keep at least header + separator; allow zero body rows
    return {
      ...table,
      body: [],
      endLine: table.startLine + 1,
    };
  }
  const bodyIndex = logicalRow - 1;
  if (bodyIndex < 0 || bodyIndex >= table.body.length) return table;
  const body = [
    ...table.body.slice(0, bodyIndex),
    ...table.body.slice(bodyIndex + 1),
  ];
  return { ...table, body, endLine: table.endLine - 1 };
}

export function insertColumn(
  table: MarkdownTable,
  atCol: number,
  side: "left" | "right",
): MarkdownTable {
  const index = side === "left" ? atCol : atCol + 1;
  const insertAt = Math.max(0, Math.min(index, table.columnCount));

  const insertIn = (row: string[]) => [
    ...row.slice(0, insertAt),
    "",
    ...row.slice(insertAt),
  ];

  return {
    ...table,
    columnCount: table.columnCount + 1,
    header: insertIn(table.header),
    alignments: [
      ...table.alignments.slice(0, insertAt),
      "none",
      ...table.alignments.slice(insertAt),
    ],
    body: table.body.map(insertIn),
  };
}

export function deleteColumn(
  table: MarkdownTable,
  col: number,
): MarkdownTable | null {
  if (table.columnCount <= 1) return null;
  const index = Math.max(0, Math.min(col, table.columnCount - 1));
  const removeAt = <T>(row: T[]): T[] => [
    ...row.slice(0, index),
    ...row.slice(index + 1),
  ];
  return {
    ...table,
    columnCount: table.columnCount - 1,
    header: removeAt(table.header),
    alignments: removeAt(table.alignments),
    body: table.body.map(removeAt),
  };
}

export function moveRow(
  table: MarkdownTable,
  logicalRow: number,
  direction: "up" | "down",
): MarkdownTable | null {
  if (logicalRow <= 0) return null; // don't move header via swap with body for simplicity
  const bodyIndex = logicalRow - 1;
  const target = direction === "up" ? bodyIndex - 1 : bodyIndex + 1;
  if (target < 0 || target >= table.body.length) return null;
  const body = [...table.body];
  const tmp = body[bodyIndex];
  body[bodyIndex] = body[target];
  body[target] = tmp;
  return { ...table, body };
}

export function moveColumn(
  table: MarkdownTable,
  col: number,
  direction: "left" | "right",
): MarkdownTable | null {
  const target = direction === "left" ? col - 1 : col + 1;
  if (col < 0 || col >= table.columnCount) return null;
  if (target < 0 || target >= table.columnCount) return null;

  const swap = <T>(arr: T[]): T[] => {
    const next = [...arr];
    const tmp = next[col];
    next[col] = next[target];
    next[target] = tmp;
    return next;
  };

  return {
    ...table,
    header: swap(table.header),
    alignments: swap(table.alignments),
    body: table.body.map(swap),
  };
}

export function setColumnAlignment(
  table: MarkdownTable,
  col: number,
  align: ColumnAlignment,
): MarkdownTable {
  const index = Math.max(0, Math.min(col, table.columnCount - 1));
  const alignments = [...table.alignments];
  while (alignments.length < table.columnCount) alignments.push("none");
  alignments[index] = align;
  return { ...table, alignments };
}

function columnWidths(table: MarkdownTable): number[] {
  const widths = Array.from({ length: table.columnCount }, () => 3);
  const consider = (cells: string[]) => {
    for (let i = 0; i < table.columnCount; i += 1) {
      widths[i] = Math.max(widths[i], (cells[i] ?? "").trim().length);
    }
  };
  consider(table.header);
  for (const row of table.body) consider(row);
  return widths;
}

/** Serialize with padded cells so columns visually align (code-unit width). */
export function serializeFormattedTable(table: MarkdownTable): string[] {
  const widths = columnWidths(table);

  const padCell = (text: string, width: number) => {
    const t = text.trim();
    return t + " ".repeat(Math.max(0, width - t.length));
  };

  const sepCell = (align: ColumnAlignment, width: number): string => {
    const w = Math.max(3, width);
    switch (align) {
      case "left":
        return `:${"-".repeat(w - 1)}`;
      case "center":
        return `:${"-".repeat(Math.max(1, w - 2))}:`;
      case "right":
        return `${"-".repeat(w - 1)}:`;
      default:
        return "-".repeat(w);
    }
  };

  const header = `| ${table.header.map((c, i) => padCell(c, widths[i])).join(" | ")} |`;
  const sep = `| ${table.alignments.map((a, i) => sepCell(a, widths[i])).join(" | ")} |`;
  const body = table.body.map(
    (row) => `| ${row.map((c, i) => padCell(c, widths[i])).join(" | ")} |`,
  );
  return [header, sep, ...body];
}

export function createEmptyTable(rows: number, cols: number): MarkdownTable {
  const columnCount = Math.max(1, cols);
  const bodyRows = Math.max(1, rows);
  const header = Array.from({ length: columnCount }, (_, i) => `列${i + 1}`);
  const alignments = Array.from(
    { length: columnCount },
    () => "none" as ColumnAlignment,
  );
  const body = Array.from({ length: bodyRows }, () =>
    Array.from({ length: columnCount }, () => ""),
  );
  return {
    startLine: 0,
    endLine: 1 + bodyRows,
    header,
    alignments,
    body,
    columnCount,
  };
}

/** Replace table lines in a line array; returns new lines and the new table span. */
export function replaceTableLines(
  lines: string[],
  table: MarkdownTable,
  nextTable: MarkdownTable,
  serialized?: string[],
): { lines: string[]; startLine: number; endLine: number } {
  const tableLines = serialized ?? serializeTable(nextTable);
  const result = [
    ...lines.slice(0, table.startLine),
    ...tableLines,
    ...lines.slice(table.endLine + 1),
  ];
  return {
    lines: result,
    startLine: table.startLine,
    endLine: table.startLine + tableLines.length - 1,
  };
}

/** Compute absolute offset for the start of a cell after a table rewrite. */
export function cellContentOffset(
  lines: string[],
  lineIndex: number,
  col: number,
): { from: number; to: number } | null {
  let offset = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    offset += lines[i].length + 1;
  }
  const ranges = getCellContentRanges(lines[lineIndex] ?? "");
  if (!ranges[col]) return null;
  return {
    from: offset + ranges[col].from,
    to: offset + ranges[col].to,
  };
}

export function isCellEmpty(
  table: MarkdownTable,
  logicalRow: number,
  col: number,
): boolean {
  const cells = getLogicalRowCells(table, logicalRow);
  return (cells[col] ?? "").trim() === "";
}

/** Set a single cell's raw markdown text (logicalRow 0 = header). */
export function setTableCell(
  table: MarkdownTable,
  logicalRow: number,
  col: number,
  value: string,
): MarkdownTable {
  const columnCount = table.columnCount;
  const c = Math.max(0, Math.min(col, columnCount - 1));

  if (logicalRow <= 0) {
    const header = normalizeRowWidth(table.header, columnCount);
    header[c] = value;
    return { ...table, header };
  }

  const bodyIndex = logicalRow - 1;
  const body = table.body.map((row) => normalizeRowWidth(row, columnCount));
  while (body.length <= bodyIndex) {
    body.push(Array.from({ length: columnCount }, () => ""));
  }
  body[bodyIndex] = [...body[bodyIndex]];
  body[bodyIndex][c] = value;
  return {
    ...table,
    body,
    endLine: table.startLine + 1 + body.length,
  };
}
