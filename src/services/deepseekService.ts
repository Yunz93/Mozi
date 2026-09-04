import type {
  AIAnalysisResult,
  AIWikiGenerationResult,
  AppSettings,
} from "../types";
import {
  buildProviderHttpErrorMessage,
  fetchWithTimeout,
  normalizeBaseUrl,
  parseProviderJson,
} from "./ai/http";
import {
  buildAnalyzeMarkdownPrompt,
  resolveProviderSystemPrompt,
} from "./ai/prompts";

interface DeepSeekChatCompletionPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  } | null;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

function extractMessageContent(payload: DeepSeekChatCompletionPayload): string {
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (text) {
    return text;
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  throw new Error("DeepSeek returned an empty response.");
}

export async function generateDeepSeekJson<T>(
  prompt: string,
  settings: AppSettings,
  systemPrompt?: string,
): Promise<T> {
  const apiKey = settings.deepseekApiKey?.trim();
  if (!apiKey) {
    throw new Error("Please configure DeepSeek API Key in settings.");
  }

  const model = settings.deepseekModel?.trim() || "deepseek-v4-flash";
  const baseUrl = normalizeBaseUrl(
    settings.deepseekApiBaseUrl,
    "https://api.deepseek.com",
  );
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt ?? resolveProviderSystemPrompt(settings),
        },
        {
          role: "user",
          content: `${prompt}\n\nReturn JSON only.`,
        },
      ],
      response_format: {
        type: "json_object",
      },
      stream: false,
    }),
  });

  const payload = (await response.json()) as DeepSeekChatCompletionPayload;
  if (!response.ok) {
    console.error("DeepSeek chat completion request failed:", {
      status: response.status,
      error: payload.error ?? null,
      model,
      baseUrl,
    });
    throw new Error(
      payload.error?.message
        ? `DeepSeek request failed: ${payload.error.message}`
        : buildProviderHttpErrorMessage("DeepSeek", response.status),
    );
  }

  return parseProviderJson<T>(extractMessageContent(payload), "DeepSeek");
}

export async function analyzeContentWithDeepSeek(
  content: string,
  settings: AppSettings,
): Promise<AIAnalysisResult> {
  return generateDeepSeekJson<AIAnalysisResult>(
    buildAnalyzeMarkdownPrompt(content),
    settings,
  );
}

export async function generateDeepSeekWikiArticle(
  prompt: string,
  settings: AppSettings,
): Promise<AIWikiGenerationResult> {
  return generateDeepSeekJson<AIWikiGenerationResult>(prompt, settings);
}
