/** @vitest-environment happy-dom */

import React, { useEffect } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";

const { serializeAsJSON, drawing, writeFile, readFile } = vi.hoisted(() => ({
  drawing: {
    onChange: null as
      | null
      | ((
          elements: unknown[],
          appState: Record<string, unknown>,
          files: Record<string, unknown>,
        ) => void),
    autoChange: true,
  },
  writeFile: vi.fn(async (_path: string, _content: string) => {}),
  readFile: vi.fn(async (_path: string) => "# Other note"),
  serializeAsJSON: vi.fn(() =>
    JSON.stringify({
      type: "excalidraw",
      elements: [{ id: "el-1" }],
    }),
  ),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  restore: (input: unknown) => input,
  serializeAsJSON,
  Excalidraw: ({
    onChange,
  }: {
    onChange: (
      elements: unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void;
  }) => {
    drawing.onChange = onChange;
    useEffect(() => {
      if (drawing.autoChange) onChange([{ id: "dirty" }], {}, {});
    }, [onChange]);
    return <div data-testid="excalidraw-mock" />;
  },
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("../../types/filesystem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../types/filesystem")>()),
  getFileSystem: async () => ({ writeFile, readFile }),
}));

import { flushActiveDocumentIfDirty } from "../../services/filesystem/flushActiveDocument";
import { flushActiveEditorPendingChanges } from "../../utils/editorSelectionBridge";
import { closeTabSafely } from "../../hooks/closeTabSafely";
import { useFileOperations } from "../../hooks/useFileOperations";

const OBSIDIAN_MD = `---
excalidraw-plugin: parsed
---

# Note

## Drawing
\`\`\`json
{"type":"excalidraw","version":2,"elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}
\`\`\`
`;

const PLAIN_JSON = `{
  "type": "excalidraw",
  "version": 2,
  "elements": [],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
`;

