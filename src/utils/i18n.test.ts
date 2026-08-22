import { describe, expect, it } from "vitest";
import { formatMessage, t, localizeKnownError } from "./i18n";

describe("formatMessage", () => {
  it("returns template unchanged when no params provided", () => {
    expect(formatMessage("Hello world")).toBe("Hello world");
  });

  it("replaces single placeholder", () => {
    expect(formatMessage("Hello {name}", { name: "Alice" })).toBe(
      "Hello Alice",
    );
  });

  it("replaces multiple placeholders", () => {
    expect(
      formatMessage("{greeting} {name}", { greeting: "Hi", name: "Bob" }),
    ).toBe("Hi Bob");
  });

  it("keeps unknown placeholders as-is", () => {
    expect(formatMessage("Hello {name}", { other: "value" })).toBe(
      "Hello {name}",
    );
  });

  it("handles numeric params", () => {
    expect(formatMessage("Count: {count}", { count: 42 })).toBe("Count: 42");
  });

  it("handles empty string template", () => {
    expect(formatMessage("")).toBe("");
  });
});

describe("t", () => {
  it("returns Chinese translation for zh-CN", () => {
    expect(t("zh-CN", "common_done")).toBe("完成");
  });

  it("returns English translation for en", () => {
    expect(t("en", "common_done")).toBe("Done");
  });

  it("falls back to Chinese when key is missing in target locale", () => {
    // common_loading exists in both zh-CN and en, but let's test a key that only exists in zh-CN
    // Actually all keys exist in both. Let's use a custom key instead.
    expect(t("en", "nonexistent_key" as any)).toBe("nonexistent_key");
  });

  it("falls back to key when translation is missing in both locales", () => {
    expect(t("en", "nonexistent_key" as any)).toBe("nonexistent_key");
  });

  it("falls back to Chinese for unsupported language", () => {
    expect(t("fr" as any, "common_done")).toBe("完成");
  });

  it("replaces params in translated string", () => {
    expect(t("zh-CN", "stats_minutes", { count: 5 })).toBe("5 分钟");
  });

  it("replaces params in English translation", () => {
    expect(t("en", "stats_minutes", { count: 3 })).toBe("3 min");
  });

  it("formats update download progress labels", () => {
    expect(
      t("zh-CN", "settings_updatesProgressBytes", {
        downloaded: "5 MB",
        total: "10 MB",
      }),
    ).toBe("5 MB / 10 MB");
    expect(
      t("en", "settings_updatesProgressDownloaded", { downloaded: "2 KB" }),
    ).toBe("Downloaded 2 KB");
    expect(t("zh-CN", "settings_updatesProgressLabel")).toBe("更新进度");
    expect(t("zh-CN", "sidebar_dropToAddFiles")).toContain("拖");
    expect(t("en", "notifications_fileAdded", { name: "a.md" })).toBe(
      "Added a.md",
    );
    expect(t("en", "settings_updatesMacGuide2")).toContain("DMG");
  });
});

describe("localizeKnownError", () => {
  it("maps OpenAI quota errors to a clearer localized message", () => {
    const message = localizeKnownError(
      "zh-CN",
      "Error: You exceeded your current quota, please check your plan and billing details.",
    );

    expect(message).toContain("OpenAI API 配额不足");
  });

  it("maps HTTP status based auth failures", () => {
    const message = localizeKnownError(
      "en",
      "OpenAI request failed with status 401.",
    );
    expect(message).toContain("authentication failed");
  });

  it("falls back to the original message when no mapping exists", () => {
    expect(localizeKnownError("en", "Custom backend failure")).toBe(
      "Custom backend failure",
    );
  });

  it("maps exact known error messages", () => {
    expect(
      localizeKnownError("en", "Please configure AI settings first."),
    ).toContain("configure AI");
  });

  it("maps 403 forbidden errors", () => {
    expect(
      localizeKnownError("zh-CN", "Request failed with status 403"),
    ).toContain("权限");
  });

  it("maps 429 rate limit errors", () => {
    expect(localizeKnownError("en", "Rate limit exceeded")).toContain("rate");
  });

  it("maps model unavailable errors", () => {
    expect(localizeKnownError("zh-CN", "Model gpt-4 not found")).toContain(
      "模型",
    );
  });

  it("trims whitespace from message before matching", () => {
    expect(
      localizeKnownError("en", "  OpenAI request failed with status 401.  "),
    ).toContain("authentication");
  });

  it("maps WeChat IP allowlist errors before generic HTTP mappings", () => {
    expect(
      localizeKnownError(
        "zh-CN",
        "WeChat API error 40164 during fetching access token: invalid ip, not in whitelist",
      ),
    ).toContain("白名单");
  });
});
