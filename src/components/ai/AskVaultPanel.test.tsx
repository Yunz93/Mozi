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
import type { RetrieveHit } from "../../types/vaultIndex";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  answer: vi.fn(),
  history: vi.fn(),
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
function renderPanel() {
  return render(
    <AskVaultPanel
      open
      onClose={() => {}}
      onOpenFile={() => {}}
      readFile={async () => ""}
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
  useAppStore.setState({
    settings: {
      ...defaultSettings,
      language: "en",
      aiProvider: "codex",
      codexApiKey: "test-key",
    },
    rootFolderPath: "/vault",
    currentFilePath: "/vault/a.md",
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
