// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, defaultSettings } from "../store/appStore";
import { usePublishActions } from "./usePublishActions";
import { ensureSimpleBlogPublishBinding } from "../utils/simpleBlogPublish";
import { writeDocumentFile } from "../services/filesystem/documentWriteQueue";
import { registerActiveEditorFlush } from "../utils/editorSelectionBridge";

const { invoke, writeFile, readFile } = vi.hoisted(() => ({
  invoke: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: () => true,
  getFileSystem: async () => ({ writeFile, readFile }),
}));
vi.mock("../services/secureSettingsService", () => ({
  hydrateSensitiveSettingsIntoStore: async () =>
    useAppStore.getState().settings,
}));
vi.mock("../utils/simpleBlogPublish", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/simpleBlogPublish")>();
  return {
    ...actual,
    prepareSimpleBlogPublish: vi.fn(actual.prepareSimpleBlogPublish),
  };
});

const path = "/vault/note.md";
const input = { title: "Note", slug: "note", aliases: "" };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const forceSave = vi.fn(async (content: string | undefined) => {
    if (content !== undefined) {
      await writeDocumentFile(path, content);
      useAppStore.getState().markAsSaved(path, content);
    }
    return true;
  });
  return { ...renderHook(() => usePublishActions(forceSave)), forceSave };
}

