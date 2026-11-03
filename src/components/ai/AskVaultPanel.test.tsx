// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskVaultPanel } from "./AskVaultPanel";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { ViewMode } from "../../types";
import {
  __resetPreviewNavigationBridgeForTests,
  registerPreviewPane,
} from "../../utils/previewNavigationBridge";
import type { RetrieveHit } from "../../types/vaultIndex";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  answer: vi.fn(),
  history: vi.fn(),
  editorFocus: vi.fn(),
}));
vi.mock("../../utils/editorSelectionBridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../utils/editorSelectionBridge")
  >()),
  requestEditorRangeFocus: mocks.editorFocus,
}));
vi.mock("../../hooks/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("../../services/secureSettingsService", () => ({
  hydrateSensitiveSettingsIntoStore: async () =>
    useAppStore.getState().settings,
}));
vi.mock("../../services/aiService", () => ({
  ensureAIConfiguration: () => ({ ok: true }),
}));
vi.mock("../../utils/markdown", () => ({
  renderMarkdown: (markdown: string) => markdown,
}));
vi.mock("../../services/vault/askVaultService", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../services/vault/askVaultService")
    >();
  return {
    ...original,
    retrieveAskVaultHits: (...args: unknown[]) => mocks.retrieve(...args),
    answerAskVaultFromHits: (...args: unknown[]) => mocks.answer(...args),
    loadAskVaultHistory: async () => [],
    appendAskVaultHistory: (...args: unknown[]) => mocks.history(...args),
  };
});

function hit(path: string): RetrieveHit {
  return {
    chunk: {
      id: path,
      path,
      relPath: path,
      text: path,
      titlePath: [],
      headingAnchor: null,
      startLine: 1,
      endLine: 1,
      contentHash: "hash",
    },
    score: 1,
    source: "keyword",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function renderPanel(
  overrides: Partial<React.ComponentProps<typeof AskVaultPanel>> = {},
) {
  return render(
    <AskVaultPanel
      open
      onClose={() => {}}
      onOpenFile={() => {}}
      readFile={async () => ""}
      {...overrides}
    />,
  );
}
function chooseScope(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "askVault_scope" }));
  fireEvent.click(screen.getByRole("option", { name }));
}
async function retrieve() {
  fireEvent.click(screen.getByRole("button", { name: "askVault_retrieve" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "askVault_ask" })
        .disabled,
    ).toBe(false),
  );
}

beforeEach(() => {
  mocks.retrieve.mockReset().mockResolvedValue([hit("/vault/a.md")]);
  mocks.answer.mockReset().mockResolvedValue({
    answerMarkdown: "Answer",
    citations: [],
    usedChunkIds: [],
    model: "test",
    retrievedAt: 0,
  });
  mocks.history.mockReset().mockResolvedValue(undefined);
  mocks.editorFocus.mockReset();
  __resetPreviewNavigationBridgeForTests();
  useAppStore.setState({
    settings: {
      ...defaultSettings,
      language: "en",
      aiProvider: "codex",
      codexApiKey: "test-key",
    },
    rootFolderPath: "/vault",
    currentFilePath: "/vault/a.md",
    activeTabId: "/vault/a.md",
    viewMode: ViewMode.LIVE,
    linkIndexProgress: {
      phase: "idle",
      done: 0,
      total: 0,
      currentPath: null,
      error: null,
      builtAt: null,
    },
    chunkIndex: {
      version: 1,
      vaultRoot: "/vault",
      builtAt: 0,
      byPath: { "/vault/a.md": [hit("/vault/a.md").chunk] },
    },
  });
});
afterEach(() => {
  cleanup();
  __resetPreviewNavigationBridgeForTests();
  vi.unstubAllGlobals();
});

