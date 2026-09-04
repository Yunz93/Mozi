import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchTimeoutError, fetchWithTimeout } from "./http";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts and throws FetchTimeoutError when the request exceeds timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    const pending = fetchWithTimeout("https://example.com", {}, 1000);
    const assertion = expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("returns the response when fetch finishes in time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const response = await fetchWithTimeout("https://example.com", {}, 1000);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
