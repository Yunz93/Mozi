/** @vitest-environment happy-dom */

import React from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { ViewMode } from "../../types";
import type { UseCodeMirrorOptions } from "./hooks/useCodeMirror";
import { EditorPane } from "./EditorPane";

const mocks = vi.hoisted(() => ({
  useCodeMirror: vi.fn(),
  showNotification: vi.fn(),
  uploadImageToHosting: vi.fn(),
  resolveAttachmentTarget: vi.fn(),
  readBinaryFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  scroll: {
    handleScroll: vi.fn(),
    cancelScrollSync: vi.fn(),
    syncScrollTo: vi.fn(),
    registerView: vi.fn(),
  },
  wikiLinks: { completionSource: vi.fn(), buildPreview: vi.fn() },
  wikiNavigation: { navigateToWikilink: vi.fn() },
  fileSystem: {
    writeBinaryFile: vi.fn(),
    refreshFileTree: vi.fn(),
    readFile: vi.fn(),
  },
  fileOperations: { handleFileSelect: vi.fn() },
}));

vi.mock("./hooks", () => ({
  useCodeMirror: mocks.useCodeMirror,
  useWikiLinks: () => mocks.wikiLinks,
  useImagePaste: () => ({ handlePastedImage: vi.fn() }),
  useScrollSync: () => mocks.scroll,
  useWikiLinkNavigation: () => mocks.wikiNavigation,
}));
vi.mock("../../hooks/useFileSystem", () => ({
  useFileSystem: () => mocks.fileSystem,
}));
vi.mock("../../hooks/useFileOperations", () => ({
  useFileOperations: () => mocks.fileOperations,
}));
vi.mock("../../services/imageHostingService", () => ({
  isImageHostingEnabled: () => true,
  uploadImageToHosting: mocks.uploadImageToHosting,
}));
vi.mock("../../utils/attachmentResolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/attachmentResolver")>()),
  resolveAttachmentTarget: mocks.resolveAttachmentTarget,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: mocks.readBinaryFile }));
vi.mock("../../utils/imageHostingFilename", () => ({
  buildHostedImageFilename: async () => "image.png",
}));
vi.mock("./livePreview/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./livePreview/shared")>()),
  posAtClientPoint: () => 2,
}));

const sourceText = "alpha and original A";
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
let view: EditorView;

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    settings: { ...defaultSettings, language: "zh-CN" },
    files: [a, b],
    rootFolderPath: "/vault",
    activeTabId: a.id,
    currentFilePath: a.path,
    openTabs: [a.id, b.id],
    fileContents: { [a.id]: sourceText, [b.id]: "B must remain unchanged" },
    viewMode: ViewMode.EDITOR,
    showNotification: mocks.showNotification,
  });
  view = new EditorView({
    state: EditorState.create({
      doc: sourceText,
      selection: { anchor: 0, head: 5 },
    }),
  });
  const api = {
    view,
    editorRef: (element: HTMLDivElement | null) =>
      element?.appendChild(view.dom),
    flushPendingContentChange: vi.fn(),
  };
  mocks.useCodeMirror.mockReturnValue(api);
});

afterEach(() => {
  cleanup();
  view.destroy();
});

function beginGeneration(beforeClick?: () => void) {
  let finish!: (replacement: string | null) => void;
  const generate = vi.fn(
    () => new Promise<string | null>((resolve) => (finish = resolve)),
  );
  const mounted = render(<EditorPane onGenerateWikiFromSelection={generate} />);
  const options = mocks.useCodeMirror.mock.calls.at(
    -1,
  )![0] as UseCodeMirrorOptions;
  act(() => {
    options.onContextMenu!(new MouseEvent("contextmenu"), view);
  });
  if (beforeClick) act(beforeClick);
  fireEvent.click(screen.getByRole("button", { name: "AI 生成字段解读 Wiki" }));
  if (!beforeClick) {
    expect(generate).toHaveBeenCalledWith({ text: "alpha", from: 0, to: 5 });
  }
  return {
    ...mounted,
    generate,
    finish: async () => {
      await act(async () => {
        finish("[[wiki/Alpha|alpha]]");
        await Promise.resolve();
      });
    },
  };
}

