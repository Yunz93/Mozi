// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useAppStore, defaultSettings } from "@/store/appStore";
import { useWeReadImportActions } from "@/hooks/useWeReadImportActions";
import { useAutoSave } from "@/hooks/useAutoSave";
import { buildWereadMarkdown } from "@/utils/weread/wereadMarkdown";
import { registerActiveEditorFlush } from "@/utils/editorSelectionBridge";
import type { WereadImportBookResult } from "@/utils/weread/wereadImport";
const { disk, writeFile, fetchBookmarkList } = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  fetchBookmarkList: vi.fn(),
  writeFile: vi.fn(async (path: string, text: string) => {
    disk.set(path, text);
  }),
}));
vi.mock("@/types/filesystem", () => ({
  isTauriEnvironment: () => true,
  getFileSystem: async () => ({
    readFile: async (path: string) => {
      if (!disk.has(path)) throw new Error("ENOENT");
      return disk.get(path)!;
    },
    writeFile,
    fileExists: async (path: string) => disk.has(path),
    createDirectory: async () => {},
    createFile: async (path: string, text: string) => {
      disk.set(path, text);
      return path;
    },
    readDirectory: async () =>
      [...disk.keys()].map((path) => ({
        id: path,
        path,
        name: path.split("/").pop(),
        type: "file",
      })),
  }),
}));
vi.mock("@/app/hydrateSensitiveSettingsSafely", () => ({
  hydrateSensitiveSettingsSafely: async () => true,
}));
vi.mock("@/utils/weread/wereadApi", () => ({
  fetchAllNotebooksCached: async () => [],
  searchStoreBooks: async () => [],
  fetchBookInfo: async () => ({ bookId: "book-1", title: "Imported Book" }),
  fetchBookmarkList,
  fetchMyReviews: async () => ({ reviews: [] }),
  fetchBestBookmarks: async () => ({ items: [] }),
  downloadWereadCover: async () => null,
}));
const old = "/vault/original.md";
beforeEach(() => {
  disk.clear();
  disk.set(old, "# Original on disk");
  writeFile
    .mockReset()
    .mockImplementation(async (path: string, text: string) => {
      disk.set(path, text);
    });
  fetchBookmarkList.mockReset().mockResolvedValue({
    updated: [{ bookmarkId: "mark-1", markText: "Imported highlight" }],
  });
  useAppStore.setState({
    rootFolderPath: "/vault",
    files: [{ id: old, path: old, name: "original.md", type: "file" }],
    openTabs: [old],
    activeTabId: old,
    currentFilePath: old,
    fileContents: { [old]: "# Unsaved original text" },
    lastSavedContent: { [old]: "# Original on disk" },
    fileHistories: {},
    isSaving: false,
    settings: {
      ...defaultSettings,
      wereadApiKey: "test-only",
      wereadImportFolder: "Reading",
      wereadImportFolderMode: "flat",
      autoSaveInterval: 60000,
      fillMissingFrontmatterOnSave: false,
      refreshFrontmatterOnSave: false,
    },
  });
});
afterEach(() => {
  cleanup();
  registerActiveEditorFlush(null);
});
const request = {
  notebooks: [{ bookId: "book-1", book: { title: "Imported Book" } }],
  conflictMode: "merge" as const,
  saveCover: false,
  includeHotHighlights: false,
};
it("saves the active dirty document before opening the newly imported book", async () => {
  const hooks = renderHook(() => {
    useAutoSave({ enabled: true });
    return useWeReadImportActions();
  });
  let results: WereadImportBookResult[] = [];
  await act(async () => {
    results = await hooks.result.current.importSelected(request);
  });
  expect(results[0].status).toBe("created");
  expect(disk.get(results[0].path!)).toContain("Imported highlight");
  expect(disk.get(old)).toBe("# Unsaved original text");
});
it("loads the imported note contents into the buffer when it automatically opens", async () => {
  useAppStore.setState({ fileContents: { [old]: "# Original on disk" } });
  const hooks = renderHook(() => useWeReadImportActions());
  let results: WereadImportBookResult[] = [];
  await act(async () => {
    results = await hooks.result.current.importSelected(request);
  });
  expect(results[0].status).toBe("created");
  expect(useAppStore.getState().activeTabId).toBe(results[0].path);
  expect(disk.get(results[0].path!)).toContain("Imported highlight");
  expect(useAppStore.getState().getActiveContent()).toBe(
    disk.get(results[0].path!),
  );
});

