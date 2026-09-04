/** @vitest-environment happy-dom */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import type { FileNode } from "../types";

const { readFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
}));

vi.mock("./useFileSystem", () => ({
  useFileSystem: () => ({
    readFile: readFileMock,
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renameFile: vi.fn(),
    deleteFile: vi.fn(),
    moveToTrash: vi.fn(),
    restoreFromTrash: vi.fn(),
    moveFile: vi.fn(),
    refreshFileTree: vi.fn(),
    revealInExplorer: vi.fn(),
  }),
}));

import { useFileOperations } from "./useFileOperations";

const previousNote: FileNode = {
  id: "/vault/prev.md",
  name: "prev.md",
  path: "/vault/prev.md",
  type: "file",
};

const targetNote: FileNode = {
  id: "/vault/target.md",
  name: "target.md",
  path: "/vault/target.md",
  type: "file",
};

function Harness({
  onReady,
}: {
  onReady: (ops: ReturnType<typeof useFileOperations>) => void;
}) {
  const ops = useFileOperations();
  onReady(ops);
  return null;
}

describe("useFileOperations", () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      files: [],
      openTabs: [],
      activeTabId: null,
      currentFilePath: null,
      fileContents: {},
      lastSavedContent: {},
      settings: defaultSettings,
    });
  });

  beforeEach(() => {
    readFileMock.mockReset();
    useAppStore.setState({
      files: [previousNote, targetNote],
      openTabs: [previousNote.id],
      activeTabId: previousNote.id,
      currentFilePath: previousNote.path,
      fileContents: { [previousNote.id]: "# prev" },
      lastSavedContent: { [previousNote.id]: "# prev" },
      settings: defaultSettings,
    });
  });

  it("closes the new tab when readFile rejects", async () => {
    readFileMock.mockRejectedValue(new Error("read failed"));
    const closeTab = vi.spyOn(useAppStore.getState(), "closeTab");
    let ops: ReturnType<typeof useFileOperations> | null = null;

    render(<Harness onReady={(value) => (ops = value)} />);

    await act(async () => {
      await ops!.handleFileSelect(targetNote);
    });

    await waitFor(() => {
      expect(closeTab).toHaveBeenCalledWith(targetNote.id);
    });
    expect(useAppStore.getState().activeTabId).toBe(previousNote.id);
  });
});