describe("EditorPane asynchronous Wiki replacement", () => {
  it("replaces the selected text when the source document is unchanged", async () => {
    const generation = beginGeneration();
    await generation.finish();
    expect(view.state.doc.toString()).toBe(
      "[[wiki/Alpha|alpha]] and original A",
    );
    expect(mocks.showNotification).not.toHaveBeenCalled();
  });

  it("keeps a newer caret when Wiki generation finishes", async () => {
    const generation = beginGeneration();
    act(() => view.dispatch({ selection: { anchor: sourceText.length } }));
    await generation.finish();
    expect(view.state.doc.toString()).toBe(
      "[[wiki/Alpha|alpha]] and original A",
    );
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(view.state.selection.main.empty).toBe(true);
  });

  it("preserves another tab when the same EditorView is reused", async () => {
    const generation = beginGeneration();
    act(() => {
      useAppStore.setState({ activeTabId: b.id, currentFilePath: b.path });
      view.setState(EditorState.create({ doc: "B must remain unchanged" }));
    });
    await generation.finish();
    expect(view.state.doc.toString()).toBe("B must remain unchanged");
    expect(mocks.showNotification).toHaveBeenCalledWith(
      expect.any(String),
      "warning",
    );
  });

  it("does not replace stale offsets after editing the source document", async () => {
    const generation = beginGeneration();
    act(() => view.dispatch({ changes: { from: 0, insert: "new input " } }));
    await generation.finish();
    expect(view.state.doc.toString()).toBe("new input " + sourceText);
    expect(mocks.showNotification).toHaveBeenCalledWith(
      expect.any(String),
      "warning",
    );
  });

  it("does not dispatch to a destroyed editor after the pane closes", async () => {
    const generation = beginGeneration();
    generation.unmount();
    view.destroy();
    const dispatch = vi.spyOn(view, "dispatch");
    await generation.finish();
    expect(dispatch).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(sourceText);
  });

  it("does not reactivate a request after switching away and back", async () => {
    const generation = beginGeneration();
    act(() => {
      useAppStore.setState({ activeTabId: b.id, currentFilePath: b.path });
      useAppStore.setState({ activeTabId: a.id, currentFilePath: a.path });
    });
    await generation.finish();
    expect(view.state.doc.toString()).toBe(sourceText);
  });

  it("preserves the note after switching knowledge bases", async () => {
    const generation = beginGeneration();
    act(() => useAppStore.setState({ rootFolderPath: "/other-vault" }));
    await generation.finish();
    expect(view.state.doc.toString()).toBe(sourceText);
  });

  it("does not use stale offsets if the document changes while the selection menu is open", async () => {
    const generation = beginGeneration(() => {
      view.dispatch({ changes: { from: 0, insert: "new input " } });
    });
    if (generation.generate.mock.calls.length > 0) await generation.finish();
    expect(view.state.doc.toString()).toBe("new input " + sourceText);
  });
});

describe("EditorPane asynchronous image upload replacement", () => {
  it("keeps a newer selection when a local image finishes uploading", async () => {
    const doc = "![image](resources/image.png)\n\n继续编辑正文";
    view.setState(EditorState.create({ doc }));
    useAppStore.setState({
      fileContents: { [a.id]: doc },
      settings: {
        ...defaultSettings,
        imageHosting: { ...defaultSettings.imageHosting, provider: "github" },
      },
    });
    let finish!: (value: { url: string }) => void;
    mocks.uploadImageToHosting.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.resolveAttachmentTarget.mockResolvedValue({
      path: "/vault/resources/image.png",
      name: "image.png",
    });
    render(<EditorPane />);
    const options = mocks.useCodeMirror.mock.calls.at(
      -1,
    )![0] as UseCodeMirrorOptions;
    act(() => {
      options.onContextMenu!(new MouseEvent("contextmenu"), view);
    });
    fireEvent.click(screen.getByRole("button", { name: "上传到图床" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.uploadImageToHosting).toHaveBeenCalledOnce();
    view.dispatch({
      selection: { anchor: doc.indexOf("继续"), head: doc.length },
    });
    await act(async () => {
      finish({ url: "https://example.com/hosted.png" });
      await Promise.resolve();
    });
    expect(view.state.doc.toString()).toContain(
      "https://example.com/hosted.png",
    );
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("继续编辑正文");
  });
});
