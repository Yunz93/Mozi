/**
 * Helpers for inserting a GFM table from slash input, palette, or picker.
 * Visual size includes the header row (a 3×3 table is 1 header + 2 body rows).
 */

import { useAppStore } from "../store/appStore";
import { t } from "./i18n";

export const TABLE_INSERT_MIN_ROWS = 2;
export const TABLE_INSERT_MAX_ROWS = 12;
export const TABLE_INSERT_MIN_COLS = 1;
export const TABLE_INSERT_MAX_COLS = 10;
export const TABLE_INSERT_DEFAULT_ROWS = 3;
export const TABLE_INSERT_DEFAULT_COLS = 3;
export const TABLE_INSERT_PICKER_MAX_ROWS = 6;
export const TABLE_INSERT_PICKER_MAX_COLS = 8;

export interface TableInsertSize {
  visualRows: number;
  cols: number;
}

export type TableInsertSlashMode = "none" | "picker" | "sized";

export interface TableInsertSlashQuery extends TableInsertSize {
  mode: TableInsertSlashMode;
}

const SIZE_TOKEN = /^(\d{1,2})\s*(?:[x×*]|,|，)\s*(\d{1,2})$/i;
const ALIAS_THEN_SIZE =
  /^(?:table|表格|biaoge|biao|bg)\s*(\d{1,2})\s*(?:[x×*]|,|，)\s*(\d{1,2})$/i;

const TABLE_ALIASES = [
  "table",
  "表格",
  "biaoge",
  "biao",
  "bg",
  "inserttable",
  "gfm",
  "插入表格",
  "insert table",
];

export function clampTableInsertSize(
  visualRows: number,
  cols: number,
): TableInsertSize {
  const rows = Number.isFinite(visualRows)
    ? Math.floor(visualRows)
    : TABLE_INSERT_DEFAULT_ROWS;
  const columns = Number.isFinite(cols)
    ? Math.floor(cols)
    : TABLE_INSERT_DEFAULT_COLS;
  return {
    visualRows: Math.min(
      TABLE_INSERT_MAX_ROWS,
      Math.max(TABLE_INSERT_MIN_ROWS, rows),
    ),
    cols: Math.min(
      TABLE_INSERT_MAX_COLS,
      Math.max(TABLE_INSERT_MIN_COLS, columns),
    ),
  };
}

export function bodyRowsForVisualRows(visualRows: number): number {
  return Math.max(1, visualRows - 1);
}

export function tableInsertHeaderLabels(cols: number): string[] {
  const language = useAppStore.getState().settings.language;
  const prefix = t(language, "table_columnPrefix");
  return Array.from(
    { length: Math.max(1, cols) },
    (_, i) => `${prefix}${i + 1}`,
  );
}

function parseSizeToken(raw: string): TableInsertSize | null {
  const match = raw.trim().match(SIZE_TOKEN);
  if (!match) return null;
  return clampTableInsertSize(Number(match[1]), Number(match[2]));
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesTableAlias(query: string): boolean {
  if (!query) return true;
  return TABLE_ALIASES.some(
    (alias) => alias.startsWith(query) || query.startsWith(alias),
  );
}

export function parseTableInsertSlashQuery(
  query: string,
): TableInsertSlashQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      mode: "picker",
      visualRows: TABLE_INSERT_DEFAULT_ROWS,
      cols: TABLE_INSERT_DEFAULT_COLS,
    };
  }

  const sizeOnly = parseSizeToken(trimmed);
  if (sizeOnly) {
    return { mode: "sized", ...sizeOnly };
  }

  const aliasSize = trimmed.match(ALIAS_THEN_SIZE);
  if (aliasSize) {
    return {
      mode: "sized",
      ...clampTableInsertSize(Number(aliasSize[1]), Number(aliasSize[2])),
    };
  }

  if (
    matchesTableAlias(normalizeQuery(trimmed)) ||
    matchesTableAlias(trimmed)
  ) {
    return {
      mode: "picker",
      visualRows: TABLE_INSERT_DEFAULT_ROWS,
      cols: TABLE_INSERT_DEFAULT_COLS,
    };
  }

  return {
    mode: "none",
    visualRows: TABLE_INSERT_DEFAULT_ROWS,
    cols: TABLE_INSERT_DEFAULT_COLS,
  };
}