describe("AskVaultPanel 来源定位视图", () => {
  it("丢弃切库后延迟完成的来源打开请求", async () => {
    const opening = deferred<void>();
    const target = hit("/vault/source.md");
    mocks.retrieve.mockResolvedValueOnce([target]);
    const onOpenFile = vi.fn((file) => {
      useAppStore.setState({
        activeTabId: file.id,
        currentFilePath: file.path,
        fileContents: { [file.id]: "source" },
      });
      return opening.promise;
    });
    renderPanel({ onOpenFile });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    await retrieve();
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".ask-vault-source-item")!,
    );
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledOnce());
    await act(async () => {
      useAppStore.setState({ rootFolderPath: "/other-vault" });
      opening.resolve();
    });
    expect(mocks.editorFocus).not.toHaveBeenCalled();
  });

  it("读盘期间有新缓冲时用最新内容计算来源选区", async () => {
    const reading = deferred<string>();
    const target = hit("/vault/source.md");
    target.chunk.startLine = 3;
    target.chunk.endLine = 3;
    mocks.retrieve.mockResolvedValueOnce([target]);
    const readFile = vi.fn(() => reading.promise);
    renderPanel({
      readFile,
      onOpenFile: async (file) => {
        useAppStore.setState({
          activeTabId: file.id,
          currentFilePath: file.path,
          fileContents: {},
        });
      },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    await retrieve();
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".ask-vault-source-item")!,
    );
    await waitFor(() => expect(readFile).toHaveBeenCalledOnce());
    const latest = "# Updated longer\n\nlatest text\n";
    await act(async () => {
      useAppStore.setState({ fileContents: { [target.chunk.path]: latest } });
      reading.resolve("old\n\nstale\n");
    });
    expect(mocks.editorFocus).toHaveBeenCalledWith(
      target.chunk.path,
      latest.indexOf("latest text"),
      latest.length,
      { alignTopRatio: 0.25 },
    );
  });

  it("读盘后若已选择另一篇文档，不发送迟到的定位", async () => {
    const reading = deferred<string>();
    const target = hit("/vault/source.md");
    mocks.retrieve.mockResolvedValueOnce([target]);
    const readFile = vi.fn(() => reading.promise);
    renderPanel({
      readFile,
      onOpenFile: async (file) => {
        useAppStore.setState({
          activeTabId: file.id,
          currentFilePath: file.path,
          fileContents: {},
        });
      },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    await retrieve();
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".ask-vault-source-item")!,
    );
    await waitFor(() => expect(readFile).toHaveBeenCalledOnce());
    await act(async () => {
      useAppStore.setState({
        activeTabId: "/vault/other.md",
        currentFilePath: "/vault/other.md",
      });
      reading.resolve("source\n");
    });
    expect(mocks.editorFocus).not.toHaveBeenCalled();
  });

  it.each([ViewMode.PREVIEW, ViewMode.LIVE])(
    "在%s只定位可见面板并读取新打开的正文",
    async (mode) => {
      const target = hit("/vault/source.md");
      target.chunk.headingAnchor = "conclusion";
      target.chunk.startLine = 3;
      target.chunk.endLine = 3;
      target.chunk.text = "Conclusion snippet";
      mocks.retrieve.mockResolvedValueOnce([target]);
      useAppStore.setState({ viewMode: mode, fileContents: {} });
      const content = "# Intro\n\n## Conclusion\nLatest source text";
      const container = document.createElement("div");
      container.innerHTML =
        '<article class="markdown-body"><h2 id="conclusion">Conclusion</h2></article>';
      document.body.appendChild(container);
      Object.defineProperties(container, {
        clientHeight: { value: 400 },
        scrollHeight: { value: 3000 },
      });
      const heading = container.querySelector("h2")!;
      heading.getBoundingClientRect = () =>
        ({ top: 1600, height: 40 }) as DOMRect;
      container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      const scrollTo = vi.fn();
      container.scrollTo = scrollTo;
      registerPreviewPane(target.chunk.path, container);
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          callback(0);
          return 1;
        },
      );
      const readFile = vi.fn(async () => "stale disk contents");
      renderPanel({
        readFile,
        onOpenFile: async (file) => {
          useAppStore.setState({
            activeTabId: file.id,
            currentFilePath: file.path,
            fileContents: { [file.id]: content },
          });
        },
      });
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "question" },
      });
      await retrieve();
      fireEvent.click(
        document.querySelector<HTMLButtonElement>(".ask-vault-source-item")!,
      );
      await waitFor(() => {
        if (mode === ViewMode.PREVIEW) expect(scrollTo).toHaveBeenCalled();
        else expect(mocks.editorFocus).toHaveBeenCalled();
      });
      expect(readFile).not.toHaveBeenCalled();
      if (mode === ViewMode.PREVIEW) {
        expect(mocks.editorFocus).not.toHaveBeenCalled();
        expect(scrollTo).toHaveBeenCalledWith({ top: 1528, behavior: "auto" });
      } else {
        expect(scrollTo).not.toHaveBeenCalled();
        expect(mocks.editorFocus).toHaveBeenCalledWith(
          target.chunk.path,
          9,
          23,
          { alignTopRatio: 0.25 },
        );
      }
      container.remove();
    },
  );

  it("无标题的阅读来源只打开文档，不聚焦隐藏编辑器", async () => {
    mocks.retrieve.mockResolvedValueOnce([hit("/vault/plain.md")]);
    useAppStore.setState({ viewMode: ViewMode.PREVIEW });
    const onOpenFile = vi.fn(async (file) => {
      useAppStore.setState({
        activeTabId: file.id,
        currentFilePath: file.path,
        fileContents: { [file.id]: "Plain source" },
      });
    });
    renderPanel({ onOpenFile });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    await retrieve();
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".ask-vault-source-item")!,
    );
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledOnce());
    expect(mocks.editorFocus).not.toHaveBeenCalled();
  });
});

