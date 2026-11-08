// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateHighlighterCore,
  mockCreateJavaScriptRegexEngine,
  jsLoader,
  tsLoader,
} = vi.hoisted(() => {
  const jsRegistration = { name: "javascript" };
  return {
    mockCreateHighlighterCore: vi.fn(
      async (_options: { langs: unknown[] }) => ({
        codeToHtml: () => '<pre class="shiki"></pre>',
        getLoadedLanguages: () => ["javascript"],
        loadLanguage: vi.fn(async () => {}),
      }),
    ),
    mockCreateJavaScriptRegexEngine: vi.fn(() => ({ engine: true })),
    // `javascript` resolves; `typescript` rejects to simulate a failed chunk load in release.
    jsLoader: vi.fn(async () => ({ default: jsRegistration })),
    tsLoader: vi.fn(async () => {
      throw new Error(
        "Failed to fetch dynamically imported module: typescript chunk",
      );
    }),
  };
});

vi.mock("shiki/core", () => ({
  createHighlighterCore: mockCreateHighlighterCore,
}));

vi.mock("shiki/engine/javascript", () => ({
  createJavaScriptRegexEngine: mockCreateJavaScriptRegexEngine,
}));

vi.mock("shiki/langs", () => ({
  bundledLanguages: {
    javascript: jsLoader,
    typescript: tsLoader,
  },
}));

vi.mock("../utils/shikiTheme", () => ({
  MARKDOWN_PRESS_SHIKI_THEMES: [{ name: "markdown-press-nord-light" }],
}));

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: () => false,
  waitForTauri: async () => false,
}));

import { createShikiHighlighter } from "./useShikiHighlighter";

afterEach(() => {
  vi.clearAllMocks();
});

describe("createShikiHighlighter", () => {
  it("enables the forgiving JS regex engine for WKWebView/JavaScriptCore compatibility", async () => {
    await createShikiHighlighter(["javascript"]);

    expect(mockCreateJavaScriptRegexEngine).toHaveBeenCalledWith({
      forgiving: true,
    });
  });

  it("still creates a highlighter when an individual language chunk fails to load", async () => {
    const highlighter = await createShikiHighlighter([
      "javascript",
      "typescript",
    ]);

    expect(highlighter).not.toBeNull();
    expect(mockCreateHighlighterCore).toHaveBeenCalledTimes(1);

    const passedLangs =
      mockCreateHighlighterCore.mock.calls[0]?.[0].langs ?? [];
    // The successful `javascript` registration is unwrapped from its module `default`,
    // and the rejected `typescript` loader is skipped instead of aborting creation.
    expect(passedLangs).toEqual([{ name: "javascript" }]);
  });
});
