import type { AppSettings } from "../types";
import { AiServiceError } from "./ai/errors";
import { parseProviderJson } from "./ai/http";
import { requestCompatibleApi } from "./ai/compatibleHttp";
import { resolveProviderSystemPrompt } from "./ai/prompts";
import {
  resolveCompatibleSettings,
  type CompatibleProvider,
} from "./ai/compatibleProviders";

interface ChatPayload {
  error?: { message?: string };
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
}

export async function generateCompatibleJson<T>(
  provider: CompatibleProvider,
  prompt: string,
  settings: AppSettings,
  systemPrompt?: string,
): Promise<T> {
  const config = resolveCompatibleSettings(provider, settings);
  if (!config.apiKey) throw new AiServiceError("MISSING_API_KEY", { provider });
  const response = await requestCompatibleApi(
    provider,
    config.baseUrl,
    config.apiKey,
    "chatCompletions",
    {
      model: config.model,
      messages: [
        {
          role: "system",
          content: systemPrompt ?? resolveProviderSystemPrompt(settings),
        },
        { role: "user", content: `${prompt}\n\nReturn JSON only.` },
      ],
      response_format: { type: "json_object" },
      stream: false,
    },
  );
  const payload = response.payload as ChatPayload | null;
  if (!response.ok)
    throw new AiServiceError("HTTP_FAILED", {
      provider,
      status: response.status,
    });
  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AiServiceError("EMPTY_RESPONSE", { provider });
  try {
    return parseProviderJson<T>(text, config.label);
  } catch {
    throw new AiServiceError("INVALID_JSON", { provider });
  }
}