describe("AskVaultPanel 检索身份", () => {
  it("问题和范围不变时复用已预览片段", async () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    await retrieve();
    fireEvent.click(screen.getByRole("button", { name: "askVault_ask" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(1));
    expect(mocks.retrieve).toHaveBeenCalledTimes(1);
  });

  it.each(["scope", "file", "vault"])("%s 改变后重新检索", async (change) => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    if (change === "file") chooseScope("askVault_scopeCurrent");
    await retrieve();
    const newHits = [hit("/new/result.md")];
    mocks.retrieve.mockResolvedValueOnce(newHits);
    if (change === "scope") chooseScope("askVault_scopeCurrent");
    else
      act(() =>
        useAppStore.setState(
          change === "file"
            ? { currentFilePath: "/vault/b.md" }
            : { rootFolderPath: "/other" },
        ),
      );
    fireEvent.click(screen.getByRole("button", { name: "askVault_ask" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(1));
    expect(mocks.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.answer.mock.calls[0][1]).toEqual(newHits);
  });

  it("丢弃旧范围延迟返回的检索片段", async () => {
    const oldRequest = deferred<RetrieveHit[]>();
    mocks.retrieve.mockReturnValueOnce(oldRequest.promise);
    renderPanel();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "askVault_retrieve" }));
    await waitFor(() => expect(mocks.retrieve).toHaveBeenCalledTimes(1));
    chooseScope("askVault_scopeCurrent");
    await act(async () => {
      oldRequest.resolve([hit("/vault/outside.md")]);
    });
    const newHits = [hit("/vault/a.md")];
    mocks.retrieve.mockResolvedValueOnce(newHits);
    fireEvent.click(screen.getByRole("button", { name: "askVault_ask" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(1));
    expect(mocks.answer.mock.calls[0][1]).toEqual(newHits);
  });

  it("切换知识库后丢弃旧回答，不写入新面板历史", async () => {
    const oldAnswer = deferred<unknown>();
    mocks.answer.mockReturnValueOnce(oldAnswer.promise);
    renderPanel();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "askVault_ask" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(1));
    act(() => useAppStore.setState({ rootFolderPath: "/other" }));
    await act(async () => {
      oldAnswer.resolve({
        answerMarkdown: "Old vault answer",
        citations: [],
        usedChunkIds: [],
        model: "test",
        retrievedAt: 0,
      });
    });
    expect(screen.queryByText("Old vault answer")).toBeNull();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("新范围请求仍在进行时，旧请求完成不能解除忙碌状态", async () => {
    const oldRequest = deferred<RetrieveHit[]>();
    const newRequest = deferred<RetrieveHit[]>();
    mocks.retrieve
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    renderPanel();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "askVault_retrieve" }));
    await waitFor(() => expect(mocks.retrieve).toHaveBeenCalledTimes(1));
    chooseScope("askVault_scopeCurrent");
    fireEvent.click(screen.getByRole("button", { name: "askVault_retrieve" }));
    await waitFor(() => expect(mocks.retrieve).toHaveBeenCalledTimes(2));
    await act(async () => {
      oldRequest.resolve([hit("/vault/outside.md")]);
    });
    expect(
      screen
        .getAllByRole<HTMLButtonElement>("button", {
          name: "askVault_retrieving",
        })
        .every((button) => button.disabled),
    ).toBe(true);
    await act(async () => {
      newRequest.resolve([hit("/vault/a.md")]);
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "askVault_ask" })
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "askVault_ask" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(1));
    expect(mocks.answer.mock.calls[0][1]).toEqual([hit("/vault/a.md")]);
  });

  it("追问成功后仍将新回答追加到可见历史", async () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "first" },
    });
    fireEvent.click(screen.getByRole("button", { name: "askVault_ask" }));
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "also more" },
    });
    fireEvent.click(screen.getByRole("button", { name: "askVault_ask" }));
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
    expect(mocks.answer.mock.calls[1][3]).toBe("first");
    expect(
      screen.getByRole("tab", { name: /askVault_history/ }).textContent,
    ).toContain("2");
  });
});
