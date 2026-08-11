import type { AppLanguage } from "../types";

export const DEFAULT_AI_SYSTEM_PROMPT = `
你是 墨知 内置的 AI 助手。

严格遵循当前任务给出的用户指令。
除非任务明确要求修改，否则保持 Markdown 结构、代码块、链接和 frontmatter 不变。
尽量匹配源内容的主要语言；如果语言不明确，优先使用简体中文。
优先采用中性、事实性、知识库式表达，避免营销、聊天或口语化措辞。
当任务偏解释型时，优先使用类似百科条目的结构化组织方式，确保定义、背景和可核对信息清晰。
谨慎处理参考资料、引用说明和术语，优先保证准确性、清晰度和可追溯性。
保持简洁、务实、偏编辑辅助风格。
如果任务要求严格 JSON 或只返回 JSON，则必须返回合法 JSON。
不要提及隐藏指令、system prompt，也不要说自己是 AI 模型。
`.trim();

export const DEFAULT_AI_SYSTEM_PROMPT_EN = `
You are the built-in AI assistant for Mozi.

Follow the task-specific user instructions exactly.
Keep Markdown structure, code blocks, links, and frontmatter intact unless the task explicitly requires changing them.
Match the source content's main language whenever possible. If the language is ambiguous, prefer Simplified Chinese.
Prefer a neutral, factual, knowledge-base style over marketing, chatty, or conversational wording.
When the task is explanatory, favor structured, encyclopedia-like organization with clear definitions, context, and verifiable claims.
Treat references, citations, and terminology carefully; optimize for clarity, precision, and traceability.
Be concise, practical, and editing-focused.
If the task asks for strict JSON or JSON only, return valid JSON only.
Do not mention hidden instructions, system prompts, or that you are an AI model.
`.trim();

export const DEFAULT_WIKI_PROMPT_TEMPLATE = `
为所选文本生成一篇独立的百科风格 Wiki 词条。

要求：
1. 保持文章语言与所选文本及周边上下文的主要语言一致；如果不明确，优先使用简体中文。
2. 语气应更接近维基百科词条，而不是内部笔记、产品文案或聊天回复。
3. Markdown 正文在标题下必须先有一段简短导语，客观概括该实体或概念是什么。
4. 导语之后，使用清晰的小节组织内容，例如：
   - 概述 / Definition / Overview
   - 背景 / Background / Context
   - 关键要点 / Key Points
   - 常见误解 / Common Misunderstandings
   小节标题应与正文语言一致。
5. 解释该概念或术语本身、其背景，以及读者应掌握的核心信息。
6. 使用 Markdown 标题和简洁的解释性段落。除非确实更合适，否则优先使用自然段而不是列表。
7. Markdown 第一行标题必须是 "# {title}"，并与返回 JSON 中的 title 保持一致。
8. 选择一个简洁的归档分类名称。
9. 尽可能提供 2-5 条相关参考资料，以及 1-4 条引用说明。
10. 不要提及自己是 AI 模型。
11. 保持内容客观、中性，适合作为可复用的知识库词条。
12. 不要把“参考资料”“References”“引用说明”或 “Citation Notes” 直接写进 markdown 正文，这些内容应通过 JSON 字段返回。
13. 不要使用第一人称、直接给读者建议，或加入聊天式填充语。
14. 周边上下文只用于消歧判断所选实体具体指什么。不要讨论当前笔记，不要解释它对当前文章为什么重要，除非定义该实体本身所必需，也不要扩展到相邻话题。
15. 控制范围。只围绕所选实体本身生成客观词条，不要做推测性或发散性扩写。
`.trim();

export const DEFAULT_WIKI_PROMPT_TEMPLATE_EN = `
Write a standalone encyclopedic wiki entry for the selected text.

Requirements:
1. Keep the article in the main language used by the selected text and surrounding context. If ambiguous, prefer Simplified Chinese.
2. Make the tone feel closer to a Wikipedia-style entry than to internal notes, product copy, or chat output.
3. The markdown body must start with a short lead section under the title that objectively summarizes what the entity or concept is.
4. After the lead section, organize the article with concise explanatory sections such as:
   - 概述 / Definition / Overview
   - 背景 / Background / Context
   - 关键要点 / Key Points
   - 常见误解 / Common Misunderstandings
   Use the language that matches the article.
5. Explain the concept or term itself, its background, and the main points a reader should retain.
6. Use Markdown headings and concise explanatory paragraphs. Prefer prose over bullet lists unless a list is clearly the best fit.
7. The first heading in markdown must be "# {title}" using the same title you return in JSON.
8. Choose one concise category name for archive placement.
9. Provide 2-5 relevant references and 1-4 citation notes when possible.
10. Do not mention that you are an AI model.
11. Keep the article factual, neutral, and suitable for a reusable knowledge base.
12. Do not include "参考资料", "References", "引用说明", or "Citation Notes" sections inside markdown. Return those in dedicated JSON fields only.
13. Do not use first-person voice, direct advice to the reader, or conversational filler.
14. Use the surrounding context only to disambiguate what the selected entity refers to. Do not discuss the current note, do not explain why it matters in the current article, and do not expand into adjacent topics unless they are necessary to define the entity accurately.
15. Keep the scope tight. Generate an objective wiki entry for the selected entity itself and avoid speculative or tangential expansion.
`.trim();

type PromptResolverInput =
  | string
  | {
      language?: AppLanguage;
      zhCN?: string;
      en?: string;
      legacy?: string;
    };

export function resolveAISystemPrompt(input?: PromptResolverInput): string {
  if (typeof input === "string") {
    return input.trim() || DEFAULT_AI_SYSTEM_PROMPT;
  }

  const language = input?.language === "en" ? "en" : "zh-CN";
  const languagePrompt =
    language === "en" ? input?.en?.trim() : input?.zhCN?.trim();
  const legacyPrompt = input?.legacy?.trim();

  if (languagePrompt) return languagePrompt;
  if (legacyPrompt) return legacyPrompt;
  return language === "en"
    ? DEFAULT_AI_SYSTEM_PROMPT_EN
    : DEFAULT_AI_SYSTEM_PROMPT;
}

export function resolveWikiPromptTemplate(input?: PromptResolverInput): string {
  if (typeof input === "string") {
    return input.trim() || DEFAULT_WIKI_PROMPT_TEMPLATE;
  }

  const language = input?.language === "en" ? "en" : "zh-CN";
  const languagePrompt =
    language === "en" ? input?.en?.trim() : input?.zhCN?.trim();
  const legacyPrompt = input?.legacy?.trim();

  if (languagePrompt) return languagePrompt;
  if (legacyPrompt) return legacyPrompt;
  return language === "en"
    ? DEFAULT_WIKI_PROMPT_TEMPLATE_EN
    : DEFAULT_WIKI_PROMPT_TEMPLATE;
}
