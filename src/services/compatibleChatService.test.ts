import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../store/uiStore";
import {
  analyzeMarkdownWithProvider,
  completeJsonWithProvider,
  ensureAIConfiguration,
  generateWikiFromSelectionWithProvider,
} from "./aiService";
import { fetchAvailableModels } from "./modelCatalogService";
import {
  COMPATIBLE_PROVIDERS,
  type CompatibleProvider,
} from "./ai/compatibleProviders";
import { AiServiceError, formatAiServiceError } from "./ai/errors";
import { resolvePersistedAISettings } from "../store/persistMigrations";
import { stripNonRuntimeSettings } from "../store/appStore";

const providers = ["glm", "kimi", "mimo"] as const;
afterEach(() => vi.unstubAllGlobals());
function settingsFor(provider: CompatibleProvider) {
  return {
    ...defaultSettings,
    aiProvider: provider,
    [`${provider}ApiKey`]: `${provider}-test-secret`,
  };
}
function completion(content = '{"ok":true}') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content,
            reasoning_content: "not JSON and must be ignored",
          },
        },
      ],
    }),
  };
}

describe.each(providers)("%s provider integration", (provider) => {
  it("routes structured requests with independent credentials and the official default endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetchMock);
    const result = await completeJsonWithProvider(
      "fixture",
      settingsFor(provider),
      { systemPrompt: "vault-only" },
    );
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${COMPATIBLE_PROVIDERS[provider].baseUrl}/chat/completions`,
    );
    expect(request.headers.Authorization).toBe(
      `Bearer ${provider}-test-secret`,
    );
    const body = JSON.parse(request.body);
    expect(body.model).toBe(COMPATIBLE_PROVIDERS[provider].model);
    expect(body.messages).toEqual([
      { role: "system", content: "vault-only" },
      { role: "user", content: "fixture\n\nReturn JSON only." },
    ]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
  });
  it("rejects missing own key even when a different provider has a key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const settings = {
      ...defaultSettings,
      aiProvider: provider,
      deepseekApiKey: "other-secret",
      [`${provider}ApiKey`]: " ",
    };
    expect(() => ensureAIConfiguration(settings)).toThrow(AiServiceError);
    await expect(
      completeJsonWithProvider("fixture", settings),
    ).rejects.toMatchObject({ code: "MISSING_API_KEY", provider });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses custom model and endpoint for content enhancement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetchMock);
    await analyzeMarkdownWithProvider("# fixture", {
      ...settingsFor(provider),
      [`${provider}ApiBaseUrl`]: " https://fixture.example/v1/// ",
      [`${provider}Model`]: " custom-model ",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://fixture.example/v1/chat/completions",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      "custom-model",
    );
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content,
    ).toContain("# fixture");
  });
  it("keeps provider selection across rehydration and excludes the secret from persisted settings", () => {
    expect(resolvePersistedAISettings(settingsFor(provider)).aiProvider).toBe(
      provider,
    );
    expect(stripNonRuntimeSettings(settingsFor(provider))).not.toHaveProperty(
      `${provider}ApiKey`,
    );
    expect(stripNonRuntimeSettings(settingsFor(provider))).toHaveProperty(
      "aiProvider",
      provider,
    );
  });
  it("attributes HTTP, empty, and malformed responses to the selected provider", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => {
          throw Error("HTML proxy page");
        },
      })
      .mockResolvedValueOnce(completion(""))
      .mockResolvedValueOnce(completion("invalid JSON"));
    vi.stubGlobal("fetch", fetchMock);
    for (const code of ["HTTP_FAILED", "EMPTY_RESPONSE", "INVALID_JSON"]) {
      try {
        await completeJsonWithProvider("fixture", settingsFor(provider));
        throw Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code, provider });
        expect(formatAiServiceError("zh-CN", error)).toContain(
          COMPATIBLE_PROVIDERS[provider].label,
        );
      }
    }
  });
});

it("loads only usable MiMo text models and deduplicates IDs", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: "mimo-v2.6-flash" },
        { id: "mimo-v2.6-flash" },
        { id: "mimo-v2.5-tts" },
        { id: "mimo-v2.5-asr" },
        { id: "other-provider" },
      ],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchAvailableModels("mimo", settingsFor("mimo"))).toEqual([
    { id: "mimo-v2.6-flash", label: "mimo-v2.6-flash" },
  ]);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://api.xiaomimimo.com/v1/models",
  );
});
it("discovers Kimi models with the Kimi key", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ id: "kimi-k3.1-pro" }, { id: "embedding-test" }],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchAvailableModels("kimi", settingsFor("kimi"))).toEqual([
    { id: "kimi-k3.1-pro", label: "kimi-k3.1-pro" },
  ]);
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.moonshot.cn/v1/models");
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer kimi-test-secret",
  );
});
it("does not invent a GLM model-list endpoint", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchAvailableModels("glm", settingsFor("glm"))).toContainEqual({
    id: "glm-5.3",
    label: "glm-5.3",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(providers)(
  "generates Wiki articles with %s without falling back to Gemini",
  async (provider) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(completion('{"title":"Fixture","content":"Body"}'));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateWikiFromSelectionWithProvider(
      {
        selectedText: "fixture",
        contextBefore: "",
        contextAfter: "",
        documentTitle: "Fixture",
        currentFileName: "fixture.md",
        isFrontmatterSelection: false,
      },
      settingsFor(provider),
    );
    expect(result).toEqual({ title: "Fixture", content: "Body" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${COMPATIBLE_PROVIDERS[provider].baseUrl}/chat/completions`,
    );
  },
);
it.each(providers)(
  "uses safe defaults for malformed persisted %s model settings",
  async (provider) => {
    const fetchMock = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetchMock);
    await completeJsonWithProvider("fixture", {
      ...settingsFor(provider),
      [`${provider}Model`]: 42,
      [`${provider}ApiBaseUrl`]: {},
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${COMPATIBLE_PROVIDERS[provider].baseUrl}/chat/completions`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      COMPATIBLE_PROVIDERS[provider].model,
    );
  },
);
