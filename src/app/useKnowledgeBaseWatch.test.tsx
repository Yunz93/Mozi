// @vitest-environment happy-dom

import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/appStore";
import type { FileNode } from "../types";
import type { DirectoryWatchEvent } from "../types/filesystem";
import { useKnowledgeBaseWatch } from "./useKnowledgeBaseWatch";

const note: FileNode = {
  id: "/vault/note.md",
  name: "note.md",
  path: "/vault/note.md",
  type: "file",
};

const otherNote: FileNode = {
  id: "/vault/other.md",
  name: "other.md",
  path: "/vault/other.md",
  type: "file",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAppStore.setState({
    files: [],
    rootFolderPath: null,
    openTabs: [],
    activeTabId: null,
    fileContents: {},
    lastSavedContent: {},
  });
});

describe("useKnowledgeBaseWatch", () => {
  it("yields content indexing to document updates and coalesces bursts without starvation", async () => {
    vi.useFakeTimers();
    let emit!: (event: DirectoryWatchEvent) => void;
    const onFileModified = vi.fn();
    const watchDirectory = vi.fn(
      async (_root: string, callback: typeof emit) => {
        emit = callback;
        return vi.fn();
      },
    );
    const options = {
      rootFolderPath: "/vault",
      watchDirectory,
      onFileModified,
      t: () => "",
      showNotification: vi.fn(),
    };
    renderHook(() => useKnowledgeBaseWatch(options));
    await act(async () => {});
    act(() => emit({ type: "modified", paths: [note.path, note.path] }));
    expect(onFileModified).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60);
      emit({ type: "modified", paths: [otherNote.path, note.path] });
    });
    expect(onFileModified).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20));
    expect(onFileModified.mock.calls).toEqual([[note.path], [otherNote.path]]);
  });

  it("cancels deferred indexing when changing vaults or unmounting", async () => {
    vi.useFakeTimers();
    let emit!: (event: DirectoryWatchEvent) => void;
    const onFileModified = vi.fn();
    const unwatch = vi.fn();
    const options = {
      watchDirectory: vi.fn(async (_root: string, callback: typeof emit) => {
        emit = callback;
        return unwatch;
      }),
      onFileModified,
      t: () => "",
      showNotification: vi.fn(),
    };
    const hook = renderHook(
      ({ root }) => useKnowledgeBaseWatch({ ...options, rootFolderPath: root }),
      { initialProps: { root: "/vault" } },
    );
    await act(async () => {});
    act(() => emit({ type: "modified", paths: [note.path] }));
    hook.rerender({ root: "/other" });
    await act(async () => {});
    act(() => vi.advanceTimersByTime(80));
    expect(onFileModified).not.toHaveBeenCalled();
    act(() => emit({ type: "modified", paths: ["/other/note.md"] }));
    hook.unmount();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(80));
    expect(onFileModified).not.toHaveBeenCalled();
    expect(unwatch).toHaveBeenCalledTimes(2);
  });
  it("syncs the file tree and closes the open file when it is removed on disk", async () => {
    const watched = {
      callback: null as ((event: DirectoryWatchEvent) => void) | null,
    };
    const showNotification = vi.fn();
    const watchDirectory = vi.fn(
      async (
        _dirPath: string,
        callback: (event: DirectoryWatchEvent) => void,
      ) => {
        watched.callback = callback;
        return vi.fn();
      },
    );

    useAppStore.setState({
      files: [note, otherNote],
      rootFolderPath: "/vault",
      openTabs: [note.id],
      activeTabId: note.id,
      fileContents: {
        [note.id]: "# Note\n",
      },
      lastSavedContent: {
        [note.id]: "# Note\n",
      },
    });

    function Harness() {
      useKnowledgeBaseWatch({
        rootFolderPath: "/vault",
        watchDirectory,
        showNotification,
        t: (key) => key,
      });

      return null;
    }

    render(React.createElement(Harness));

    await waitFor(() => {
      expect(watched.callback).not.toBeNull();
    });

    const emitDirectoryEvent = watched.callback as (
      event: DirectoryWatchEvent,
    ) => void;
    emitDirectoryEvent({ type: "changed", tree: [otherNote] });

    await waitFor(() => {
      expect(useAppStore.getState().files).toEqual([otherNote]);
      expect(useAppStore.getState().openTabs).toEqual([]);
      expect(useAppStore.getState().activeTabId).toBeNull();
      expect(showNotification).toHaveBeenCalledWith(
        "notifications_fileDeletedOnDisk",
        "error",
      );
    });
  });

  it("keeps the open file with unsaved changes when removed on disk", async () => {
    const watched = {
      callback: null as ((event: DirectoryWatchEvent) => void) | null,
    };
    const showNotification = vi.fn();
    const watchDirectory = vi.fn(
      async (
        _dirPath: string,
        callback: (event: DirectoryWatchEvent) => void,
      ) => {
        watched.callback = callback;
        return vi.fn();
      },
    );

    useAppStore.setState({
      files: [note, otherNote],
      rootFolderPath: "/vault",
      openTabs: [note.id],
      activeTabId: note.id,
      fileContents: {
        [note.id]: "# Note\nunsaved",
      },
      lastSavedContent: {
        [note.id]: "# Note\n",
      },
    });

    function Harness() {
      useKnowledgeBaseWatch({
        rootFolderPath: "/vault",
        watchDirectory,
        showNotification,
        t: (key) => key,
      });

      return null;
    }

    render(React.createElement(Harness));

    await waitFor(() => {
      expect(watched.callback).not.toBeNull();
    });

    const emitDirectoryEvent = watched.callback as (
      event: DirectoryWatchEvent,
    ) => void;
    emitDirectoryEvent({ type: "changed", tree: [otherNote] });

    await waitFor(() => {
      expect(useAppStore.getState().openTabs).toContain(note.id);
      expect(showNotification).toHaveBeenCalledWith(
        "notifications_fileDeletedOnDiskUnsaved",
        "error",
      );
    });
  });

  it("does not clear the file tree when the watcher reports a root read error", async () => {
    const watched = {
      callback: null as ((event: DirectoryWatchEvent) => void) | null,
    };
    const showNotification = vi.fn();
    const watchDirectory = vi.fn(
      async (
        _dirPath: string,
        callback: (event: DirectoryWatchEvent) => void,
      ) => {
        watched.callback = callback;
        return vi.fn();
      },
    );

    useAppStore.setState({
      files: [note, otherNote],
      rootFolderPath: "/vault",
      openTabs: [note.id],
      activeTabId: note.id,
      fileContents: {
        [note.id]: "# Note\n",
      },
      lastSavedContent: {
        [note.id]: "# Note\n",
      },
    });

    function Harness() {
      useKnowledgeBaseWatch({
        rootFolderPath: "/vault",
        watchDirectory,
        showNotification,
        t: (key) => key,
      });

      return null;
    }

    render(React.createElement(Harness));

    await waitFor(() => {
      expect(watched.callback).not.toBeNull();
    });

    const emitDirectoryEvent = watched.callback as (
      event: DirectoryWatchEvent,
    ) => void;
    emitDirectoryEvent({ type: "error", error: new Error("read failed") });

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith(
        "notifications_watchDirectoryFailed",
        "error",
      );
    });
    expect(useAppStore.getState().files).toEqual([note, otherNote]);
    expect(useAppStore.getState().openTabs).toEqual([note.id]);
    expect(useAppStore.getState().activeTabId).toBe(note.id);
  });

  it("does not leave a watcher active after unmounting during async setup", async () => {
    let resolveWatch: (unwatch: () => void) => void = () => {};
    const unwatch = vi.fn();
    const watchDirectory = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          resolveWatch = resolve;
        }),
    );

    function Harness() {
      useKnowledgeBaseWatch({
        rootFolderPath: "/vault",
        watchDirectory,
        showNotification: vi.fn(),
        t: (key) => key,
      });

      return null;
    }

    const { unmount } = render(React.createElement(Harness));
    unmount();

    resolveWatch(unwatch);

    await waitFor(() => {
      expect(unwatch).toHaveBeenCalled();
    });
  });
});
