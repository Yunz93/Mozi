import type { GoogleGenAI } from "@google/genai";
import type { AIAnalysisResult, AIWikiGenerationResult } from "../types";
import { resolveAISystemPrompt } from "./aiPrompts";
import { buildAnalyzeMarkdownPrompt } from "./ai/prompts";
import { AiServiceError } from "./ai/errors";

let genaiModulePromise: Promise<typeof import("@google/genai")> | null = null;

function loadGenAIModule(): Promise<typeof import("@google/genai")> {
  if (!genaiModulePromise) {
    genaiModulePromise = import("@google/genai");
  }
  return genaiModulePromise;
}

// Singleton instance - API key is not stored in a Map to avoid memory caching issues
let aiInstance: GoogleGenAI | null = null;
let currentApiKey: string | null = null;

/**
 * Clear the cached AI instance and API key from memory
 * Call this when logging out or when API key changes
 */
export function clearAIInstance(): void {
  aiInstance = null;
  currentApiKey = null;
}

const getAIInstance = async (apiKey: string): Promise<GoogleGenAI> => {
  const { GoogleGenAI } = await loadGenAIModule();
  // Clear old instance if API key changed
  if (currentApiKey !== apiKey) {
    aiInstance = null;
    currentApiKey = null;
  }

  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey });
    currentApiKey = apiKey;
  }
  return aiInstance;
};

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const REQUEST_TIMEOUT = 30000; // 30 seconds

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if the error is retryable (network errors, rate limits)
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message =
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : "";
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("502")
  );
}

export const analyzeContent = async (
  content: string,
  apiKey: string,
  modelName: string = "gemini-2.0-flash-exp",
  systemPrompt?: string,
): Promise<AIAnalysisResult> => {
  if (!apiKey) {
    throw new AiServiceError("MISSING_API_KEY", { provider: "gemini" });
  }

  const { Type } = await loadGenAIModule();

  return generateGeminiJson<AIAnalysisResult>({
    apiKey,
    modelName,
    prompt: buildAnalyzeMarkdownPrompt(content),
    systemPrompt,
    schema: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        suggestedTags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        seoTitle: { type: Type.STRING },
        optimizedMarkdown: { type: Type.STRING },
      },
      required: ["summary", "suggestedTags", "seoTitle", "optimizedMarkdown"],
    },
  });
};

interface GeminiJsonRequest {
  apiKey: string;
  modelName?: string;
  prompt: string;
  systemPrompt?: string;
  schema: Record<string, unknown>;
}

export async function generateGeminiJson<T>({
  apiKey,
  modelName = "gemini-2.0-flash-exp",
  prompt,
  systemPrompt,
  schema,
}: GeminiJsonRequest): Promise<T> {
  if (!apiKey) {
    throw new AiServiceError("MISSING_API_KEY", { provider: "gemini" });
  }

  const ai = await getAIInstance(apiKey);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), REQUEST_TIMEOUT);
      });

      const responsePromise = ai.models.generateContent({
        model: modelName || "gemini-2.0-flash-exp",
        contents: prompt,
        config: {
          systemInstruction: resolveAISystemPrompt(systemPrompt),
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      const text = response.text;

      if (!text) throw new Error("No response from AI");

      return JSON.parse(text) as T;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Gemini analysis attempt ${attempt + 1} failed:`, error);

      // Check if we should retry
      if (attempt < MAX_RETRIES - 1 && isRetryableError(error)) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt); // Exponential backoff
        console.log(`Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  // Clear instance on failure
  clearAIInstance();
  throw (
    lastError || new Error("Failed to analyze content after multiple attempts")
  );
}

export async function buildAskVaultGeminiSchema(): Promise<
  Record<string, unknown>
> {
  const { Type } = await loadGenAIModule();
  return {
    type: Type.OBJECT,
    properties: {
      answerMarkdown: { type: Type.STRING },
      citationIndexes: {
        type: Type.ARRAY,
        items: { type: Type.NUMBER },
      },
    },
    required: ["answerMarkdown", "citationIndexes"],
  };
}

export async function generateGeminiWikiArticle(
  prompt: string,
  apiKey: string,
  modelName: string = "gemini-2.0-flash-exp",
  systemPrompt?: string,
): Promise<AIWikiGenerationResult> {
  const { Type } = await loadGenAIModule();
  return generateGeminiJson<AIWikiGenerationResult>({
    apiKey,
    modelName,
    prompt,
    systemPrompt,
    schema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        summary: { type: Type.STRING },
        category: { type: Type.STRING },
        suggestedTags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        markdown: { type: Type.STRING },
        references: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              url: { type: Type.STRING },
              note: { type: Type.STRING },
            },
            required: ["title"],
          },
        },
        citations: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: [
        "title",
        "summary",
        "category",
        "suggestedTags",
        "markdown",
        "references",
        "citations",
      ],
    },
  });
}