it("keeps the original buffer and does not import when saving fails", async () => {
  writeFile.mockRejectedValue(new Error("disk full"));
  const hook = renderHook(() => useWeReadImportActions());
  let results: WereadImportBookResult[] = [];
  await act(async () => {
    results = await hook.result.current.importSelected(request);
  });
  expect(results).toEqual([]);
  expect(fetchBookmarkList).not.toHaveBeenCalled();
  expect(useAppStore.getState().activeTabId).toBe(old);
  expect(useAppStore.getState().getActiveContent()).toBe(
    "# Unsaved original text",
  );
});
it("flushes pending editor input before reading import targets", async () => {
  registerActiveEditorFlush(() =>
    useAppStore.getState().setContentForFile(old, "latest debounced input"),
  );
  const hook = renderHook(() => useWeReadImportActions());
  await act(async () => {
    await hook.result.current.importSelected(request);
  });
  expect(disk.get(old)).toBe("latest debounced input");
});
it("merges the active book using edits made while remote data is pending", async () => {
  const path = "/vault/Reading/Imported Book.md";
  const content = buildWereadMarkdown({
    bookId: "book-1",
    book: { bookId: "book-1", title: "Imported Book" },
    bookmarks: { updated: [] },
    reviews: { reviews: [] },
    importedAt: "2026-10-29T00:00:00Z",
  });
  disk.set(path, content);
  useAppStore.setState({
    files: [{ id: path, path, name: "Imported Book.md", type: "file" }],
    openTabs: [path],
    activeTabId: path,
    currentFilePath: path,
    fileContents: { [path]: content + "\ninitial local appendix" },
    lastSavedContent: { [path]: content },
  });
  let finish!: (value: unknown) => void;
  fetchBookmarkList.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook(() => useWeReadImportActions());
  let importing!: Promise<WereadImportBookResult[]>;
  act(() => {
    importing = hook.result.current.importSelected(request);
  });
  await vi.waitFor(() => expect(fetchBookmarkList).toHaveBeenCalled());
  act(() =>
    useAppStore
      .getState()
      .setContentForFile(path, content + "\nlatest local appendix"),
  );
  await act(async () => {
    finish({
      updated: [{ bookmarkId: "new", markText: "New remote highlight" }],
    });
    await importing;
  });
  expect(disk.get(path)).toContain("latest local appendix");
  expect(disk.get(path)).toContain("New remote highlight");
  expect(useAppStore.getState().getActiveContent()).toBe(disk.get(path));
  expect(useAppStore.getState().hasUnsavedChanges(path)).toBe(false);
});
it("does not write or open the old vault after the workspace changes", async () => {
  let finish!: (value: unknown) => void;
  fetchBookmarkList.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook(() => useWeReadImportActions());
  let importing!: Promise<WereadImportBookResult[]>;
  act(() => {
    importing = hook.result.current.importSelected(request);
  });
  await vi.waitFor(() => expect(fetchBookmarkList).toHaveBeenCalled());
  act(() =>
    useAppStore.setState({
      rootFolderPath: "/other",
      openTabs: [],
      activeTabId: null,
      currentFilePath: null,
      fileContents: {},
      lastSavedContent: {},
    }),
  );
  await act(async () => {
    finish({ updated: [{ bookmarkId: "new", markText: "old request" }] });
    await importing;
  });
  expect([...disk.keys()]).toEqual([old]);
  expect(useAppStore.getState().activeTabId).toBeNull();
  expect(useAppStore.getState().rootFolderPath).toBe("/other");
});

it("preserves input typed during physical merge write and a queued autosave", async () => {
  const path = "/vault/Reading/Imported Book.md";
  const base = buildWereadMarkdown({
    bookId: "book-1",
    book: { title: "Imported Book" },
    bookmarks: { updated: [] },
    reviews: { reviews: [] },
    importedAt: "2026-10-29T00:00:00Z",
  });
  const initial = base + "\ninitial local appendix";
  disk.set(path, initial);
  useAppStore.setState({
    files: [{ id: path, path, name: "Imported Book.md", type: "file" }],
    openTabs: [path],
    activeTabId: path,
    currentFilePath: path,
    fileContents: { [path]: initial },
    lastSavedContent: { [path]: initial },
  });
  let finish!: () => void;
  let paused = false;
  writeFile.mockImplementation(async (target: string, text: string) => {
    if (target === path && text.includes("Imported highlight") && !paused) {
      paused = true;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    disk.set(target, text);
  });
  const hook = renderHook(() => {
    useAutoSave({ debounceMs: 1 });
    return useWeReadImportActions();
  });
  let importing!: Promise<WereadImportBookResult[]>;
  act(() => {
    importing = hook.result.current.importSelected(request);
  });
  await vi.waitFor(() => expect(paused).toBe(true));
  act(() =>
    useAppStore
      .getState()
      .setContentForFile(path, base + "\nlatest appendix during write"),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => {
    finish();
    await importing;
  });
  await vi.waitFor(() => expect(useAppStore.getState().isSaving).toBe(false));
  expect(disk.get(path)).toContain("latest appendix during write");
  expect(disk.get(path)).toContain("Imported highlight");
  expect(useAppStore.getState().getActiveContent()).toBe(disk.get(path));
  expect(useAppStore.getState().hasUnsavedChanges(path)).toBe(false);
});