describe("ExcalidrawPane tab switch flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    drawing.autoChange = true;
    writeFile.mockClear();
    readFile.mockClear();
    serializeAsJSON.mockClear();
    useAppStore.setState({
      files: [
        {
          id: "/vault/a.excalidraw.md",
          name: "a.excalidraw.md",
          type: "file",
          path: "/vault/a.excalidraw.md",
        },
        {
          id: "/vault/b.excalidraw",
          name: "b.excalidraw",
          type: "file",
          path: "/vault/b.excalidraw",
        },
      ],
      openTabs: ["/vault/a.excalidraw.md", "/vault/b.excalidraw"],
      activeTabId: "/vault/a.excalidraw.md",
      fileContents: {
        "/vault/a.excalidraw.md": OBSIDIAN_MD,
        "/vault/b.excalidraw": PLAIN_JSON,
      },
      lastSavedContent: {
        "/vault/a.excalidraw.md": OBSIDIAN_MD,
        "/vault/b.excalidraw": PLAIN_JSON,
      },
      settings: { ...defaultSettings },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["/vault/a.excalidraw.md", OBSIDIAN_MD],
    ["/vault/b.excalidraw", PLAIN_JSON],
  ])(
    "flushes pending drawing changes to disk before replacing %s",
    async (tabId, original) => {
      drawing.autoChange = false;
      useAppStore.setState({
        activeTabId: tabId,
        openTabs: [tabId],
        fileContents: { [tabId]: original },
        lastSavedContent: { [tabId]: original },
      });
      const { ExcalidrawPane } = await import("./ExcalidrawPane");
      const { unmount } = render(
        <ExcalidrawPane onContentChange={() => undefined} />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => drawing.onChange!([{ id: "new-stroke" }], {}, {}));

      await act(async () => {
        expect(await flushActiveDocumentIfDirty()).toBe(true);
      });
      expect(writeFile).toHaveBeenCalledWith(
        tabId,
        expect.stringContaining("el-1"),
      );
      const saved = writeFile.mock.calls[0][1];
      expect(saved.includes("excalidraw-plugin")).toBe(
        original.includes("excalidraw-plugin"),
      );
      act(() => useAppStore.getState().addTab("/vault/note.md", "Other note"));
      unmount();
      expect(useAppStore.getState().getActiveContent()).toBe("Other note");
      expect(writeFile).toHaveBeenCalledTimes(1);
    },
  );

  it("waits for strokes drawn during a slow save before selecting another note", async () => {
    drawing.autoChange = false;
    const drawingPath = "/vault/a.excalidraw.md";
    const otherNote = {
      id: "/vault/other.md",
      path: "/vault/other.md",
      name: "other.md",
      type: "file" as const,
    };
    useAppStore.setState((state) => ({
      rootFolderPath: "/vault",
      currentFilePath: drawingPath,
      files: [...state.files, otherNote],
      openTabs: [drawingPath],
    }));
    const writeResolvers: Array<() => void> = [];
    const waitForWrite = () =>
      new Promise<void>((resolve) => writeResolvers.push(resolve));
    writeFile
      .mockImplementationOnce(waitForWrite)
      .mockImplementationOnce(waitForWrite);
    const serializeScene = (...args: unknown[]) =>
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: args[0],
        appState: {},
        files: {},
      });
    serializeAsJSON
      .mockImplementationOnce(serializeScene)
      .mockImplementationOnce(serializeScene);
    const { ExcalidrawPane } = await import("./ExcalidrawPane");
    function ActiveDrawing() {
      const activeId = useAppStore((state) => state.activeTabId);
      return activeId === drawingPath ? (
        <ExcalidrawPane onContentChange={() => undefined} />
      ) : null;
    }
    const pane = render(<ActiveDrawing />);
    const operations = renderHook(() => useFileOperations());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => drawing.onChange!([{ id: "stroke-before-save" }], {}, {}));
    let switched = false;
    let switching!: Promise<void>;
    act(() => {
      switching = operations.result.current
        .handleFileSelect(otherNote)
        .then(() => {
          switched = true;
        });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][1]).toContain("stroke-before-save");
    expect(writeFile.mock.calls[0][1]).not.toContain("stroke-during-save");

    act(() =>
      drawing.onChange!(
        [{ id: "stroke-before-save" }, { id: "stroke-during-save" }],
        {},
        {},
      ),
    );
    await act(async () => {
      writeResolvers[0]();
      await Promise.resolve();
    });
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      drawingPath,
      expect.stringContaining("stroke-during-save"),
    );
    expect(switched).toBe(false);
    expect(useAppStore.getState().activeTabId).toBe(drawingPath);
    expect(readFile).not.toHaveBeenCalled();

    await act(async () => {
      writeResolvers[1]();
      await switching;
    });
    expect(switched).toBe(true);
    expect(readFile).toHaveBeenCalledWith(otherNote.path);
    expect(useAppStore.getState().getActiveContent()).toBe("# Other note");
    expect(pane.queryByTestId("excalidraw-mock")).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it("makes pending strokes visible to manual save and does not replay them on unmount", async () => {
    drawing.autoChange = false;
    const tabId = "/vault/a.excalidraw.md";
    const { ExcalidrawPane } = await import("./ExcalidrawPane");
    const { unmount } = render(
      <ExcalidrawPane onContentChange={() => undefined} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => drawing.onChange!([{ id: "new-stroke" }], {}, {}));
    act(() => flushActiveEditorPendingChanges());
    expect(useAppStore.getState().fileContents[tabId]).toContain("el-1");
    expect(useAppStore.getState().hasUnsavedChanges(tabId)).toBe(true);
    expect(serializeAsJSON).toHaveBeenCalledTimes(1);
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(serializeAsJSON).toHaveBeenCalledTimes(1);
  });

  it("saves pending strokes when closing an otherwise clean drawing", async () => {
    drawing.autoChange = false;
    const tabId = "/vault/a.excalidraw.md";
    const { ExcalidrawPane } = await import("./ExcalidrawPane");
    render(<ExcalidrawPane onContentChange={() => undefined} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => drawing.onChange!([{ id: "new-stroke" }], {}, {}));
    await act(async () => {
      const closed = await closeTabSafely({
        tabId,
        forceSave: flushActiveDocumentIfDirty,
        closeTab: (id) => useAppStore.getState().closeTab(id),
        hasUnsavedChanges: (id) => useAppStore.getState().hasUnsavedChanges(id),
        isTabOpen: (id) => useAppStore.getState().openTabs.includes(id),
        onBlocked: vi.fn(),
      });
      expect(closed).toBe(true);
    });
    expect(writeFile).toHaveBeenCalledWith(
      tabId,
      expect.stringContaining("el-1"),
    );
    expect(useAppStore.getState().openTabs).toEqual([]);
  });

  it("writes the old tab back in its original wrapper format when switching tabs", async () => {
    const { ExcalidrawPane } = await import("./ExcalidrawPane");
    const { rerender } = render(
      <ExcalidrawPane onContentChange={() => undefined} />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    useAppStore.setState({ activeTabId: "/vault/b.excalidraw" });
    rerender(<ExcalidrawPane />);

    await act(async () => {
      await Promise.resolve();
    });

    const written =
      useAppStore.getState().fileContents["/vault/a.excalidraw.md"];
    expect(written).toContain("excalidraw-plugin");
    expect(written).toContain("## Drawing");
    expect(written).not.toBe(PLAIN_JSON);
  });
});
