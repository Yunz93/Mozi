// @vitest-environment happy-dom
import React, { useCallback, useEffect } from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { useAppStore, selectContent, defaultSettings } from "@/store/appStore";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useCodeMirror } from "@/components/editor/hooks/useCodeMirror";
import { undo, undoDepth } from "@codemirror/commands";
import { useAutoSave } from "@/hooks/useAutoSave";
import { registerActiveEditorFlush } from "@/utils/editorSelectionBridge";
const { readFile, writeFile, renameEntry } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<string>>(),
  writeFile: vi.fn(async (_path: string, _content: string) => {}),
  renameEntry: vi.fn(async () => "/vault/renamed.md"),
}));
vi.mock("@/types/filesystem", () => ({
  getFileSystem: async () => ({
    readFile,
    writeFile,
    renameEntry,
    fileExists: async () => false,
    readDirectory: async () => [],
  }),
  isTauriEnvironment: () => false,
}));
let cm: ReturnType<typeof useCodeMirror>;
function Editor() {
  const content = useAppStore(selectContent);
  const id = useAppStore((s) => s.activeTabId);
  const onChange = useCallback(
    (text: string) => {
      if (id) useAppStore.getState().setContentForFile(id, text);
    },
    [id],
  );
  const api = useCodeMirror({ content, documentKey: id, onChange });
  useEffect(() => {
    cm = api;
    registerActiveEditorFlush(api.flushPendingContentChange);
    return () => registerActiveEditorFlush(null);
  }, [api]);
  return <div ref={api.editorRef} />;
}
const a = {
  id: "/vault/a.md",
  path: "/vault/a.md",
  name: "a.md",
  type: "file" as const,
};
const b = {
  id: "/vault/b.md",
  path: "/vault/b.md",
  name: "b.md",
  type: "file" as const,
};
const c = {
  id: "/vault/c.md",
  path: "/vault/c.md",
  name: "c.md",
  type: "file" as const,
};
beforeEach(() => {
  cm = null!;
  vi.restoreAllMocks();
  readFile.mockReset();
  writeFile.mockReset().mockResolvedValue(undefined);
  useAppStore.setState({
    rootFolderPath: "/vault",
    files: [a, b, c],
    openTabs: [a.id],
    activeTabId: a.id,
    currentFilePath: a.path,
    fileContents: { [a.id]: "# A" },
    lastSavedContent: { [a.id]: "# A" },
    fileHistories: {},
    settings: {
      ...defaultSettings,
      refreshFrontmatterOnSave: false,
      fillMissingFrontmatterOnSave: false,
    },
  });
});
afterEach(() => cleanup());
it("preserves editing done while the selected Markdown file is still loading", async () => {
  let resolveRead!: (value: string) => void;
  readFile.mockImplementation(
    () => new Promise<string>((r) => (resolveRead = r)),
  );
  render(<Editor />);
  const ops = renderHook(() => useFileOperations());
  await waitFor(() => expect(cm?.view).toBeTruthy());
  let opening!: Promise<void>;
  act(() => {
    opening = ops.result.current.handleFileSelect(b);
  });
  await waitFor(() => expect(readFile).toHaveBeenCalledWith(b.path));
  expect(useAppStore.getState().activeTabId).toBe(b.id);
  act(() => {
    cm.view!.dispatch({
      changes: {
        from: 0,
        to: cm.view!.state.doc.length,
        insert: "User typed during loading",
      },
      userEvent: "input",
    });
    cm.flushPendingContentChange();
  });
  expect(useAppStore.getState().fileContents[b.id]).toBe(
    "User typed during loading",
  );
  await act(async () => {
    resolveRead("# Old disk B");
    await opening;
  });
  expect(cm.view!.state.doc.toString()).toBe("User typed during loading");
  expect(useAppStore.getState().hasUnsavedChanges(b.id)).toBe(true);
  expect(useAppStore.getState().lastSavedContent[b.id]).toBe("# Old disk B");
});
it("does not replace the current file when an obsolete open fails", async () => {
  let rejectRead!: (error: Error) => void;
  readFile.mockImplementation((path: string) =>
    path === b.path
      ? new Promise<string>((_r, j) => (rejectRead = j))
      : Promise.resolve("# C"),
  );
  const ops = renderHook(() => useFileOperations());
  let openingB!: Promise<void>;
  act(() => {
    openingB = ops.result.current.handleFileSelect(b);
  });
  await waitFor(() => expect(readFile).toHaveBeenCalledWith(b.path));
  await act(async () => {
    await ops.result.current.handleFileSelect(c);
  });
  expect(useAppStore.getState().activeTabId).toBe(c.id);
  act(() =>
    useAppStore.getState().setContentForFile(c.id, "# C with new edits"),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => {
    rejectRead(new Error("network volume read failed"));
    await openingB;
  });
  expect(useAppStore.getState().activeTabId).toBe(c.id);
  expect(useAppStore.getState().getActiveContent()).toBe("# C with new edits");
});
it("preserves document undo when the same file gets a new path", async () => {
  readFile.mockResolvedValue("# A!");
  render(<Editor />);
  const ops = renderHook(() => useFileOperations());
  await waitFor(() => expect(cm?.view).toBeTruthy());
  act(() => {
    cm.view!.dispatch({
      changes: { from: 3, insert: "!" },
      userEvent: "input",
    });
    cm.flushPendingContentChange();
  });
  expect(cm.view!.state.doc.toString()).toBe("# A!");
  expect(undoDepth(cm.view!.state)).toBeGreaterThan(0);
  await act(async () => {
    await ops.result.current.handleRename(a, "renamed.md");
  });
  expect(useAppStore.getState().activeTabId).toBe("/vault/renamed.md");
  expect(cm.view!.state.doc.toString()).toBe("# A!");
  let undone = false;
  act(() => {
    undone = undo(cm.view!);
  });
  expect(undone).toBe(true);
  expect(cm.view!.state.doc.toString()).toBe("# A");
});
it.each(["# A latest edit", "# A"])(
  "serializes autosave and pre-switch save when latest content is %s",
  async (latestContent) => {
    const commits: Array<() => void> = [];
    const disk = new Map<string, string>([[a.path, "# A"]]);
    writeFile.mockReset().mockImplementation(
      (path: string, content: string) =>
        new Promise<void>((r) => {
          const commit = () => {
            disk.set(path, content);
            r();
          };
          if (commits.length < 2) commits.push(commit);
          else commit();
        }),
    );
    readFile.mockImplementation(async (path: string) =>
      path === a.path ? disk.get(a.path)! : "# B",
    );
    const save = renderHook(() =>
      useAutoSave({ enabled: false, maxRetries: 0 }),
    );
    const ops = renderHook(() => useFileOperations());
    act(() => useAppStore.getState().setContentForFile(a.id, "# A first edit"));
    let first!: Promise<boolean>;
    act(() => {
      first = save.result.current.forceSave(undefined, { trigger: "auto" });
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    act(() => useAppStore.getState().setContentForFile(a.id, latestContent));
    let opening!: Promise<void>;
    act(() => {
      opening = ops.result.current.handleFileSelect(b);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 切换前保存必须等待已有写盘完成，不能同时提交两个版本。
    expect(writeFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      commits[0]();
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
    await act(async () => {
      commits[1]();
      await opening;
    });
    await first;
    expect(useAppStore.getState().activeTabId).toBe(b.id);
    expect(disk.get(a.path)).toBe(latestContent);
  },
);

it("does not cancel a valid pending read when an unsupported attachment is clicked", async () => {
  let resolveRead!: (content: string) => void;
  readFile.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
  );
  const ops = renderHook(() => useFileOperations());
  let opening!: Promise<void>;
  act(() => {
    opening = ops.result.current.handleFileSelect(b);
  });
  await waitFor(() => expect(readFile).toHaveBeenCalledWith(b.path));
  await act(async () => {
    await ops.result.current.handleFileSelect({
      id: "/vault/a.zip",
      path: "/vault/a.zip",
      name: "a.zip",
      type: "file",
    });
  });
  await act(async () => {
    resolveRead("# Existing B");
    await opening;
  });
  expect(useAppStore.getState().activeTabId).toBe(b.id);
  expect(useAppStore.getState().getActiveContent()).toBe("# Existing B");
});

it("flushes debounced input before applying the load result", async () => {
  let resolveRead!: (content: string) => void;
  readFile.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
  );
  render(<Editor />);
  const ops = renderHook(() => useFileOperations());
  await waitFor(() => expect(cm?.view).toBeTruthy());
  let opening!: Promise<void>;
  act(() => {
    opening = ops.result.current.handleFileSelect(b);
  });
  await waitFor(() => expect(readFile).toHaveBeenCalledWith(b.path));
  await act(async () => {
    cm.view!.dispatch({
      changes: { from: 0, insert: "pending keystrokes" },
      userEvent: "input",
    });
    resolveRead("# Disk B");
    await opening;
  });
  expect(cm.view!.state.doc.toString()).toBe("pending keystrokes");
  expect(useAppStore.getState().fileContents[b.id]).toBe("pending keystrokes");
  expect(useAppStore.getState().hasUnsavedChanges(b.id)).toBe(true);
});
