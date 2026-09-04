import type {
  AIAnalysisResult,
  AIWikiGenerationResult,
  AppSettings,
} from "../types";
import { analyzeContent, generateGeminiWikiArticle } from "./geminiService";
import {
  analyzeContentWithCodex,
  generateCodexWikiArticle,
} from "./codexService";
import {
  analyzeContentWithDeepSeek,
  generateDeepSeekWikiArticle,
} from "./deepseekService";
import {
  buildWikiPrompt,
  resolveProviderSystemPrompt,
  resolveProviderWikiTemplate,
  type WikiPromptOptions,
} from "./ai/prompts";
import { generateGeminiJson, buildAskVaultGeminiSchema } from "./geminiService";
import { generateCodexJson } from "./codexService";
import { generateDeepSeekJson } from "./deepseekService";
import { AiServiceError } from "./ai/errors";

export { buildWikiPrompt };

type AIProviderId = "gemini" | "codex" | "deepseek";

function resolveProviderId(settings: AppSettings): AIProviderId {
  if (settings.aiProvider === "codex") return "codex";
  if (settings.aiProvider === "deepseek") return "deepseek";
  return "gemini";
}

function looksLikeGeminiModel(modelName: string): boolean {
  return /^gemini(?:-|$)/i.test(modelName.trim());
}

function looksLikeCodexModel(modelName: string): boolean {
  return /^(gpt-|o[1-9]\b|o[1-9]-|codex\b|computer-use\b)/i.test(
    modelName.trim(),
  );
}

function looksLikeDeepSeekModel(modelName: string): boolean {
  return /^deepseek(?:-|$)/i.test(modelName.trim());
}

interface AIProvider {
  validateConfig(settings: AppSettings): void;
  analyze(content: string, settings: AppSettings): Promise<AIAnalysisResult>;
  generateWiki(
    prompt: string,
    settings: AppSettings,
  ): Promise<AIWikiGenerationResult>;
}

const PROVIDERS: Record<AIProviderId, AIProvider> = {
  gemini: {
    validateConfig(settings) {
      if (!settings.geminiApiKey?.trim()) {
        throw new AiServiceError("MISSING_API_KEY", { provider: "gemini" });
      }
      if (
        settings.geminiModel?.trim() &&
        !looksLikeGeminiModel(settings.geminiModel)
      ) {
        throw new AiServiceError("INVALID_MODEL", { provider: "gemini" });
      }
    },
    analyze(content, settings) {
      return analyzeContent(
        content,
        settings.geminiApiKey || "",
        settings.geminiModel || "gemini-2.0-flash-exp",
        resolveProviderSystemPrompt(settings),
      );
    },
    generateWiki(prompt, settings) {
      return generateGeminiWikiArticle(
        prompt,
        settings.geminiApiKey || "",
        settings.geminiModel || "gemini-2.0-flash-exp",
        resolveProviderSystemPrompt(settings),
      );
    },
  },
  codex: {
    validateConfig(settings) {
      if (!settings.codexApiKey?.trim()) {
        throw new AiServiceError("MISSING_API_KEY", { provider: "openai" });
      }
      if (
        settings.codexModel?.trim() &&
        !looksLikeCodexModel(settings.codexModel)
      ) {
        throw new AiServiceError("INVALID_MODEL", { provider: "openai" });
      }
    },
    analyze: analyzeContentWithCodex,
    generateWiki: generateCodexWikiArticle,
  },
  deepseek: {
    validateConfig(settings) {
      if (!settings.deepseekApiKey?.trim()) {
        throw new AiServiceError("MISSING_API_KEY", { provider: "deepseek" });
      }
      if (
        settings.deepseekModel?.trim() &&
        !looksLikeDeepSeekModel(settings.deepseekModel)
      ) {
        throw new AiServiceError("INVALID_MODEL", { provider: "deepseek" });
      }
    },
    analyze: analyzeContentWithDeepSeek,
    generateWiki: generateDeepSeekWikiArticle,
  },
};

export function ensureAIConfiguration(settings: AppSettings): { ok: true } {
  PROVIDERS[resolveProviderId(settings)].validateConfig(settings);
  return { ok: true };
}

export async function analyzeMarkdownWithProvider(
  content: string,
  settings: AppSettings,
): Promise<AIAnalysisResult> {
  return PROVIDERS[resolveProviderId(settings)].analyze(content, settings);
}

export async function generateWikiFromSelectionWithProvider(
  options: WikiPromptOptions,
  settings: AppSettings,
): Promise<AIWikiGenerationResult> {
  const prompt = buildWikiPrompt(
    options,
    resolveProviderWikiTemplate(settings),
  );
  return PROVIDERS[resolveProviderId(settings)].generateWiki(prompt, settings);
}

/**
 * Shared JSON completion used by Ask Vault (and future structured AI tools).
 */
export async function completeJsonWithProvider<T>(
  prompt: string,
  settings: AppSettings,
  options?: {
    systemPrompt?: string;
    geminiSchema?: Record<string, unknown>;
    useAskVaultGeminiSchema?: boolean;
  },
): Promise<T> {
  ensureAIConfiguration(settings);
  const providerId = resolveProviderId(settings);
  const systemPrompt =
    options?.systemPrompt ?? resolveProviderSystemPrompt(settings);

  if (providerId === "gemini") {
    const schema = options?.useAskVaultGeminiSchema
      ? await buildAskVaultGeminiSchema()
      : (options?.geminiSchema ?? {
          type: "object",
          properties: {},
        });
    return generateGeminiJson<T>({
      apiKey: settings.geminiApiKey || "",
      modelName: settings.geminiModel || "gemini-2.0-flash-exp",
      prompt,
      systemPrompt,
      schema,
    });
  }
  if (providerId === "codex") {
    return generateCodexJson<T>(prompt, settings, systemPrompt);
  }
  return generateDeepSeekJson<T>(prompt, settings, systemPrompt);
}
