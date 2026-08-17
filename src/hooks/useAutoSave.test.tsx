// @vitest-environment happy-dom

import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, defaultSettings } from "../store/appStore";
import { useAutoSave } from "./useAutoSave";

const { writeFile } = vi.hoisted(() => ({
  writeFile: vi.fn(async () => {}),
}));

vi.mock("../types/filesystem", () => ({
  getFileSystem: vi.fn(async () => ({ writeFile })),
}));

const NOTE_ID = "/vault/note.md";

function setupStore(autoSaveInterval: number) {
  useAppStore.setState({
    files: [],
    openTabs: [NOTE_ID],
    activeTabId: NOTE_ID,
    currentFilePath: NOTE_ID,
    fileContents: { [NOTE_ID]: "original" },
    lastSavedContent: { [NOTE_ID]: "original" },
    settings: {
      ...defaultSettings,
      autoSaveInterval,
      fillMissingFrontmatterOnSave: false,
    },
  });
}

function Harness({ debounceMs }: { debounceMs?: number }) {
  useAutoSave({ debounceMs, enabled: true });
  return null;
}

function setupDocumentWithUpdateTime() {
  const doc = [
    "---",
    "date modified: 2020-01-01 00:00:00",
    "---",
    "",
    "Body",
  ].join("\n");

  useAppStore.setState({
    files: [],
    openTabs: [NOTE_ID],
    activeTabId: NOTE_ID,
    currentFilePath: NOTE_ID,
    fileContents: { [NOTE_ID]: doc },
    lastSavedContent: { [NOTE_ID]: doc },
    isSaving: false,
    settings: {
      ...defaultSettings,
      autoSaveInterval: 60_000,
      fillMissingFrontmatterOnSave: false,
    },
  });

  return doc;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  writeFile.mockClear();
  writeFile.mockImplementation(async () => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  useAppStore.setState({
    files: [],
    currentFilePath: null,
    openTabs: [],
    activeTabId: null,
    fileContents: {},
    lastSavedContent: {},
    isSaving: false,
    settings: defaultSettings,
  });
});

