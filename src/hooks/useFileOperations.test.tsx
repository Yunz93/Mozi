/** @vitest-environment happy-dom */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import type { FileNode } from "../types";
import { registerActiveEditorFlush } from "../utils/editorSelectionBridge";
import { getFileSystem } from "../types/filesystem";

const {
  readFileMock,
  diskReadMock,
  isNonUtf8PathMock,
  writeFileMock,
  renameFileMock,
} = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  diskReadMock: vi.fn(),
  isNonUtf8PathMock: vi.fn((_path?: string) => false),
  writeFileMock: vi.fn(async (_path: string, _content: string) => {}),
  renameFileMock: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(
    async () => undefined,
  ),
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
    readFile: diskReadMock,
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
  function prepareReferenceRename(content = "Original [[target]]") {
    useAppStore.setState({
      rootFolderPath: "/vault",
      fileContents: { [previousNote.id]: content, [targetNote.id]: "" },
      lastSavedContent: { [previousNote.id]: content, [targetNote.id]: "" },
      linkIndex: null,
      chunkIndex: null,
    });
    renameFileMock.mockImplementation(async () => {
      useAppStore.getState().setFiles([
        previousNote,
        {
          ...targetNote,
          id: "/vault/renamed.md",
          path: "/vault/renamed.md",
          name: "renamed.md",
        },
      ]);
      return "/vault/renamed.md";
    });
    let ops: ReturnType<typeof useFileOperations> | null = null;
    render(<Harness onReady={(value) => (ops = value)} />);
    return () => ops!.handleRename(targetNote, "renamed");
  }
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
      rootFolderPath: null,
    });
  });

  beforeEach(() => {
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    renameFileMock.mockReset();
    renameFileMock.mockResolvedValue(undefined);
    readFileMock.mockReset();
    diskReadMock.mockReset();
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

  it("does not overwrite a newly saved reference while the rewrite scan is waiting", async () => {
    const old = {
      ...targetNote,
      id: "/vault/old.md",
      path: "/vault/old.md",
      name: "old.md",
    };
    const slow = {
      ...targetNote,
      id: "/vault/zslow.md",
      path: "/vault/zslow.md",
      name: "zslow.md",
    };
    let resume!: (text: string) => void;
    let waiting = false;
    const paused = new Promise<string>((resolve) => {
      resume = resolve;
    });
    let diskReference = "Original [[old]]";
    diskReadMock.mockImplementation(async (path: string) => {
      if (path === slow.path) {
        waiting = true;
        return paused;
      }
      return path === previousNote.path ? diskReference : "";
    });
    useAppStore.setState({
      rootFolderPath: "/vault",
      files: [old, previousNote, slow],
      fileContents: { [previousNote.id]: diskReference },
      lastSavedContent: { [previousNote.id]: diskReference },
      linkIndex: null,
      chunkIndex: null,
    });
    renameFileMock.mockImplementation(async () => {
      useAppStore.getState().setFiles([
        {
          ...old,
          id: "/vault/new.md",
          path: "/vault/new.md",
          name: "new.md",
        },
        previousNote,
        slow,
      ]);
      return "/vault/new.md";
    });
    let ops: ReturnType<typeof useFileOperations> | null = null;
    render(<Harness onReady={(value) => (ops = value)} />);
    let work!: Promise<void>;
    await act(async () => {
      work = ops!.handleRename(old, "new");
      await Promise.resolve();
    });
    await waitFor(() => expect(waiting).toBe(true));
    await act(async () => {
      diskReference = "New paragraph [[old]]";
      useAppStore.getState().setContentForFile(previousNote.id, diskReference);
      useAppStore.getState().markAsSaved(previousNote.id, diskReference);
      resume("");
      await work;
    });
    expect(writeFileMock).not.toHaveBeenCalledWith(
      previousNote.path,
      "Original [[new]]",
    );
    expect(useAppStore.getState().fileContents[previousNote.id]).toBe(
      diskReference,
    );
  });

  it("uses compare-and-write for an unchanged reference and tolerates BOM/CRLF", async () => {
    const original = "Original [[target]]\n";
    const rename = prepareReferenceRename(original);
    const compareAndWrite = vi.fn(async () => true);
    vi.mocked(getFileSystem).mockResolvedValueOnce({
      readFile: vi.fn(async () => "\ufeffOriginal [[target]]\r\n"),
      writeFile: writeFileMock,
      writeFileIfUnchanged: compareAndWrite,
    } as unknown as Awaited<ReturnType<typeof getFileSystem>>);
    await act(async () => {
      await rename();
    });
    expect(compareAndWrite).toHaveBeenCalledWith(
      previousNote.path,
      "Original [[renamed]]\n",
      original,
    );
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileContents[previousNote.id]).toBe(
      "Original [[renamed]]\n",
    );
    expect(useAppStore.getState().hasUnsavedChanges(previousNote.id)).toBe(
      false,
    );
  });

  it("preserves a reference when compare-and-write detects a concurrent disk change", async () => {
    const rename = prepareReferenceRename();
    const compareAndWrite = vi.fn(async () => false);
    vi.mocked(getFileSystem).mockResolvedValueOnce({
      readFile: vi.fn(async () => "Original [[target]]"),
      writeFile: writeFileMock,
      writeFileIfUnchanged: compareAndWrite,
    } as unknown as Awaited<ReturnType<typeof getFileSystem>>);
    await act(async () => {
      await rename();
    });
    expect(compareAndWrite).toHaveBeenCalledOnce();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileContents[previousNote.id]).toBe(
      "Original [[target]]",
    );
  });

  it("preserves edits made while compare-and-write is pending and tracks the written baseline", async () => {
    const rename = prepareReferenceRename();
    let complete!: (saved: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    const compareAndWrite = vi.fn(() => pending);
    vi.mocked(getFileSystem).mockResolvedValueOnce({
      readFile: vi.fn(async () => "Original [[target]]"),
      writeFile: writeFileMock,
      writeFileIfUnchanged: compareAndWrite,
    } as unknown as Awaited<ReturnType<typeof getFileSystem>>);
    let work!: Promise<void>;
    await act(async () => {
      work = rename();
      await Promise.resolve();
    });
    await waitFor(() => expect(compareAndWrite).toHaveBeenCalledOnce());
    await act(async () => {
      useAppStore
        .getState()
        .setContentForFile(previousNote.id, "New typing [[target]]");
      complete(true);
      await work;
    });
    expect(useAppStore.getState().fileContents[previousNote.id]).toBe(
      "New typing [[target]]",
    );
    expect(useAppStore.getState().lastSavedContent[previousNote.id]).toBe(
      "Original [[renamed]]",
    );
    expect(useAppStore.getState().hasUnsavedChanges(previousNote.id)).toBe(
      true,
    );
  });

  it("does not overwrite an external edit found during the final disk read", async () => {
    const rename = prepareReferenceRename();
    diskReadMock.mockResolvedValue("External update [[target]]");
    await act(async () => {
      await rename();
    });
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileContents[previousNote.id]).toBe(
      "Original [[target]]",
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
