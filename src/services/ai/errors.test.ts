import { describe, expect, it } from "vitest";
import { AiServiceError, formatAiServiceError } from "./errors";
import { fetchAvailableModels } from "../modelCatalogService";
import type { AppSettings } from "../../types";

describe("AiServiceError", () => {
  it("抛出的错误带有正确 code 与 provider", () => {
    const error = new AiServiceError("MISSING_API_KEY", { provider: "openai" });
    expect(error.code).toBe("MISSING_API_KEY");
    expect(error.provider).toBe("openai");
    expect(error.name).toBe("AiServiceError");
  });
});

describe("formatAiServiceError", () => {
  it("在 en / zh-CN 下产生对应文案", () => {
    const missing = new AiServiceError("MISSING_API_KEY", {
      provider: "openai",
    });
    expect(formatAiServiceError("zh-CN", missing)).toBe(
      "请先配置 OpenAI API Key。",
    );
    expect(formatAiServiceError("en", missing)).toBe(
      "Please configure a OpenAI API key first.",
    );

    const listFailed = new AiServiceError("MODEL_LIST_FAILED", {
      provider: "gemini",
      status: 403,
    });
    expect(formatAiServiceError("zh-CN", listFailed)).toBe(
      "加载 Gemini 模型列表失败（403）。",
    );
    expect(formatAiServiceError("en", listFailed)).toBe(
      "Failed to load Gemini models (403).",
    );
  });
});

describe("fetchAvailableModels", () => {
  it("缺少 API Key 时抛出 MISSING_API_KEY", async () => {
    await expect(
      fetchAvailableModels("deepseek", {
        deepseekApiKey: "",
      } as AppSettings),
    ).rejects.toMatchObject({
      name: "AiServiceError",
      code: "MISSING_API_KEY",
      provider: "deepseek",
    });
  });
});