describe("useAutoSave", () => {
  it("auto-saves using the configured autoSaveInterval when no debounce override is provided", async () => {
    setupStore(5000);

    render(<Harness />);

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, "edited");
    });

    // A short delay (the previously hardcoded 500ms) must NOT trigger a save
    // when the user has configured a longer interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(writeFile).not.toHaveBeenCalled();

    // Once the configured interval elapses, the save runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(writeFile).toHaveBeenCalledWith(NOTE_ID, "edited");
  });

  it("honors an explicit debounceMs override", async () => {
    setupStore(60000);

    render(<Harness debounceMs={300} />);

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, "edited");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(writeFile).toHaveBeenCalledWith(NOTE_ID, "edited");
  });

  it("manual save with update-time refresh does not loop or stay in saving state", async () => {
    vi.setSystemTime(new Date("2026-05-11T12:34:56.000Z"));

    setupDocumentWithUpdateTime();
    let saveHook: ReturnType<typeof useAutoSave>;

    function SaveHarness() {
      saveHook = useAutoSave({ debounceMs: 60_000, enabled: true });
      return null;
    }

    render(<SaveHarness />);

    writeFile.mockClear();

    await act(async () => {
      await saveHook!.forceSave(undefined, { trigger: "manual" });
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().isSaving).toBe(false);

    const savedContent = (
      writeFile.mock.calls[0] as unknown as [string, string]
    )[1];
    expect(savedContent).toMatch(
      /date modified: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/,
    );
    expect(useAppStore.getState().fileContents[NOTE_ID]).toBe(savedContent);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().isSaving).toBe(false);
  });

  it("skips frontmatter update-time refresh when refreshFrontmatterOnSave is off", async () => {
    vi.setSystemTime(new Date("2026-05-11T12:34:56.000Z"));

    const doc = setupDocumentWithUpdateTime();
    const edited = `${doc}\n\nEdited`;
    useAppStore.setState((state) => ({
      fileContents: { ...state.fileContents, [NOTE_ID]: edited },
      settings: { ...state.settings, refreshFrontmatterOnSave: false },
    }));

    let saveHook: ReturnType<typeof useAutoSave>;

    function SaveHarness() {
      saveHook = useAutoSave({ debounceMs: 60_000, enabled: true });
      return null;
    }

    render(<SaveHarness />);

    writeFile.mockClear();

    await act(async () => {
      await saveHook!.forceSave(undefined, { trigger: "manual" });
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(NOTE_ID, edited);
    expect(edited).toContain("date modified: 2020-01-01 00:00:00");
    expect(useAppStore.getState().fileContents[NOTE_ID]).toBe(edited);
    expect(useAppStore.getState().isSaving).toBe(false);
  });

  it("fills missing frontmatter fields from the metadata template on manual save", async () => {
    const doc = ["---", "status: published", "---", "", "Body"].join("\n");
    const base = useAppStore.getState();
    useAppStore.setState({
      files: [],
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      currentFilePath: NOTE_ID,
      fileContents: { [NOTE_ID]: doc },
      lastSavedContent: { [NOTE_ID]: doc },
      isSaving: false,
      settings: {
        ...base.settings,
        autoSaveInterval: 60_000,
        fillMissingFrontmatterOnSave: true,
        refreshFrontmatterOnSave: false,
        metadataFields: [
          { key: "status", defaultValue: "draft", description: "" },
          { key: "slug", defaultValue: "from-template", description: "" },
        ],
      },
    });

    let saveHook: ReturnType<typeof useAutoSave>;

    function SaveHarness() {
      saveHook = useAutoSave({ debounceMs: 60_000, enabled: true });
      return null;
    }

    render(<SaveHarness />);
    writeFile.mockClear();

    await act(async () => {
      await saveHook!.forceSave(undefined, { trigger: "manual" });
    });

    const savedContent = (
      writeFile.mock.calls[0] as unknown as [string, string]
    )[1];
    expect(savedContent).toContain("status: published");
    expect(savedContent).toContain("slug: from-template");
    expect(useAppStore.getState().fileContents[NOTE_ID]).toBe(savedContent);
  });

  it("skips filling missing frontmatter fields when fillMissingFrontmatterOnSave is off", async () => {
    const doc = ["---", "status: published", "---", "", "Body"].join("\n");
    const base = useAppStore.getState();
    useAppStore.setState({
      files: [],
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      currentFilePath: NOTE_ID,
      fileContents: { [NOTE_ID]: `${doc}\n\nEdited` },
      lastSavedContent: { [NOTE_ID]: doc },
      isSaving: false,
      settings: {
        ...base.settings,
        autoSaveInterval: 60_000,
        fillMissingFrontmatterOnSave: false,
        refreshFrontmatterOnSave: false,
        metadataFields: [
          { key: "slug", defaultValue: "from-template", description: "" },
        ],
      },
    });

    let saveHook: ReturnType<typeof useAutoSave>;

    function SaveHarness() {
      saveHook = useAutoSave({ debounceMs: 60_000, enabled: true });
      return null;
    }

    render(<SaveHarness />);
    writeFile.mockClear();

    await act(async () => {
      await saveHook!.forceSave(undefined, { trigger: "manual" });
    });

    expect(writeFile).toHaveBeenCalledWith(NOTE_ID, `${doc}\n\nEdited`);
    const savedWithoutSlug = (
      writeFile.mock.calls[0] as unknown as [string, string]
    )[1];
    expect(savedWithoutSlug).not.toContain("slug:");
  });

  it("does not fill missing frontmatter fields during auto-save", async () => {
    const doc = ["---", "status: published", "---", "", "Body"].join("\n");
    const base = useAppStore.getState();
    useAppStore.setState({
      files: [],
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      currentFilePath: NOTE_ID,
      fileContents: { [NOTE_ID]: doc },
      lastSavedContent: { [NOTE_ID]: doc },
      isSaving: false,
      settings: {
        ...base.settings,
        autoSaveInterval: 300,
        fillMissingFrontmatterOnSave: true,
        refreshFrontmatterOnSave: true,
        metadataFields: [
          { key: "slug", defaultValue: "from-template", description: "" },
        ],
      },
    });

    render(<Harness debounceMs={300} />);

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, `${doc}\n\nEdited`);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(writeFile).toHaveBeenCalledWith(NOTE_ID, `${doc}\n\nEdited`);
    const savedWithoutSlug = (
      writeFile.mock.calls[0] as unknown as [string, string]
    )[1];
    expect(savedWithoutSlug).not.toContain("slug:");
  });

  it("queues a single auto follow-up save when the user edits during manual save", async () => {
    setupStore(60_000);
    let saveHook: ReturnType<typeof useAutoSave>;

    function SaveHarness() {
      saveHook = useAutoSave({ debounceMs: 60_000, enabled: true });
      return null;
    }

    render(<SaveHarness />);

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, "pending save");
    });

    let resolveWrite: (() => void) | undefined;
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    await act(async () => {
      const pending = saveHook!.forceSave(undefined, { trigger: "manual" });
      await Promise.resolve();
      act(() => {
        useAppStore.getState().updateTabContent(NOTE_ID, "edited during save");
      });
      resolveWrite?.();
      await pending;
    });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenNthCalledWith(1, NOTE_ID, "pending save");
    expect(writeFile).toHaveBeenNthCalledWith(2, NOTE_ID, "edited during save");
    expect(useAppStore.getState().isSaving).toBe(false);
  });

  it("replaces the open document buffer when opening another file", async () => {
    const NOTE_B = "/vault/other.md";
    const base = useAppStore.getState();

    useAppStore.setState({
      files: [
        {
          id: NOTE_ID,
          name: "note.md",
          path: NOTE_ID,
          type: "file",
        },
        {
          id: NOTE_B,
          name: "other.md",
          path: NOTE_B,
          type: "file",
        },
      ],
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      currentFilePath: NOTE_ID,
      fileContents: {
        [NOTE_ID]: "edited locally",
      },
      lastSavedContent: {
        [NOTE_ID]: "original",
      },
      settings: { ...base.settings, autoSaveInterval: 60_000 },
    });

    render(<Harness debounceMs={60_000} />);

    await act(async () => {
      expect(useAppStore.getState().hasUnsavedChanges(NOTE_ID)).toBe(true);
      // Open paths flush before replace; addTab itself keeps only the new buffer.
      useAppStore.getState().addTab(NOTE_B, "other");
      useAppStore.getState().markAsSaved(NOTE_B, "other");
      await Promise.resolve();
    });

    expect(useAppStore.getState().activeTabId).toBe(NOTE_B);
    expect(useAppStore.getState().openTabs).toEqual([NOTE_B]);
    expect(useAppStore.getState().fileContents[NOTE_ID]).toBeUndefined();
  });

  it("ignores content updates for a document that is not open", async () => {
    const NOTE_B = "/vault/other.md";
    const base = useAppStore.getState();

    useAppStore.setState({
      files: [
        {
          id: NOTE_ID,
          name: "note.md",
          path: NOTE_ID,
          type: "file",
        },
        {
          id: NOTE_B,
          name: "other.md",
          path: NOTE_B,
          type: "file",
        },
      ],
      openTabs: [NOTE_B],
      activeTabId: NOTE_B,
      currentFilePath: NOTE_B,
      fileContents: {
        [NOTE_B]: "other",
      },
      lastSavedContent: {
        [NOTE_B]: "other",
      },
      settings: { ...base.settings, autoSaveInterval: 1000 },
    });

    render(<Harness debounceMs={1000} />);

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, "edited while closed");
    });

    writeFile.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileContents[NOTE_ID]).toBeUndefined();
  });

  it("keeps the open document stable when an in-flight save completes after replace", async () => {
    const NOTE_B = "/vault/other.md";
    const base = useAppStore.getState();

    useAppStore.setState({
      files: [
        {
          id: NOTE_ID,
          name: "note.md",
          path: NOTE_ID,
          type: "file",
        },
        {
          id: NOTE_B,
          name: "other.md",
          path: NOTE_B,
          type: "file",
        },
      ],
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      currentFilePath: NOTE_ID,
      fileContents: {
        [NOTE_ID]: "tab-a",
      },
      lastSavedContent: {
        [NOTE_ID]: "tab-a",
      },
      settings: { ...base.settings, autoSaveInterval: 60_000 },
    });

    let saveHook: ReturnType<typeof useAutoSave>;
    function SaveHarness() {
      saveHook = useAutoSave({ debounceMs: 60_000, enabled: true });
      return null;
    }

    render(<SaveHarness />);

    let resolveWrite: (() => void) | undefined;
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, "tab-a-edited");
    });

    const pendingSave = act(async () => {
      const promise = saveHook!.forceSave(undefined, { trigger: "manual" });
      await Promise.resolve();
      act(() => {
        useAppStore.getState().addTab(NOTE_B, "tab-b");
        useAppStore.getState().markAsSaved(NOTE_B, "tab-b");
        useAppStore.getState().setCurrentFilePath(NOTE_B);
      });
      resolveWrite?.();
      await promise;
    });

    await pendingSave;

    expect(useAppStore.getState().activeTabId).toBe(NOTE_B);
    expect(useAppStore.getState().fileContents[NOTE_B]).toBe("tab-b");
    expect(useAppStore.getState().lastSavedContent[NOTE_B]).toBe("tab-b");
    // Previous buffer is replaced; in-flight save should not resurrect it.
    expect(useAppStore.getState().fileContents[NOTE_ID]).toBeUndefined();
  });

  it("drains a queued manual save after an in-flight save completes", async () => {
    setupStore(60_000);
    let saveHook: ReturnType<typeof useAutoSave>;

    function SaveHarness() {
      saveHook = useAutoSave({ debounceMs: 60_000, enabled: true });
      return null;
    }

    render(<SaveHarness />);

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, "first");
    });

    let resolveFirst: (() => void) | undefined;
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const firstSave = saveHook!.forceSave(undefined, { trigger: "manual" });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      useAppStore.getState().updateTabContent(NOTE_ID, "second");
    });

    const secondSave = saveHook!.forceSave(undefined, { trigger: "manual" });

    await act(async () => {
      resolveFirst?.();
      await firstSave;
      await secondSave;
    });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenNthCalledWith(1, NOTE_ID, "first");
    expect(writeFile).toHaveBeenNthCalledWith(2, NOTE_ID, "second");
  });

  it("skips auto-save while tab content is still loading", async () => {
    const base = useAppStore.getState();
    useAppStore.setState({
      files: [],
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      currentFilePath: NOTE_ID,
      fileContents: {},
      lastSavedContent: {},
      settings: { ...base.settings, autoSaveInterval: 300 },
    });

    render(<Harness debounceMs={300} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(writeFile).not.toHaveBeenCalled();
  });
});
