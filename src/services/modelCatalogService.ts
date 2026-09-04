import type { AIProvider, AppSettings } from "../types";
import { fetchWithTimeout } from "./ai/http";
import { AiServiceError } from "./ai/errors";

export interface ModelOption {
  id: string;
  label: string;
}

interface OpenAIModelListResponse {
  data?: Array<{
    id?: string;
    owned_by?: string;
  }>;
}

interface GeminiModelListResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
}

function dedupeAndSortModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return models
    .filter((model) => {
      const key = model.id.trim();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function looksLikeUsefulOpenAIModel(modelId: string): boolean {
  return /^(gpt-|o[1-9]\b|o[1-9]-|codex\b|computer-use\b)/i.test(modelId);
}

function looksLikeUsefulDeepSeekModel(modelId: string): boolean {
  return /^deepseek(?:-|$)/i.test(modelId);
}

function stripGeminiModelPrefix(name: string): string {
  return name.replace(/^models\//i, "").trim();
}

async function fetchOpenAIModels(
  settings: AppSettings,
): Promise<ModelOption[]> {
  const apiKey = settings.codexApiKey?.trim();
  if (!apiKey) {
    throw new AiServiceError("MISSING_API_KEY", { provider: "openai" });
  }

  const baseUrl = (
    settings.codexApiBaseUrl?.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const response = await fetchWithTimeout(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const payload = (await response.json()) as OpenAIModelListResponse & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new AiServiceError("MODEL_LIST_FAILED", {
      provider: "openai",
      status: response.status,
      message: payload.error?.message,
    });
  }

  return dedupeAndSortModels(
    (payload.data || [])
      .map((model) => model.id?.trim() || "")
      .filter(looksLikeUsefulOpenAIModel)
      .map((id) => ({ id, label: id })),
  );
}

async function fetchGeminiModels(
  settings: AppSettings,
): Promise<ModelOption[]> {
  const apiKey = settings.geminiApiKey?.trim();
  if (!apiKey) {
    throw new AiServiceError("MISSING_API_KEY", { provider: "gemini" });
  }

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );
  const payload = (await response.json()) as GeminiModelListResponse & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new AiServiceError("MODEL_LIST_FAILED", {
      provider: "gemini",
      status: response.status,
      message: payload.error?.message,
    });
  }

  return dedupeAndSortModels(
    (payload.models || [])
      .filter((model) =>
        model.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((model) => {
        const id = stripGeminiModelPrefix(model.name || "");
        return {
          id,
          label: model.displayName?.trim()
            ? `${id} (${model.displayName.trim()})`
            : id,
        };
      }),
  );
}

async function fetchDeepSeekModels(
  settings: AppSettings,
): Promise<ModelOption[]> {
  const apiKey = settings.deepseekApiKey?.trim();
  if (!apiKey) {
    throw new AiServiceError("MISSING_API_KEY", { provider: "deepseek" });
  }

  const baseUrl = (
    settings.deepseekApiBaseUrl?.trim() || "https://api.deepseek.com"
  ).replace(/\/+$/, "");
  const response = await fetchWithTimeout(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const payload = (await response.json()) as OpenAIModelListResponse & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new AiServiceError("MODEL_LIST_FAILED", {
      provider: "deepseek",
      status: response.status,
      message: payload.error?.message,
    });
  }

  return dedupeAndSortModels(
    (payload.data || [])
      .map((model) => model.id?.trim() || "")
      .filter(looksLikeUsefulDeepSeekModel)
      .map((id) => ({ id, label: id })),
  );
}

export async function fetchAvailableModels(
  provider: AIProvider,
  settings: AppSettings,
): Promise<ModelOption[]> {
  if (provider === "codex") {
    return fetchOpenAIModels(settings);
  }

  if (provider === "deepseek") {
    return fetchDeepSeekModels(settings);
  }

  return fetchGeminiModels(settings);
}
