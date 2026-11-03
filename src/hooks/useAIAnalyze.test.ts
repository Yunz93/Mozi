/** @vitest-environment happy-dom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/appStore";
import { defaultSettings } from "../store/uiStore";
import { canRequestAiEnhance, useAIAnalyze } from "./useAIAnalyze";

const {
  analyzeMarkdownWithProvider,
  ensureAIConfiguration,
  generateWikiFromSelectionWithProvider,
  hydrateSensitiveSettingsIntoStore,
  createDirectory,
  createFile,
  fileExists,
  readDirectory,
} = vi.hoisted(() => ({
  analyzeMarkdownWithProvider: vi.fn(),
  ensureAIConfiguration: vi.fn(),
  generateWikiFromSelectionWithProvider: vi.fn(),
  hydrateSensitiveSettingsIntoStore: vi.fn(),
  createDirectory: vi.fn(),
  createFile: vi.fn(),
  fileExists: vi.fn(),
  readDirectory: vi.fn(),
}));

vi.mock("../types/filesystem", () => ({
  getFileSystem: async () => ({
    createDirectory,
    createFile,
    fileExists,
    readDirectory,
  }),
}));

vi.mock("../services/aiService", () => ({
  analyzeMarkdownWithProvider,
  ensureAIConfiguration,
  generateWikiFromSelectionWithProvider,
}));

vi.mock("../services/secureSettingsService", () => ({
  hydrateSensitiveSettingsIntoStore,
}));

const NOTE_ID = "/vault/note.md";

function setupNote(content = "hello world") {
  useAppStore.setState({
    openTabs: [NOTE_ID],
    activeTabId: NOTE_ID,
    currentFilePath: NOTE_ID,
    fileContents: { [NOTE_ID]: content },
    rootFolderPath: "/vault",
    files: [{ id: NOTE_ID, path: NOTE_ID, name: "note.md", type: "file" }],
    notification: null,
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

beforeEach(() => {
  hydrateSensitiveSettingsIntoStore
    .mockReset()
    .mockImplementation(async () => useAppStore.getState().settings);
});
afterEach(() => cleanup());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const selection = { text: "world", from: 6, to: 11 };
const wikiPath = "/vault/Wiki/Concepts/Term.md";
const wikiResult = {
  title: "Term",
  summary: "A summary",
  category: "Concepts",
  suggestedTags: ["wiki"],
  markdown: "# Term\n\nGenerated explanation.",
  references: [],
  citations: [],
};

function changeWikiContext(kind: string) {
  if (kind === "tab") {
    useAppStore.setState({
      activeTabId: "/vault/other.md",
      currentFilePath: "/vault/other.md",
    });
  } else {
    useAppStore.setState({
      rootFolderPath: "/other",
      activeTabId: "/other/note.md",
      currentFilePath: "/other/note.md",
      files: [
        {
          id: "/other/note.md",
          path: "/other/note.md",
          name: "note.md",
          type: "file",
        },
      ],
      fileContents: { "/other/note.md": "Other vault content" },
    });
    if (kind === "away-return") setupNote();
  }
}

describe("Wiki 生成的请求归属", () => {
  beforeEach(() => {
    setupNote();
    useAppStore.getState().updateSettings({ wikiFolder: "Wiki" });
    ensureAIConfiguration.mockReset();
    generateWikiFromSelectionWithProvider
      .mockReset()
      .mockResolvedValue(wikiResult);
    createDirectory.mockReset().mockResolvedValue(undefined);
    createFile.mockReset().mockResolvedValue(wikiPath);
    fileExists.mockReset().mockResolvedValue(false);
    readDirectory.mockReset().mockResolvedValue([
      { id: NOTE_ID, path: NOTE_ID, name: "note.md", type: "file" },
      { id: wikiPath, path: wikiPath, name: "Term.md", type: "file" },
    ]);
  });

  it("正常生成文件、更新当前目录并返回 Wiki 链接", async () => {
    const hook = renderHook(() => useAIAnalyze());
    let replacement: string | null = null;
    await act(async () => {
      replacement =
        await hook.result.current.handleGenerateWikiFromSelection(selection);
    });
    expect(replacement).toBe("[[Wiki/Concepts/Term|world]]");
    expect(createFile).toHaveBeenCalledWith(
      wikiPath,
      expect.stringContaining("Generated explanation."),
    );
    expect(readDirectory).toHaveBeenCalledWith("/vault");
    expect(
      useAppStore.getState().files.some((node) => node.path === wikiPath),
    ).toBe(true);
    expect(useAppStore.getState().notification?.type).toBe("success");
    expect(useAppStore.getState().isAnalyzing).toBe(false);
  });

  it("同名文件存在时生成不同路径", async () => {
    fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const hook = renderHook(() => useAIAnalyze());
    await act(async () => {
      await hook.result.current.handleGenerateWikiFromSelection(selection);
    });
    expect(createFile.mock.calls[0][0]).toBe("/vault/Wiki/Concepts/Term 2.md");
  });

  it.each(["tab", "vault", "away-return"])(
    "模型等待时切换 %s 后不创建或插入文件",
    async (kind) => {
      const pending = deferred<typeof wikiResult>();
      generateWikiFromSelectionWithProvider.mockReturnValueOnce(
        pending.promise,
      );
      const hook = renderHook(() => useAIAnalyze());
      let generating!: Promise<string | null>;
      act(() => {
        generating =
          hook.result.current.handleGenerateWikiFromSelection(selection);
      });
      await waitFor(() =>
        expect(generateWikiFromSelectionWithProvider).toHaveBeenCalledOnce(),
      );
      act(() => changeWikiContext(kind));
      let replacement: string | null = "unexpected";
      await act(async () => {
        pending.resolve(wikiResult);
        replacement = await generating;
      });
      expect(replacement).toBe(null);
      expect(createDirectory).not.toHaveBeenCalled();
      expect(createFile).not.toHaveBeenCalled();
      expect(useAppStore.getState().notification).toBe(null);
      expect(useAppStore.getState().isAnalyzing).toBe(false);
    },
  );

  it.each(["tab", "vault", "away-return"])(
    "密钥加载时切换 %s 后不调用模型",
    async (kind) => {
      const pending = deferred<typeof defaultSettings>();
      hydrateSensitiveSettingsIntoStore.mockReturnValueOnce(pending.promise);
      const hook = renderHook(() => useAIAnalyze());
      let generating!: Promise<string | null>;
      act(() => {
        generating =
          hook.result.current.handleGenerateWikiFromSelection(selection);
      });
      act(() => changeWikiContext(kind));
      await act(async () => {
        pending.resolve(useAppStore.getState().settings);
        expect(await generating).toBe(null);
      });
      expect(generateWikiFromSelectionWithProvider).not.toHaveBeenCalled();
      expect(createFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    "createDirectory",
    "fileExists",
    "createFile",
    "readDirectory",
  ] as const)(
    "%s 等待中切库不会更新新库文件树或显示旧请求成功",
    async (stage) => {
      const pending = deferred<unknown>();
      const operation = {
        createDirectory,
        fileExists,
        createFile,
        readDirectory,
      }[stage];
      operation.mockReturnValueOnce(pending.promise);
      const hook = renderHook(() => useAIAnalyze());
      let generating!: Promise<string | null>;
      act(() => {
        generating =
          hook.result.current.handleGenerateWikiFromSelection(selection);
      });
      await waitFor(() => expect(operation).toHaveBeenCalledOnce());
      act(() => changeWikiContext("vault"));
      const newFiles = useAppStore.getState().files;
      await act(async () => {
        pending.resolve(
          stage === "fileExists"
            ? false
            : stage === "readDirectory"
              ? [
                  {
                    id: wikiPath,
                    path: wikiPath,
                    name: "Term.md",
                    type: "file",
                  },
                ]
              : wikiPath,
        );
        expect(await generating).toBe(null);
      });
      expect(useAppStore.getState().files).toBe(newFiles);
      expect(useAppStore.getState().notification).toBe(null);
      if (stage === "createDirectory" || stage === "fileExists")
        expect(createFile).not.toHaveBeenCalled();
      if (stage === "createFile") expect(readDirectory).not.toHaveBeenCalled();
    },
  );

  it("密钥加载期间已有其他 AI 请求时不占用或清除其忙碌状态", async () => {
    const pending = deferred<typeof defaultSettings>();
    hydrateSensitiveSettingsIntoStore.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useAIAnalyze());
    let generating!: Promise<string | null>;
    act(() => {
      generating =
        hook.result.current.handleGenerateWikiFromSelection(selection);
    });
    act(() => useAppStore.getState().setAnalyzing(true));
    await act(async () => {
      pending.resolve(useAppStore.getState().settings);
      expect(await generating).toBe(null);
    });
    expect(useAppStore.getState().isAnalyzing).toBe(true);
    expect(generateWikiFromSelectionWithProvider).not.toHaveBeenCalled();
  });

  it("写文件失败时保留原目录并解除当前请求的忙碌状态", async () => {
    createFile.mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderHook(() => useAIAnalyze());
    await act(async () => {
      expect(
        await hook.result.current.handleGenerateWikiFromSelection(selection),
      ).toBe(null);
    });
    expect(readDirectory).not.toHaveBeenCalled();
    expect(useAppStore.getState().isAnalyzing).toBe(false);
    expect(useAppStore.getState().notification?.type).toBe("error");
    vi.restoreAllMocks();
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
