/** @vitest-environment happy-dom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/appStore";
import { defaultSettings } from "../store/uiStore";
import { canRequestAiEnhance, useAIAnalyze } from "./useAIAnalyze";

const { analyzeMarkdownWithProvider, ensureAIConfiguration } = vi.hoisted(
  () => ({
    analyzeMarkdownWithProvider: vi.fn(),
    ensureAIConfiguration: vi.fn(),
  }),
);

vi.mock("./useFileSystem", () => ({
  useFileSystem: () => ({
    createFile: vi.fn(),
    refreshFileTree: vi.fn(),
  }),
}));

vi.mock("../services/aiService", () => ({
  analyzeMarkdownWithProvider,
  ensureAIConfiguration,
  generateWikiFromSelectionWithProvider: vi.fn(),
}));

vi.mock("../services/secureSettingsService", () => ({
  hydrateSensitiveSettingsIntoStore: async () =>
    useAppStore.getState().settings,
}));

const NOTE_ID = "/vault/note.md";

function setupNote(content = "hello world") {
  useAppStore.setState({
    openTabs: [NOTE_ID],
    activeTabId: NOTE_ID,
    currentFilePath: NOTE_ID,
    fileContents: { [NOTE_ID]: content },
    isAnalyzing: false,
    settings: {
      ...defaultSettings,
    },
  });
}

describe("canRequestAiEnhance", () => {
  it("allows markdown notes that are idle", () => {
    expect(
      canRequestAiEnhance({
        isAnalyzing: false,
        activeTabId: NOTE_ID,
        currentFilePath: NOTE_ID,
        content: "body",
      }),
    ).toBe(true);
  });

  it("blocks while an enhance is already running", () => {
    expect(
      canRequestAiEnhance({
        isAnalyzing: true,
        activeTabId: NOTE_ID,
        currentFilePath: NOTE_ID,
        content: "body",
      }),
    ).toBe(false);
  });

  it("blocks preview-only files", () => {
    expect(
      canRequestAiEnhance({
        isAnalyzing: false,
        activeTabId: "/vault/doc.pdf",
        currentFilePath: "/vault/doc.pdf",
        content: "binary",
      }),
    ).toBe(false);
  });
});

describe("useAIAnalyze confirm-before-run", () => {
  beforeEach(() => {
    analyzeMarkdownWithProvider.mockReset();
    ensureAIConfiguration.mockReset();
    setupNote();
  });

  afterEach(() => {
    useAppStore.setState({
      openTabs: [],
      activeTabId: null,
      currentFilePath: null,
      fileContents: {},
      isAnalyzing: false,
    });
  });

  it("opens a confirm dialog instead of calling AI immediately", () => {
    const { result } = renderHook(() => useAIAnalyze());
    act(() => {
      result.current.requestAIAnalyze();
    });
    expect(result.current.isAiEnhanceConfirmOpen).toBe(true);
    expect(analyzeMarkdownWithProvider).not.toHaveBeenCalled();
    expect(ensureAIConfiguration).not.toHaveBeenCalled();
  });

  it("does not open confirm when there is no active note", () => {
    useAppStore.setState({
      activeTabId: null,
      currentFilePath: null,
      fileContents: {},
    });
    const { result } = renderHook(() => useAIAnalyze());
    act(() => {
      result.current.requestAIAnalyze();
    });
    expect(result.current.isAiEnhanceConfirmOpen).toBe(false);
  });

  it("runs enhance only after confirm", async () => {
    ensureAIConfiguration.mockImplementation(() => undefined);
    analyzeMarkdownWithProvider.mockResolvedValue({
      seoTitle: "Title",
      summary: "Summary",
      suggestedTags: ["tag"],
      optimizedMarkdown: "enhanced body",
    });

    const { result } = renderHook(() => useAIAnalyze());
    act(() => {
      result.current.requestAIAnalyze();
    });
    expect(result.current.isAiEnhanceConfirmOpen).toBe(true);

    await act(async () => {
      result.current.closeAiEnhanceConfirm();
      await result.current.handleAIAnalyze();
    });

    expect(result.current.isAiEnhanceConfirmOpen).toBe(false);
    expect(ensureAIConfiguration).toHaveBeenCalledTimes(1);
    expect(analyzeMarkdownWithProvider).toHaveBeenCalledTimes(1);
  });
});
