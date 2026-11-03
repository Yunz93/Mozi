import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../store/uiStore";
import { completeJsonWithProvider } from "./aiService";

afterEach(() => vi.unstubAllGlobals());

function response(payload: object) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(payload) }] },
      ],
    }),
  };
}

describe("OpenAI 模型参数兼容", () => {
  it.each(["gpt-4.1", "gpt-4o-mini", "gpt-custom-deployment"])(
    "%s 不携带不兼容的推理参数",
    async (model) => {
      const fetchMock = vi.fn(async (_url: string, request: RequestInit) => {
        const body = JSON.parse(String(request.body));
        if ("reasoning" in body) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: { message: "Unsupported parameter: reasoning" },
            }),
          };
        }
        return response({
          answerMarkdown: "Fixture answer",
          citationIndexes: [1],
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        completeJsonWithProvider(
          "fixture",
          {
            ...defaultSettings,
            aiProvider: "codex",
            codexApiKey: "test-only",
            codexModel: model,
          },
          { systemPrompt: "vault-only" },
        ),
      ).resolves.toEqual({
        answerMarkdown: "Fixture answer",
        citationIndexes: [1],
      });
      const request = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(request.model).toBe(model);
      expect(request).not.toHaveProperty("reasoning");
      expect(request.instructions).toBe("vault-only");
      expect(request.store).toBe(false);
      expect(request.text.format).toEqual({ type: "json_object" });
    },
  );

  it.each([undefined, "", " gpt-5.2-codex "])(
    "默认 Codex 继续使用已有推理力度（%s）",
    async (configuredModel) => {
      const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }));
      vi.stubGlobal("fetch", fetchMock);
      await completeJsonWithProvider("fixture", {
        ...defaultSettings,
        aiProvider: "codex",
        codexApiKey: "test-only",
        codexModel: configuredModel,
      });
      const request = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(request.model).toBe("gpt-5.2-codex");
      expect(request.reasoning).toEqual({ effort: "medium" });
    },
  );
});
