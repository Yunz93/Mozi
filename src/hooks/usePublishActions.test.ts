// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAppStore, defaultSettings } from "../store/appStore";
import { useAutoSave } from "./useAutoSave";
import { usePublishActions } from "./usePublishActions";
import { registerActiveEditorFlush } from "../utils/editorSelectionBridge";
import type { WechatDraftPublishInput } from "../utils/wechatPublish";
import { shouldApplyPublishWriteback } from "./usePublishActions";
import { shouldAbortSimpleBlogPublishForMissingHosting } from "../utils/publish/markdownAssetPipeline";

describe("shouldApplyPublishWriteback", () => {
  it("发布期间内容变化 → 不覆盖", () => {
    expect(shouldApplyPublishWriteback("edited by user", "snapshot")).toBe(
      false,
    );
    expect(shouldApplyPublishWriteback("snapshot", "snapshot")).toBe(true);
    expect(shouldApplyPublishWriteback(undefined, "snapshot")).toBe(false);
  });

  it("未配置图床 + 含本地图片 → 不再中止发布", () => {
    expect(
      shouldAbortSimpleBlogPublishForMissingHosting({
        imageHostingConfigured: false,
        hasLocalImages: true,
      }),
    ).toBe(false);
  });
});

const { writeFile, readFile } = vi.hoisted(() => ({
  writeFile: vi.fn<(path: string, content: string) => Promise<void>>(),
  readFile: vi.fn<() => Promise<string>>(),
}));

vi.mock("../types/filesystem", () => ({
  getFileSystem: async () => ({ writeFile, readFile }),
  isTauriEnvironment: () => true,
}));

