/** @vitest-environment happy-dom */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import type { FileNode } from "../types";
import { registerActiveEditorFlush } from "../utils/editorSelectionBridge";

const { readFileMock, isNonUtf8PathMock, writeFileMock, renameFileMock } =
  vi.hoisted(() => ({
    readFileMock: vi.fn(),
    isNonUtf8PathMock: vi.fn((_path?: string) => false),
    writeFileMock: vi.fn(async (_path: string, _content: string) => {}),
    renameFileMock: vi.fn(async () => undefined),
  }));

vi.mock("./useFileSystem", () => ({
  useFileSystem: () => ({
    readFile: readFileMock,
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renameFile: renameFileMock,
    deleteFile: vi.fn(),
    moveToTrash: vi.fn(),
    restoreFromTrash: vi.fn(),
    moveFile: vi.fn(),
    refreshFileTree: vi.fn(),
    revealInExplorer: vi.fn(),
  }),
}));

vi.mock("../types/filesystem", () => ({
  getFileSystem: vi.fn(async () => ({
    isNonUtf8Path: (path: string) => isNonUtf8PathMock(path),
    writeFile: writeFileMock,
    readFile: vi.fn(),
  })),
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
    registerActiveEditorFlush(null);
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
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    renameFileMock.mockClear();
    readFileMock.mockReset();
    isNonUtf8PathMock.mockReset();
    isNonUtf8PathMock.mockReturnValue(false);
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

  it("flushes buffered drawing changes before renaming its path", async () => {
    const drawing = {
      ...previousNote,
      id: "/vault/drawing.excalidraw",
      path: "/vault/drawing.excalidraw",
      name: "drawing.excalidraw",
    };
    useAppStore.setState({
      files: [drawing],
      openTabs: [drawing.id],
      activeTabId: drawing.id,
      currentFilePath: drawing.path,
      fileContents: { [drawing.id]: "original scene" },
      lastSavedContent: { [drawing.id]: "original scene" },
    });
    registerActiveEditorFlush(() =>
      useAppStore.getState().setContentForFile(drawing.id, "latest scene"),
    );
    let ops: ReturnType<typeof useFileOperations> | null = null;
    render(<Harness onReady={(value) => (ops = value)} />);

    await act(async () => {
      await ops!.handleRename(drawing, "renamed");
    });

    expect(writeFileMock).toHaveBeenCalledWith(drawing.path, "latest scene");
    expect(renameFileMock).toHaveBeenCalledWith(drawing, "renamed.excalidraw");
    expect(writeFileMock.mock.invocationCallOrder[0]).toBeLessThan(
      renameFileMock.mock.invocationCallOrder[0],
    );
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

  it("notifies once when opening a non-UTF-8 file", async () => {
    readFileMock.mockResolvedValue("展示用乱码");
    isNonUtf8PathMock.mockReturnValue(true);
    const showNotification = vi.fn();
    useAppStore.setState({ showNotification });
    let ops: ReturnType<typeof useFileOperations> | null = null;

    render(<Harness onReady={(value) => (ops = value)} />);

    await act(async () => {
      await ops!.handleFileSelect(targetNote);
    });

    expect(useAppStore.getState().fileContents[targetNote.id]).toBe(
      "展示用乱码",
    );
    expect(showNotification).toHaveBeenCalledWith(
      "该文件不是 UTF-8 编码，为避免损坏已禁用保存",
      "error",
    );
  });
});
