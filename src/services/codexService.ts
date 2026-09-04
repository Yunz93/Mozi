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
import { AiServiceError } from "./ai/errors";

interface CodexResponseContent {
  type?: string;
  text?: string;
}

interface CodexResponseMessage {
  type?: string;
  content?: CodexResponseContent[];
}

interface CodexResponsePayload {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  } | null;
  output?: CodexResponseMessage[];
}

function extractOutputText(payload: CodexResponsePayload): string {
  const text = payload.output
    ?.flatMap((message) => message.content ?? [])
    .filter(
      (item) => item.type === "output_text" && typeof item.text === "string",
    )
    .map((item) => item.text?.trim() || "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text) {
    return text;
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  throw new Error("Codex returned an empty response.");
}

export async function generateCodexJson<T>(
  prompt: string,
  settings: AppSettings,
  systemPrompt?: string,
): Promise<T> {
  const apiKey = settings.codexApiKey?.trim();
  if (!apiKey) {
    throw new AiServiceError("MISSING_API_KEY", { provider: "openai" });
  }

  const baseUrl = normalizeBaseUrl(
    settings.codexApiBaseUrl,
    "https://api.openai.com/v1",
  );
  const response = await fetchWithTimeout(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.codexModel?.trim() || "gpt-5.2-codex",
      instructions: systemPrompt ?? resolveProviderSystemPrompt(settings),
      input: `${prompt}\n\nReturn JSON only.`,
      reasoning: {
        effort: "medium",
      },
      text: {
        format: {
          type: "json_object",
        },
      },
      store: false,
    }),
  });

  const payload = (await response.json()) as CodexResponsePayload;
  if (!response.ok) {
    console.error("OpenAI responses request failed:", {
      status: response.status,
      error: payload.error ?? null,
      model: settings.codexModel?.trim() || "gpt-5.2-codex",
      baseUrl,
    });
    throw new Error(
      payload.error?.message ||
        buildProviderHttpErrorMessage("OpenAI", response.status),
    );
  }

  return parseProviderJson<T>(extractOutputText(payload), "Codex");
}

export async function analyzeContentWithCodex(
  content: string,
  settings: AppSettings,
): Promise<AIAnalysisResult> {
  return generateCodexJson<AIAnalysisResult>(
    buildAnalyzeMarkdownPrompt(content),
    settings,
  );
}

export async function generateCodexWikiArticle(
  prompt: string,
  settings: AppSettings,
): Promise<AIWikiGenerationResult> {
  return generateCodexJson<AIWikiGenerationResult>(prompt, settings);
}
