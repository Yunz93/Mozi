import TurndownService from "turndown";
import {
  serializeTable,
  type ColumnAlignment,
  type MarkdownTable,
} from "./markdownTable";

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

interface HtmlNodeLike {
  nodeName: string;
  nodeType: number;
  nodeValue: string | null;
  parentNode: HtmlNodeLike | null;
  firstChild: HtmlNodeLike | null;
  nextSibling: HtmlNodeLike | null;
}

function isNestedTable(node: HtmlNodeLike): boolean {
  let parent = node.parentNode;
  while (parent) {
    if (parent.nodeName === "TABLE") return true;
    parent = parent.parentNode;
  }
  return false;
}

function owningTable(node: HtmlNodeLike): HtmlNodeLike | null {
  let parent = node.parentNode;
  while (parent) {
    if (parent.nodeName === "TABLE") return parent;
    parent = parent.parentNode;
  }
  return null;
}

function collectDirectRows(table: HtmlNodeLike): HtmlNodeLike[] {
  const rows: HtmlNodeLike[] = [];
  const walk = (node: HtmlNodeLike | null) => {
    if (!node) return;
    if (node.nodeName === "TABLE" && node !== table) return;
    if (node.nodeName === "TR" && owningTable(node) === table) {
      rows.push(node);
      return;
    }
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  };
  walk(table);
  return rows;
}

function collectRowCells(row: HtmlNodeLike): HtmlNodeLike[] {
  const cells: HtmlNodeLike[] = [];
  let child = row.firstChild;
  while (child) {
    if (child.nodeName === "TD" || child.nodeName === "TH") {
      cells.push(child);
    }
    child = child.nextSibling;
  }
  return cells;
}

function cellPlainText(cell: HtmlNodeLike): string {
  let out = "";
  const walk = (node: HtmlNodeLike | null) => {
    if (!node) return;
    if (node.nodeName === "TABLE") return;
    if (node.nodeType === 3) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeName === "BR") {
      out += " ";
      return;
    }
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  };
  walk(cell);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Convert an HTML `<table>` DOM node to a GFM pipe table.
 * Excel-like tables with only `<td>` use the first row as the header.
 * Nested tables are skipped (their text is omitted from the cell).
 */
export function htmlTableNodeToGfm(table: HtmlNodeLike): string {
  const rows = collectDirectRows(table)
    .map((row) => {
      const cells = collectRowCells(row);
      return { cells, texts: cells.map(cellPlainText) };
    })
    .filter((row) => row.cells.length > 0);

  if (rows.length === 0) return "";

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);
  const columnCount = Math.max(...rows.map((row) => row.texts.length), 1);
  const alignments: ColumnAlignment[] = Array.from(
    { length: columnCount },
    () => "none",
  );

  const tableModel: MarkdownTable = {
    startLine: 0,
    endLine: 0,
    header: headerRow.texts,
    alignments,
    body: bodyRows.map((row) => row.texts),
    columnCount,
  };

  return serializeTable(tableModel).join("\n");
}

function addGfmTableRule(service: TurndownService): void {
  service.addRule("gfmTable", {
    filter: (node) =>
      node.nodeName === "TABLE" && !isNestedTable(node as HtmlNodeLike),
    replacement: (_content, node) => {
      const markdown = htmlTableNodeToGfm(node as HtmlNodeLike);
      return markdown ? `\n\n${markdown}\n\n` : "";
    },
  });
}

let turndownService: TurndownService | null = null;

function getTurndownService(): TurndownService {
  if (!turndownService) {
    turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
      strongDelimiter: "**",
    });
    addGfmTableRule(turndownService);
  }
  return turndownService;
}

/**
 * Convert HTML clipboard content to Markdown.
 * Scripts/styles are stripped before conversion.
 */
export function convertHtmlToMarkdown(html: string): string {
  const cleaned = stripScriptsAndStyles(html).trim();
  if (!cleaned) return "";

  return getTurndownService().turndown(cleaned).trim();
}