describe("发布完成后的正文回写", () => {
  let disk = "# Original";
  beforeEach(() => {
    disk = "# Original";
    invoke.mockReset().mockResolvedValue({});
    readFile.mockReset().mockImplementation(async () => disk);
    writeFile.mockReset().mockImplementation(async (_path, content) => {
      disk = content;
    });
    useAppStore.setState({
      activeTabId: path,
      openTabs: [path],
      currentFilePath: path,
      rootFolderPath: "/vault",
      files: [{ id: path, name: "note.md", path, type: "file" }],
      fileContents: { [path]: disk },
      lastSavedContent: { [path]: disk },
      settings: {
        ...defaultSettings,
        blogRepoUrl: "https://github.com/example/blog",
        blogSiteUrl: "https://example.com",
        blogGithubToken: "test-only",
      },
    });
  });
  afterEach(() => {
    cleanup();
    registerActiveEditorFlush(null);
  });

  it.each(["uuid", "legacy"])(
    "副本%s关联冲突时不保存、不调用远端发布",
    async (kind) => {
      const original = "/vault/original.md";
      const content =
        kind === "uuid"
          ? ensureSimpleBlogPublishBinding(
              "# Original",
              original,
              "https://github.com/example/blog",
              "https://example.com",
            )
          : "---\nis_publish: true\nslug: original\nlink: https://example.com/posts/original/\n---\n# Original";
      disk = content;
      useAppStore.setState({
        files: [
          { id: path, name: "note.md", path, type: "file" },
          { id: original, name: "original.md", path: original, type: "file" },
        ],
        fileContents: { [path]: content, [original]: content },
        lastSavedContent: { [path]: content },
      });
      invoke.mockImplementation(async (command) =>
        command === "read_file_prefix" ? content : {},
      );
      const timer = vi.spyOn(globalThis, "setTimeout");
      const { result, forceSave } = setup();
      let published: boolean | undefined;
      await act(async () => {
        published = await result.current.handlePublishSimpleBlog(input);
      });
      expect(published).toBe(false);
      expect(
        invoke.mock.calls.some(
          ([command]) => command === "publish_simple_blog",
        ),
      ).toBe(false);
      expect(forceSave).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 15000);
      timer.mockRestore();
      expect(disk).toBe(content);
    },
  );

  it("归属检查读取期间发生输入时不保存旧快照", async () => {
    const content = ensureSimpleBlogPublishBinding(
      "# Original",
      path,
      "https://github.com/example/blog",
      "https://example.com",
    );
    disk = content;
    const blocked = deferred();
    invoke.mockImplementation(async (command) => {
      if (command === "read_file_prefix") {
        await blocked.promise;
        return "# Unrelated";
      }
      return {};
    });
    const other = "/vault/other.md";
    useAppStore.setState({
      files: [
        { id: path, name: "note.md", path, type: "file" },
        { id: other, name: "other.md", path: other, type: "file" },
      ],
      fileContents: { [path]: content },
      lastSavedContent: { [path]: content },
    });
    const { result, forceSave } = setup();
    let publishing!: Promise<boolean>;
    act(() => {
      publishing = result.current.handlePublishSimpleBlog(input);
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("read_file_prefix", { path: other }),
    );
    act(() =>
      useAppStore.getState().updateTabContent(path, content + "\nNew typing"),
    );
    let published: boolean | undefined;
    await act(async () => {
      blocked.resolve();
      published = await publishing;
    });
    expect(published).toBe(false);
    expect(forceSave).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileContents[path]).toBe(
      content + "\nNew typing",
    );
  });

  it("回写与手动保存共用队列，保留写入期间的新输入", async () => {
    const blocked = deferred();
    let writingBack = false;
    writeFile.mockImplementation(async (_path, content: string) => {
      if (content.includes("is_publish: true") && !writingBack) {
        writingBack = true;
        await blocked.promise;
      }
      disk = content;
    });
    const { result } = setup();
    let publishing!: Promise<boolean>;
    act(() => {
      publishing = result.current.handlePublishSimpleBlog(input);
    });
    await waitFor(() => expect(writingBack).toBe(true));
    const edited = useAppStore.getState().fileContents[path] + "\nNew typing";
    act(() => useAppStore.getState().updateTabContent(path, edited));
    const saving = writeDocumentFile(path, edited);
    await act(async () => {
      blocked.resolve();
      await publishing;
      await saving;
    });
    expect(disk).toContain("New typing");
    expect(disk).toContain("is_publish: true");
    expect(useAppStore.getState().fileContents[path]).toBe(disk);
    expect(useAppStore.getState().lastSavedContent[path]).toBe(disk);
  });

  it("磁盘保留CRLF和BOM时仍正常回填", async () => {
    readFile.mockImplementation(
      async () => "\uFEFF" + disk.replace(/\n/g, "\r\n"),
    );
    const { result } = setup();
    await act(async () => {
      await result.current.handlePublishSimpleBlog(input);
    });
    expect(disk).toContain("is_publish: true");
  });

  it("远端发布期间其他窗口修改磁盘时拒绝回写旧缓冲", async () => {
    invoke.mockImplementation(async () => {
      disk += "\nExternal window edit";
      return {};
    });
    const { result } = setup();
    await act(async () => {
      await result.current.handlePublishSimpleBlog(input);
    });
    expect(disk).toContain("External window edit");
    expect(disk).not.toContain("is_publish: true");
    expect(useAppStore.getState().notification?.type).toBe("warning");
  });

  it("回写前接收仍在编辑器中的输入", async () => {
    invoke.mockImplementation(async () => {
      registerActiveEditorFlush(() => {
        const state = useAppStore.getState();
        if (!state.fileContents[path].includes("Pending typing")) {
          state.updateTabContent(
            path,
            state.fileContents[path] + "\nPending typing",
          );
        }
      });
      return {};
    });
    const { result } = setup();
    await act(async () => {
      await result.current.handlePublishSimpleBlog(input);
    });
    expect(disk).toContain("Pending typing");
    expect(disk).toContain("is_publish: true");
  });

  it("发布失败可以重试且不会产生未处理的拒绝", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error("offline"));
    const { result } = setup();
    await act(async () => {
      expect(await result.current.handlePublishSimpleBlog(input)).toBe(false);
    });
    await act(async () => {
      expect(await result.current.handlePublishSimpleBlog(input)).toBe(true);
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    const requests = invoke.mock.calls.map((call) => call[1].request);
    expect(requests[0].publishId).toMatch(/^[a-f0-9-]{36}$/);
    expect(requests[1].publishId).toBe(requests[0].publishId);
    expect(requests[1].postRelativePath).toBe(requests[0].postRelativePath);
    vi.restoreAllMocks();
  });
});
