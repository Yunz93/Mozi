import type { AppSettings } from "../../types";
import { resolveAISystemPrompt, resolveWikiPromptTemplate } from "../aiPrompts";

export interface WikiPromptOptions {
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  documentTitle: string;
  currentFileName: string;
  isFrontmatterSelection: boolean;
}

/**
 * The Markdown analysis prompt shared by every AI provider. Previously this
 * block was copied verbatim into geminiService, codexService and
 * deepseekService.
 */
export function buildAnalyzeMarkdownPrompt(content: string): string {
  return `
You are editing Markdown content for publication quality.
Do all of the following:
1. Fix spelling and obvious grammar issues.
2. Improve Markdown structure and formatting without changing meaning.
3. Keep code blocks, links, and technical terms intact.
4. Generate a concise SEO summary (max 160 characters).
5. Suggest 5 relevant SEO tags.
6. Propose a better SEO title only if the current title is weak.

Return a JSON object with:
- summary: string
- suggestedTags: string[]
- seoTitle: string
- optimizedMarkdown: string

Markdown content:
${content}
  `.trim();
}

/**
 * Resolve the system instruction for a provider from the user's settings,
 * collapsing the repeated `resolveAISystemPrompt({ language, zhCN, en, legacy })`
 * blocks that previously appeared in each provider/router.
 */
export function resolveProviderSystemPrompt(settings: AppSettings): string {
  return resolveAISystemPrompt({
    language: settings.language,
    zhCN: settings.aiSystemPromptZh,
    en: settings.aiSystemPromptEn,
    legacy: settings.aiSystemPrompt,
  });
}

/**
 * Build the wiki-article generation prompt used by every provider.
 */
export function buildWikiPrompt(
  options: WikiPromptOptions,
  customTemplate?:
    | string
    | {
        language?: AppSettings["language"];
        zhCN?: string;
        en?: string;
        legacy?: string;
      },
): string {
  const {
    selectedText,
    contextBefore,
    contextAfter,
    documentTitle,
    currentFileName,
    isFrontmatterSelection,
  } = options;
  const wikiPromptTemplate = resolveWikiPromptTemplate(customTemplate);

  return `
You are helping maintain a markdown-based knowledge base.
${wikiPromptTemplate}

Return a JSON object with:
- title: string
- summary: string
- category: string
- suggestedTags: string[]
- markdown: string
- references: Array<{ title: string; url?: string; note?: string }>
- citations: string[]

Current note title: ${documentTitle || currentFileName || "Untitled"}
Current file name: ${currentFileName || "Untitled"}
Selection source: ${isFrontmatterSelection ? "frontmatter" : "body"}
Selected text:
${selectedText}

Context before:
${contextBefore || "(empty)"}

Context after:
${contextAfter || "(empty)"}
  `.trim();
}

/**
 * Build the wiki prompt template selector from settings (used by the facade).
 */
export function resolveProviderWikiTemplate(settings: AppSettings): {
  language: AppSettings["language"];
  zhCN?: string;
  en?: string;
  legacy?: string;
} {
  return {
    language: settings.language,
    zhCN: settings.wikiPromptTemplateZh,
    en: settings.wikiPromptTemplateEn,
    legacy: settings.wikiPromptTemplate,
  };
}

export interface AskVaultPromptChunk {
  index: number;
  path: string;
  titlePath: string[];
  startLine: number;
  endLine: number;
  text: string;
}

export function buildAskVaultPrompt(
  question: string,
  chunks: AskVaultPromptChunk[],
  previousQuestion?: string,
): string {
  const sources = chunks
    .map(
      (chunk) =>
        `[${chunk.index}] ${chunk.path} (${chunk.titlePath.join(" > ") || "note"}; L${chunk.startLine}-L${chunk.endLine})\n${chunk.text}`,
    )
    .join("\n\n");

  const followUp = previousQuestion?.trim()
    ? `\nPrevious question (for follow-up context only; still answer from excerpts):\n${previousQuestion.trim()}\n`
    : "";

  return `
You are XiaoZhi (小知助手), a local knowledge-base assistant.
You answer questions ONLY using the numbered knowledge-base excerpts below.
Rules:
1. If the excerpts are insufficient, say you could not find enough information in the vault.
2. Do not invent facts that are not supported by the excerpts.
3. Cite sources using [n] markers that match excerpt numbers.
4. Prefer concise Markdown answers.
5. If this is a follow-up, interpret it against the previous question, but still cite only the excerpts.

Return JSON with:
- answerMarkdown: string (Markdown answer with [n] citations)
- citationIndexes: number[] (the excerpt numbers you relied on)
${followUp}
Question:
${question}

Excerpts:
${sources || "(none)"}
  `.trim();
}
