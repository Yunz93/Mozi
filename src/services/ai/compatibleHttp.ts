import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../types/filesystem";
import { AiServiceError } from "./errors";
import { fetchWithTimeout, FetchTimeoutError } from "./http";
import type { CompatibleProvider } from "./compatibleProviders";

export async function requestCompatibleApi(
  provider: CompatibleProvider,
  baseUrl: string,
  apiKey: string,
  operation: "chatCompletions" | "models",
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  if (isTauriEnvironment()) {
    try {
      const response = await invoke<{ status: number; payload: unknown }>(
        "ai_provider_request",
        { baseUrl, apiKey, operation, body: body ?? null },
      );
      return {
        ...response,
        ok: response.status >= 200 && response.status < 300,
      };
    } catch (error) {
      if (String(error).includes("AI_REQUEST_TIMEOUT"))
        throw new FetchTimeoutError();
      throw new AiServiceError("NETWORK_FAILED", { provider });
    }
  }
  const response = await fetchWithTimeout(
    `${baseUrl}/${operation === "models" ? "models" : "chat/completions"}`,
    {
      method: operation === "models" ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    operation === "models" ? 60000 : 180000,
  );
  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json().catch(() => null),
  };
}
