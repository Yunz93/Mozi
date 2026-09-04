import type { AIProvider, AppLanguage } from "../../types";
import { t, type TranslationKey } from "../../utils/i18n";

export type AiServiceErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_MODEL"
  | "MODEL_LIST_FAILED"
  | "REQUEST_TIMEOUT"
  | "INVALID_JSON"
  | "EMPTY_RESPONSE"
  | "HTTP_FAILED";

export type AiServiceProvider = AIProvider | "openai";

export class AiServiceError extends Error {
  readonly code: AiServiceErrorCode;
  readonly provider?: AiServiceProvider;
  readonly status?: number;

  constructor(
    code: AiServiceErrorCode,
    options?: {
      provider?: AiServiceProvider;
      status?: number;
      message?: string;
    },
  ) {
    super(options?.message || code);
    this.name = "AiServiceError";
    this.code = code;
    this.provider = options?.provider;
    this.status = options?.status;
  }
}

export function isAiServiceError(error: unknown): error is AiServiceError {
  return error instanceof AiServiceError;
}

function providerLabel(provider?: AiServiceProvider): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "deepseek") return "DeepSeek";
  return "OpenAI";
}

const CODE_KEYS: Record<AiServiceErrorCode, TranslationKey> = {
  MISSING_API_KEY: "aiError_missingApiKey",
  INVALID_MODEL: "aiError_invalidModel",
  MODEL_LIST_FAILED: "aiError_modelListFailed",
  REQUEST_TIMEOUT: "aiError_requestTimeout",
  INVALID_JSON: "aiError_invalidJson",
  EMPTY_RESPONSE: "aiError_emptyResponse",
  HTTP_FAILED: "aiError_httpFailed",
};

/** 把带 code 的 AI 错误映射为当前语言的用户可见文案。 */
export function formatAiServiceError(
  language: AppLanguage,
  error: unknown,
): string {
  if (error instanceof Error && error.name === "FetchTimeoutError") {
    return t(language, "aiError_requestTimeout");
  }

  if (isAiServiceError(error)) {
    return t(language, CODE_KEYS[error.code], {
      provider: providerLabel(error.provider),
      status: error.status ?? "",
    });
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return t(language, "notifications_aiEnhanceFailed");
}
