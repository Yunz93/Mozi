/**
 * Slash-menu catalog for inserts that are awkward to type as raw Markdown.
 */

import type { AppLanguage } from "../types";
import type { TranslationKey } from "./i18n";
import { t } from "./i18n";
import {
  parseTableInsertSlashQuery,
  type TableInsertSize,
} from "./tableInsert";

export type SlashInsertKind =
  | "table-picker"
  | "table-sized"
  | "callout-note"
  | "todo"
  | "mermaid-flowchart"
  | "mermaid-sequence"
  | "math-block"
  | "code-fence"
  | "wiki-embed"
  | "footnote";

export interface SlashInsertCommand {
  id: Exclude<SlashInsertKind, "table-sized">;
  aliases: string[];
  labelKey: TranslationKey;
  detailKey: TranslationKey;
}

export interface SlashInsertMatch {
  id: SlashInsertKind;
  labelKey: TranslationKey;
  detailKey?: TranslationKey;
  tableSize?: TableInsertSize;
}

export interface SlashInsertSnippet {
  text: string;
  cursor: number;
  select: number;
}

export const SLASH_INSERT_COMMANDS: SlashInsertCommand[] = [
  {
    id: "table-picker",
    aliases: [
      "table",
      "表格",
      "biaoge",
      "biao",
      "bg",
      "gfm",
      "插入表格",
      "insert table",
      "inserttable",
    ],
    labelKey: "table_insert",
    detailKey: "table_insertPickerHint",
  },
  {
    id: "callout-note",
    aliases: [
      "note",
      "tip",
      "说明",
      "插入说明",
      "提示",
      "提示块",
      "高亮",
      "高亮块",
      "callout",
      "插入提示",
    ],
    labelKey: "slash_calloutNote",
    detailKey: "slash_calloutHint",
  },
  {
    id: "todo",
    aliases: [
      "todo",
      "task",
      "checkbox",
      "checklist",
      "待办",
      "待办项",
      "任务",
      "任务列表",
      "插入待办",
      "插入待办项",
    ],
    labelKey: "slash_todo",
    detailKey: "slash_todoHint",
  },
  {
    id: "mermaid-flowchart",
    aliases: ["mermaid", "flowchart", "flow", "流程图", "流程", "插入流程图"],
    labelKey: "slash_mermaidFlow",
    detailKey: "slash_mermaidHint",
  },
  {
    id: "mermaid-sequence",
    aliases: ["mermaid", "sequence", "seq", "时序图", "时序", "插入时序图"],
    labelKey: "slash_mermaidSequence",
    detailKey: "slash_mermaidHint",
  },
  {
    id: "math-block",
    aliases: ["math", "latex", "katex", "tex", "公式", "插入公式"],
    labelKey: "slash_mathBlock",
    detailKey: "slash_mathHint",
  },
  {
    id: "code-fence",
    aliases: ["code", "代码", "代码块", "fence", "插入代码块"],
    labelKey: "slash_codeFence",
    detailKey: "slash_codeHint",
  },
  {
    id: "wiki-embed",
    aliases: [
      "embed",
      "wiki",
      "wikilink",
      "嵌入",
      "嵌入笔记",
      "嵌入图片",
      "双链",
    ],
    labelKey: "slash_wikiEmbed",
    detailKey: "slash_wikiEmbedHint",
  },
  {
    id: "footnote",
    aliases: ["footnote", "fn", "脚注", "插入脚注"],
    labelKey: "slash_footnote",
    detailKey: "slash_footnoteHint",
  },
];

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesAlias(alias: string, query: string): boolean {
  const normalizedAlias = normalizeQuery(alias);
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return true;
  return (
    normalizedAlias.startsWith(normalizedQuery) ||
    normalizedQuery.startsWith(normalizedAlias)
  );
}

export function resolveSlashInsert(query: string): SlashInsertMatch[] {
  const table = parseTableInsertSlashQuery(query);
  if (table.mode === "sized") {
    return [
      {
        id: "table-sized",
        labelKey: "table_insertSized",
        tableSize: {
          visualRows: table.visualRows,
          cols: table.cols,
        },
      },
    ];
  }

  return SLASH_INSERT_COMMANDS.filter((command) =>
    command.aliases.some((alias) => matchesAlias(alias, query)),
  ).map((command) => ({
    id: command.id,
    labelKey: command.labelKey,
    detailKey: command.detailKey,
  }));
}

export function nextFootnoteLabel(doc: string): string {
  let max = 0;
  for (const match of doc.matchAll(/\[\^(\d+)\]/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return String(max + 1);
}

function calloutSnippet(
  type: string,
  title: string,
  body: string,
): SlashInsertSnippet {
  const first = `> [!${type}] ${title}\n> `;
  return {
    text: `${first}${body}`,
    cursor: first.length,
    select: body.length,
  };
}

export function buildSlashInsertSnippet(
  id: Exclude<SlashInsertKind, "table-picker" | "table-sized" | "footnote">,
  language: AppLanguage,
): SlashInsertSnippet {
  const body = t(language, "slash_placeholderBody");

  if (id === "callout-note") {
    return calloutSnippet("note", t(language, "slash_calloutTitleNote"), body);
  }
  if (id === "todo") {
    const prefix = "- [ ] ";
    return {
      text: `${prefix}${body}`,
      cursor: prefix.length,
      select: body.length,
    };
  }
  if (id === "mermaid-flowchart") {
    const start = t(language, "slash_mermaidStart");
    const step = t(language, "slash_mermaidStep");
    const end = t(language, "slash_mermaidEnd");
    const prefix = "```mermaid\nflowchart LR\n  A([";
    const mid = `]) --> B[`;
    const suffix = `]\n  B --> C([${end}])\n\`\`\``;
    return {
      text: `${prefix}${start}${mid}${step}${suffix}`,
      cursor: prefix.length + start.length + mid.length,
      select: step.length,
    };
  }
  if (id === "mermaid-sequence") {
    const client = t(language, "slash_mermaidClient");
    const server = t(language, "slash_mermaidServer");
    const request = t(language, "slash_mermaidRequest");
    const response = t(language, "slash_mermaidResponse");
    const prefix = `\`\`\`mermaid\nsequenceDiagram\n  participant A as ${client}\n  participant B as ${server}\n  A->>B: `;
    const suffix = `\n  B-->>A: ${response}\n\`\`\``;
    return {
      text: `${prefix}${request}${suffix}`,
      cursor: prefix.length,
      select: request.length,
    };
  }
  if (id === "math-block") {
    return { text: "$$\n\n$$", cursor: 3, select: 0 };
  }
  if (id === "code-fence") {
    return { text: "```\n\n```", cursor: 3, select: 0 };
  }
  return { text: "![[]]", cursor: 3, select: 0 };
}

export function buildFootnoteInsert(
  doc: string,
  replaceFrom: number,
  replaceTo: number,
): { ref: string; definition: string; definitionInsertFrom: number } {
  const withoutQuery = doc.slice(0, replaceFrom) + doc.slice(replaceTo);
  const label = nextFootnoteLabel(withoutQuery);
  const ref = `[^${label}]`;
  return {
    ref,
    definition: `\n\n[^${label}]: `,
    definitionInsertFrom: doc.length,
  };
}