const NOTE_PATH = "/vault/note.md";
const draftInput: WechatDraftPublishInput = {
  title: "Draft title",
  author: "",
  digest: "",
  contentSourceUrl: "",
  showCoverPic: true,
  coverImagePath: "/cover.png",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderPublishActions() {
  return renderHook(() => {
    const save = useAutoSave({ enabled: false, maxRetries: 0 });
    return { ...usePublishActions(save.forceSave), forceSave: save.forceSave };
  });
}

describe("persistWechatDraftForm 保存并发", () => {
  beforeEach(() => {
    writeFile.mockReset().mockResolvedValue(undefined);
    readFile.mockReset().mockRejectedValue(new Error("ENOENT"));
    useAppStore.setState({
      activeTabId: NOTE_PATH,
      openTabs: [NOTE_PATH],
      currentFilePath: NOTE_PATH,
      files: [
        { id: NOTE_PATH, name: "note.md", path: NOTE_PATH, type: "file" },
      ],
      fileContents: { [NOTE_PATH]: "# Original" },
      lastSavedContent: { [NOTE_PATH]: "# Original" },
      isSaving: false,
      settings: {
        ...defaultSettings,
        fillMissingFrontmatterOnSave: false,
        refreshFrontmatterOnSave: false,
      },
    });
  });

  afterEach(() => {
    cleanup();
    registerActiveEditorFlush(null);
    vi.restoreAllMocks();
  });

  it("保留写盘过程中继续输入的正文并让后续保存落盘", async () => {
    const firstWrite = deferred();
    writeFile.mockImplementationOnce(() => firstWrite.promise);
    const { result } = renderPublishActions();
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistWechatDraftForm(draftInput);
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    const edited = `${useAppStore.getState().fileContents[NOTE_PATH]}\nNew typing`;
    act(() => useAppStore.getState().updateTabContent(NOTE_PATH, edited));
    await act(async () => {
      firstWrite.resolve();
      await saving;
    });
    await waitFor(() =>
      expect(writeFile).toHaveBeenLastCalledWith(NOTE_PATH, edited),
    );
    expect(useAppStore.getState().fileContents[NOTE_PATH]).toBe(edited);
    expect(edited).toContain("title: Draft title");
    expect(useAppStore.getState().lastSavedContent[NOTE_PATH]).toBe(edited);
  });

  it("先同步编辑器尚未进入 store 的尾部输入", async () => {
    const { result } = renderPublishActions();
    registerActiveEditorFlush(() => {
      useAppStore
        .getState()
        .updateTabContent(NOTE_PATH, "# Original\nPending typing");
    });
    await act(async () => {
      await result.current.persistWechatDraftForm(draftInput);
    });
    expect(writeFile.mock.calls.at(-1)?.[1]).toContain("Pending typing");
    expect(useAppStore.getState().fileContents[NOTE_PATH]).toContain(
      "Pending typing",
    );
  });

  it("等待已开始的保存，避免旧保存最后覆盖表单元数据", async () => {
    const firstWrite = deferred();
    writeFile.mockImplementationOnce(() => firstWrite.promise);
    const { result } = renderPublishActions();
    act(() =>
      useAppStore.getState().updateTabContent(NOTE_PATH, "# Before form"),
    );
    let existingSave!: Promise<boolean>;
    act(() => {
      existingSave = result.current.forceSave(undefined, { trigger: "system" });
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistWechatDraftForm(draftInput);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstWrite.resolve();
      await existingSave;
      await saving;
    });
    await waitFor(() =>
      expect(writeFile.mock.calls.at(-1)?.[1]).toContain("title: Draft title"),
    );
    expect(useAppStore.getState().fileContents[NOTE_PATH]).toContain(
      "# Before form",
    );
  });

  it("保存失败时保留继续输入和未保存状态", async () => {
    const firstWrite = deferred();
    writeFile.mockImplementationOnce(async () => {
      await firstWrite.promise;
      throw new Error("disk full");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderPublishActions();
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistWechatDraftForm(draftInput);
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    const edited = `${useAppStore.getState().fileContents[NOTE_PATH]}\nNew typing`;
    act(() => useAppStore.getState().updateTabContent(NOTE_PATH, edited));
    await act(async () => {
      firstWrite.resolve();
      await saving;
    });
    expect(useAppStore.getState().fileContents[NOTE_PATH]).toBe(edited);
    expect(useAppStore.getState().hasUnsavedChanges(NOTE_PATH)).toBe(true);
    expect(edited).toContain("title: Draft title");
  });

  it("写盘完成时先接收仍在编辑器 debounce 内的输入", async () => {
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        fillMissingFrontmatterOnSave: true,
        metadataFields: [
          { key: "status", defaultValue: "draft", description: "" },
        ],
      },
    }));
    const firstWrite = deferred();
    writeFile.mockImplementationOnce(() => firstWrite.promise);
    const { result } = renderPublishActions();
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistWechatDraftForm(draftInput);
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    const edited = `${useAppStore.getState().fileContents[NOTE_PATH]}\nPending during write`;
    let pending = true;
    registerActiveEditorFlush(() => {
      if (!pending) return;
      pending = false;
      useAppStore.getState().updateTabContent(NOTE_PATH, edited);
    });
    await act(async () => {
      firstWrite.resolve();
      await saving;
    });
    expect(useAppStore.getState().fileContents[NOTE_PATH]).toBe(edited);
    await waitFor(() =>
      expect(writeFile).toHaveBeenLastCalledWith(NOTE_PATH, edited),
    );
  });

  it("表单保存等待期间切换文档不把新文档内容写到旧路径", async () => {
    const firstWrite = deferred();
    writeFile.mockImplementationOnce(() => firstWrite.promise);
    const { result } = renderPublishActions();
    act(() =>
      useAppStore.getState().updateTabContent(NOTE_PATH, "# Before form"),
    );
    let existingSave!: Promise<boolean>;
    act(() => {
      existingSave = result.current.forceSave(undefined, { trigger: "system" });
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistWechatDraftForm(draftInput);
    });
    act(() => {
      useAppStore.getState().addTab("/vault/other.md", "Other document");
      useAppStore.getState().setCurrentFilePath("/vault/other.md");
    });
    await act(async () => {
      firstWrite.resolve();
      await existingSave;
      await saving;
    });
    expect(useAppStore.getState().getActiveContent()).toBe("Other document");
    expect(
      writeFile.mock.calls.some(
        ([path, content]) => path === NOTE_PATH && content === "Other document",
      ),
    ).toBe(false);
    expect(writeFile.mock.calls[0][1]).toBe("# Before form");
  });
});
