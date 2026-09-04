import { describe, expect, it } from "vitest";
import {
  resolveBuiltinEmbeddingDownloadAction,
  shouldPromptBuiltinEmbeddingDownload,
} from "./builtinEmbeddingConsent";

describe("shouldPromptBuiltinEmbeddingDownload", () => {
  const cases: Array<{
    consent: "unknown" | "granted" | "denied";
    privacyMode: boolean;
    modelCached: boolean;
    prompt: boolean;
    action: "prompt" | "allow" | "skip";
  }> = [
    {
      consent: "unknown",
      privacyMode: false,
      modelCached: false,
      prompt: true,
      action: "prompt",
    },
    {
      consent: "unknown",
      privacyMode: false,
      modelCached: true,
      prompt: false,
      action: "allow",
    },
    {
      consent: "unknown",
      privacyMode: true,
      modelCached: false,
      prompt: false,
      action: "skip",
    },
    {
      consent: "unknown",
      privacyMode: true,
      modelCached: true,
      prompt: false,
      action: "allow",
    },
    {
      consent: "granted",
      privacyMode: false,
      modelCached: false,
      prompt: false,
      action: "allow",
    },
    {
      consent: "granted",
      privacyMode: true,
      modelCached: false,
      prompt: false,
      action: "skip",
    },
    {
      consent: "denied",
      privacyMode: false,
      modelCached: false,
      prompt: false,
      action: "skip",
    },
    {
      consent: "denied",
      privacyMode: false,
      modelCached: true,
      prompt: false,
      action: "allow",
    },
  ];

  it.each(cases)(
    "consent=$consent privacy=$privacyMode cached=$modelCached → $action",
    ({ consent, privacyMode, modelCached, prompt, action }) => {
      const input = { consent, privacyMode, modelCached };
      expect(shouldPromptBuiltinEmbeddingDownload(input)).toBe(prompt);
      expect(resolveBuiltinEmbeddingDownloadAction(input)).toBe(action);
    },
  );
});

describe("granted/denied 分支", () => {
  it("granted 且未缓存时允许下载", () => {
    expect(
      resolveBuiltinEmbeddingDownloadAction({
        consent: "granted",
        privacyMode: false,
        modelCached: false,
      }),
    ).toBe("allow");
  });

  it("denied 且未缓存时跳过下载", () => {
    expect(
      resolveBuiltinEmbeddingDownloadAction({
        consent: "denied",
        privacyMode: false,
        modelCached: false,
      }),
    ).toBe("skip");
  });
});
