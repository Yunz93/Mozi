import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  DEFAULT_AI_SYSTEM_PROMPT_EN,
  DEFAULT_WIKI_PROMPT_TEMPLATE,
  DEFAULT_WIKI_PROMPT_TEMPLATE_EN,
  resolveAISystemPrompt,
  resolveWikiPromptTemplate,
} from "./aiPrompts";
import { buildWikiPrompt, ensureAIConfiguration } from "./aiService";
import { defaultSettings } from "../store/appStore";

describe("DEFAULT_AI_SYSTEM_PROMPT", () => {
  it("includes Chinese knowledge-base guidance by default", () => {
    expect(DEFAULT_AI_SYSTEM_PROMPT).toContain("知识库式表达");
    expect(DEFAULT_AI_SYSTEM_PROMPT).toContain("类似百科条目的结构化组织方式");
    expect(DEFAULT_AI_SYSTEM_PROMPT).toContain("参考资料、引用说明和术语");
    expect(DEFAULT_AI_SYSTEM_PROMPT_EN).toContain("knowledge-base style");
  });

  it("still allows custom prompt override", () => {
    expect(resolveAISystemPrompt("custom prompt")).toBe("custom prompt");
  });

  it("resolves language-specific prompts with legacy fallback", () => {
    expect(
      resolveAISystemPrompt({ language: "en", zhCN: "中文", en: "English" }),
    ).toBe("English");
    expect(
      resolveAISystemPrompt({ language: "zh-CN", legacy: "Legacy prompt" }),
    ).toBe("Legacy prompt");
  });
});

describe("DEFAULT_WIKI_PROMPT_TEMPLATE", () => {
  it("contains localized wikipedia-like defaults", () => {
    expect(DEFAULT_WIKI_PROMPT_TEMPLATE).toContain("百科风格 Wiki 词条");
    expect(DEFAULT_WIKI_PROMPT_TEMPLATE).toContain("控制范围");
    expect(DEFAULT_WIKI_PROMPT_TEMPLATE_EN).toContain("Wikipedia-style entry");
    expect(DEFAULT_WIKI_PROMPT_TEMPLATE_EN).toContain("Keep the scope tight");
  });

  it("still allows custom wiki prompt override", () => {
    expect(resolveWikiPromptTemplate("custom wiki prompt")).toBe(
      "custom wiki prompt",
    );
  });

  it("resolves language-specific wiki prompts with legacy fallback", () => {
    expect(
      resolveWikiPromptTemplate({
        language: "en",
        zhCN: "中文模板",
        en: "English template",
      }),
    ).toBe("English template");
    expect(
      resolveWikiPromptTemplate({ language: "zh-CN", legacy: "Legacy wiki" }),
    ).toBe("Legacy wiki");
  });
});

describe("buildWikiPrompt", () => {
  it("uses the default Chinese wiki template when no language-specific override is provided", () => {
    const prompt = buildWikiPrompt({
      selectedText: "OpenAI API",
      contextBefore: "This article references the OpenAI API.",
      contextAfter: "The next paragraph discusses billing.",
      documentTitle: "API Guide",
      currentFileName: "api-guide",
      isFrontmatterSelection: false,
    });

    expect(prompt).toContain("百科风格 Wiki 词条");
    expect(prompt).toContain("周边上下文只用于消歧");
    expect(prompt).toContain("控制范围");
    expect(prompt).toContain(
      "不要把“参考资料”“References”“引用说明”或 “Citation Notes” 直接写进 markdown 正文",
    );
  });

  it("uses a custom wiki prompt template when provided", () => {
    const prompt = buildWikiPrompt(
      {
        selectedText: "OpenAI API",
        contextBefore: "",
        contextAfter: "",
        documentTitle: "API Guide",
        currentFileName: "api-guide",
        isFrontmatterSelection: false,
      },
      "Custom wiki rules only.",
    );

    expect(prompt).toContain("Custom wiki rules only.");
    expect(prompt).not.toContain("Keep the scope tight");
  });

  it("uses the language-matched wiki prompt variant when provided", () => {
    const prompt = buildWikiPrompt(
      {
        selectedText: "OpenAI API",
        contextBefore: "",
        contextAfter: "",
        documentTitle: "API Guide",
        currentFileName: "api-guide",
        isFrontmatterSelection: false,
      },
      {
        language: "en",
        zhCN: "中文模板",
        en: "English wiki template.",
        legacy: "Legacy wiki template.",
      },
    );

    expect(prompt).toContain("English wiki template.");
    expect(prompt).not.toContain("中文模板");
  });
});

describe("ensureAIConfiguration", () => {
  it("requires a DeepSeek API key when DeepSeek is selected", () => {
    expect(() =>
      ensureAIConfiguration({
        ...defaultSettings,
        aiProvider: "deepseek",
        deepseekApiKey: "",
      }),
    ).toThrow("MISSING_API_KEY");
  });

  it("accepts DeepSeek settings with a DeepSeek model name", () => {
    expect(
      ensureAIConfiguration({
        ...defaultSettings,
        aiProvider: "deepseek",
        deepseekApiKey: "sk-test",
        deepseekModel: "deepseek-v4-flash",
      }),
    ).toEqual({ ok: true });
  });
});
