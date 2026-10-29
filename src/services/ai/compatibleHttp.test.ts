import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../types/filesystem", () => ({ isTauriEnvironment: () => true }));
import { requestCompatibleApi } from "./compatibleHttp";
import { formatAiServiceError } from "./errors";
beforeEach(() => {
  mocks.invoke.mockReset();
});
it("uses the desktop network runtime without browser CORS or a duplicate fetch", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mocks.invoke.mockResolvedValue({ status: 200, payload: { choices: [] } });
  expect(
    await requestCompatibleApi(
      "glm",
      "https://open.bigmodel.cn/api/paas/v4",
      "fixture-key",
      "chatCompletions",
      { model: "fixture" },
    ),
  ).toEqual({ ok: true, status: 200, payload: { choices: [] } });
  expect(mocks.invoke).toHaveBeenCalledWith("ai_provider_request", {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "fixture-key",
    operation: "chatCompletions",
    body: { model: "fixture" },
  });
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("preserves authentication failures for provider-specific HTTP handling", async () => {
  mocks.invoke.mockResolvedValue({ status: 401, payload: null });
  expect(
    await requestCompatibleApi(
      "kimi",
      "https://api.moonshot.cn/v1",
      "fixture",
      "models",
    ),
  ).toEqual({ ok: false, status: 401, payload: null });
});
it("localizes desktop network errors without exposing URLs or credentials", async () => {
  mocks.invoke.mockRejectedValue("AI_NETWORK_FAILED");
  try {
    await requestCompatibleApi(
      "mimo",
      "https://fixture.example",
      "fixture",
      "models",
    );
    throw Error("expected failure");
  } catch (error) {
    expect(formatAiServiceError("zh-CN", error)).toContain(
      "Xiaomi MiMo 网络请求失败",
    );
  }
});
it("preserves timeout semantics for existing localized error handling", async () => {
  mocks.invoke.mockRejectedValue("AI_REQUEST_TIMEOUT");
  await expect(
    requestCompatibleApi("glm", "https://fixture.example", "fixture", "models"),
  ).rejects.toMatchObject({ name: "FetchTimeoutError" });
});
