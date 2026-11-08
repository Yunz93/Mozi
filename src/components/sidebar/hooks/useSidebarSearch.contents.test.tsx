// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileNode } from "../../../types";
import { defaultSettings, useAppStore } from "../../../store/appStore";
import { createEmptyChunkIndex } from "../../../services/vault/chunkIndexService";
import { chunkMarkdownFile } from "../../../services/vault/chunkService";
import { useSidebarSearch } from "./useSidebarSearch";

const node = (name: string): FileNode => ({
  id: `/vault/${name}.md`,
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  type: "file",
});
beforeEach(() =>
  useAppStore.setState({
    rootFolderPath: "/vault",
    settings: {
      ...defaultSettings,
      embeddingProvider: "none",
      searchModeDefault: "keyword",
    },
    chunkIndex: null,
  }),
);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("merges literal short notes and unsaved text with hybrid retrieval hits", async () => {
  const files = [node("long"), node("short"), node("unsaved")];
  const texts = new Map([
    [
      files[0].path,
      "# Long\n\nA sufficiently long paragraph with needle and enough context to create a semantic chunk for retrieval.",
    ],
    [files[1].path, "# Short\n\nneedle"],
    [files[2].path, "# Original"],
  ]);
  const index = createEmptyChunkIndex("/vault");
  for (const file of files)
    index.byPath[file.path] = chunkMarkdownFile({
      path: file.path,
      vaultRoot: "/vault",
      content: texts.get(file.path)!,
    });
  expect(index.byPath[files[1].path]).toEqual([]);
  useAppStore.setState({
    chunkIndex: index,
    settings: {
      ...useAppStore.getState().settings,
      searchModeDefault: "hybrid",
    },
  });
  const readFile = vi.fn(async (file: FileNode) => texts.get(file.path)!);
  const options = {
    files,
    fileContents: { [files[2].id]: "# Unsaved needle" },
    readFile,
  };
  const hook = renderHook(() =>
    useSidebarSearch(options, { onFileSelect: vi.fn(), onClose: vi.fn() }),
  );
  act(() => hook.result.current.setSearchQuery("needle"));
  await waitFor(() =>
    expect(hook.result.current.searchResults).toHaveLength(3),
  );
  expect(
    hook.result.current.searchResults.map((result) => result.file.id),
  ).toEqual(files.map((file) => file.id));
  expect(readFile).not.toHaveBeenCalledWith(files[2]);
  expect(hook.result.current.searchResults[1].snippets[0].text).toBe("needle");
});

it("bounds outstanding reads and stops admitting work after cancellation", async () => {
  vi.useFakeTimers();
  const files = Array.from({ length: 50 }, (_, i) => node(`n${i}`));
  const pending: (() => void)[] = [];
  const readFile = vi.fn(
    () =>
      new Promise<string>((resolve) => pending.push(() => resolve("needle"))),
  );
  const options = { files, fileContents: {}, readFile };
  const hook = renderHook(() =>
    useSidebarSearch(options, { onFileSelect: vi.fn(), onClose: vi.fn() }),
  );
  act(() => hook.result.current.setSearchQuery("needle"));
  await act(async () => {
    vi.advanceTimersByTime(150);
  });
  expect(readFile).toHaveBeenCalledTimes(8);
  hook.unmount();
  await act(async () => pending.forEach((resolve) => resolve()));
  expect(readFile).toHaveBeenCalledTimes(8);
});

it("reuses small texts but does not retain an oversized document", async () => {
  const files = [node("small"), node("large")];
  const readFile = vi.fn(async (file: FileNode) =>
    file === files[0] ? "needle small" : `needle ${"x".repeat(1_000_001)}`,
  );
  const options = { files, fileContents: {}, readFile };
  const hook = renderHook(() =>
    useSidebarSearch(options, { onFileSelect: vi.fn(), onClose: vi.fn() }),
  );
  act(() => hook.result.current.setSearchQuery("needle"));
  await waitFor(() =>
    expect(hook.result.current.searchResults).toHaveLength(2),
  );
  act(() => hook.result.current.setSearchQuery("need"));
  await waitFor(() =>
    expect(
      readFile.mock.calls.filter(([file]) => file === files[1]),
    ).toHaveLength(2),
  );
  expect(
    readFile.mock.calls.filter(([file]) => file === files[0]),
  ).toHaveLength(1);
});

it("invalidates cached disk text after an index update and isolates read failures", async () => {
  const files = [node("working"), node("unreadable")];
  let content = "needle";
  const readFile = vi.fn(async (file: FileNode) => {
    if (file === files[1]) throw new Error("locked");
    return content;
  });
  const options = { files, fileContents: {}, readFile };
  const hook = renderHook(() =>
    useSidebarSearch(options, { onFileSelect: vi.fn(), onClose: vi.fn() }),
  );
  act(() => hook.result.current.setSearchQuery("needle"));
  await waitFor(() =>
    expect(hook.result.current.searchResults).toHaveLength(1),
  );
  content = "external edit";
  act(() =>
    useAppStore.setState({ chunkIndex: createEmptyChunkIndex("/vault") }),
  );
  await waitFor(() =>
    expect(hook.result.current.searchResults).toHaveLength(0),
  );
  expect(
    readFile.mock.calls.filter(([file]) => file === files[0]),
  ).toHaveLength(2);
});
