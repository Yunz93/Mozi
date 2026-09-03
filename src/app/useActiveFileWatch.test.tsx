// @vitest-environment happy-dom

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/appStore";
import type { FileNode } from "../types";
import type { FileWatchEvent } from "../types/filesystem";
import { useActiveFileWatch } from "./useActiveFileWatch";
import * as editorSelectionBridge from "../utils/editorSelectionBridge";

const note: FileNode = {
  id: "/vault/note.md",
  name: "note.md",
  path: "/vault/note.md",
  type: "file",
};

afterEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    files: [],
    currentFilePath: null,
    openTabs: [],
    activeTabId: null,
    fileContents: {},
    lastSavedContent: {},
  });
});

describe("useActiveFileWatch", () => {
  it("flushes editor pending changes before checking store unsaved state", async () => {
    let flushCalled = false;
    const order: string[] = [];

    vi.spyOn(
      editorSelectionBridge,
      "flushActiveEditorPendingChanges",
    ).mockImplementation(() => {
      flushCalled = true;
      order.push("flush");
    });

    vi.spyOn(useAppStore.getState(), "hasUnsavedChanges").mockImplementation(
      () => {
        order.push("hasUnsavedChanges");
        return !flushCalled;
      },
    );

    const watched = {
      callback: null as ((event: FileWatchEvent | null) => void) | null,
    };
    const readFile = vi.fn(async () => "# Changed outside\n");
    const showNotification = vi.fn();
    const closeTab = vi.fn();
    const refreshFileTree = vi.fn(async () => {});
    const watchFile = vi.fn(
      async (
        _path: string,
        callback: (event: FileWatchEvent | null) => void,
      ) => {
        watched.callback = callback;
        return vi.fn();
      },
    );

    useAppStore.setState({
      files: [note],
      currentFilePath: note.path,
      openTabs: [note.id],
      activeTabId: note.id,
      fileContents: { [note.id]: "# Original\n" },
      lastSavedContent: { [note.id]: "# Original\n" },
    });

    function Harness() {
      useActiveFileWatch({
        activeTabId: note.id,
        currentFilePath: note.path,
        openTabs: [note.id],
        files: [note],
        readFile,
        setCurrentFilePath: useAppStore.getState().setCurrentFilePath,
        showNotification,
        closeTab,
        refreshFileTree,
        watchFile,
        t: (key) => key,
      });

      return null;
    }

    render(React.createElement(Harness));

    await waitFor(() => {
      expect(watched.callback).not.toBeNull();
    });

    const emitWatchedEvent = watched.callback as (
      event: FileWatchEvent | null,
    ) => void;
    emitWatchedEvent({ path: note.path, type: "modified" });

    await waitFor(() => {
      // Flush must happen before the first hasUnsavedChanges check.
      expect(order.indexOf("flush")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("hasUnsavedChanges")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("flush")).toBeLessThan(
        order.indexOf("hasUnsavedChanges"),
      );
    });

    // Should not treat it as a "canceled reload due to unsaved edits".
    expect(showNotification).not.toHaveBeenCalledWith(
      "notifications_fileChangedOnDisk",
      "error",
    );
    // Flush+reload path still succeeds.
    expect(showNotification).toHaveBeenCalledWith(
      "notifications_fileReloaded",
      "success",
    );
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("reloads external disk changes without marking them as local unsaved edits", async () => {
    const watched = {
      callback: null as ((event: FileWatchEvent | null) => void) | null,
    };
    const readFile = vi.fn(async () => "# Changed outside\n");
    const showNotification = vi.fn();
    const closeTab = vi.fn();
    const refreshFileTree = vi.fn(async () => {});
    const watchFile = vi.fn(
      async (
        _path: string,
        callback: (event: FileWatchEvent | null) => void,
      ) => {
        watched.callback = callback;
        return vi.fn();
      },
    );

    useAppStore.setState({
      files: [note],
      currentFilePath: note.path,
      openTabs: [note.id],
      activeTabId: note.id,
      fileContents: { [note.id]: "# Original\n" },
      lastSavedContent: { [note.id]: "# Original\n" },
    });

    function Harness() {
      useActiveFileWatch({
        activeTabId: note.id,
        currentFilePath: note.path,
        openTabs: [note.id],
        files: [note],
        readFile,
        setCurrentFilePath: useAppStore.getState().setCurrentFilePath,
        showNotification,
        closeTab,
        refreshFileTree,
        watchFile,
        t: (key) => key,
      });

      return null;
    }

    render(React.createElement(Harness));

    await waitFor(() => {
      expect(watched.callback).not.toBeNull();
    });

    const emitWatchedEvent = watched.callback as (
      event: FileWatchEvent | null,
    ) => void;
    emitWatchedEvent({ path: note.path, type: "modified" });

    await waitFor(() => {
      expect(useAppStore.getState().fileContents[note.id]).toBe(
        "# Changed outside\n",
      );
      expect(useAppStore.getState().lastSavedContent[note.id]).toBe(
        "# Changed outside\n",
      );
      expect(useAppStore.getState().hasUnsavedChanges(note.id)).toBe(false);
    });
  });

  it("does not leave a watcher active after unmounting during async setup", async () => {
    let resolveWatch: (unwatch: () => void) => void = () => {};
    const unwatch = vi.fn();
    const watchFile = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          resolveWatch = resolve;
        }),
    );

    function Harness() {
      useActiveFileWatch({
        activeTabId: note.id,
        currentFilePath: note.path,
        openTabs: [note.id],
        files: [note],
        readFile: vi.fn(),
        setCurrentFilePath: useAppStore.getState().setCurrentFilePath,
        showNotification: vi.fn(),
        closeTab: vi.fn(),
        refreshFileTree: vi.fn(async () => {}),
        watchFile,
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

  it("closes the active tab when the file is deleted on disk", async () => {
    const watched = {
      callback: null as ((event: FileWatchEvent | null) => void) | null,
    };
    const closeTab = vi.fn();
    const refreshFileTree = vi.fn(async () => {});
    const watchFile = vi.fn(
      async (
        _path: string,
        callback: (event: FileWatchEvent | null) => void,
      ) => {
        watched.callback = callback;
        return vi.fn();
      },
    );

    useAppStore.setState({
      files: [note],
      currentFilePath: note.path,
      openTabs: [note.id],
      activeTabId: note.id,
    });

    function Harness() {
      useActiveFileWatch({
        activeTabId: note.id,
        currentFilePath: note.path,
        openTabs: [note.id],
        files: [note],
        readFile: vi.fn(),
        setCurrentFilePath: useAppStore.getState().setCurrentFilePath,
        showNotification: vi.fn(),
        closeTab,
        refreshFileTree,
        watchFile,
        t: (key) => key,
      });

      return null;
    }

    render(React.createElement(Harness));

    await waitFor(() => {
      expect(watched.callback).not.toBeNull();
    });

    const emitWatchedEvent = watched.callback as (
      event: FileWatchEvent | null,
    ) => void;
    emitWatchedEvent({ path: note.path, type: "deleted" });

    await waitFor(() => {
      expect(closeTab).toHaveBeenCalledWith(note.id);
      expect(refreshFileTree).toHaveBeenCalled();
    });
  });
});
