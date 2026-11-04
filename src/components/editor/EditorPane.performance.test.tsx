/** @vitest-environment happy-dom */

import React from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { ViewMode } from "../../types";
import type { UseCodeMirrorOptions } from "./hooks/useCodeMirror";
import { EditorPane } from "./EditorPane";

const mocks = vi.hoisted(() => ({
  useCodeMirror: vi.fn(),
  showNotification: vi.fn(),
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
    viewMode: ViewMode.LIVE,
    liveSourceMarkdown: false,
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

function currentOptions(): UseCodeMirrorOptions {
  return mocks.useCodeMirror.mock.calls.at(-1)![0] as UseCodeMirrorOptions;
}

describe("EditorPane mode switch configuration", () => {
  it("retains the hidden editor configuration when entering and leaving reading", () => {
    render(<EditorPane />);
    expect(currentOptions().livePreviewEnabled).toBe(true);
    act(() => useAppStore.getState().setViewMode(ViewMode.PREVIEW));
    expect(currentOptions().livePreviewEnabled).toBe(true);
    act(() => useAppStore.getState().setViewMode(ViewMode.LIVE));
    expect(currentOptions().livePreviewEnabled).toBe(true);
  });

  it("still reconfigures a real source-mode change and handles an initially reading-only pane", () => {
    useAppStore.setState({ viewMode: ViewMode.PREVIEW });
    render(<EditorPane />);
    expect(currentOptions().livePreviewEnabled).toBe(false);
    act(() => useAppStore.getState().setViewMode(ViewMode.LIVE));
    expect(currentOptions().livePreviewEnabled).toBe(true);
    act(() => useAppStore.getState().setLiveSourceMarkdown(true));
    expect(currentOptions().livePreviewEnabled).toBe(false);
    act(() => useAppStore.getState().setViewMode(ViewMode.PREVIEW));
    expect(currentOptions().livePreviewEnabled).toBe(false);
    act(() => useAppStore.getState().setViewMode(ViewMode.LIVE));
    expect(currentOptions().livePreviewEnabled).toBe(false);
    act(() => useAppStore.getState().setLiveSourceMarkdown(false));
    expect(currentOptions().livePreviewEnabled).toBe(true);
  });
  it("does not carry Live widgets into a different document opened in reading", () => {
    render(<EditorPane />);
    expect(currentOptions().livePreviewEnabled).toBe(true);
    act(() => useAppStore.getState().setViewMode(ViewMode.PREVIEW));
    expect(currentOptions().livePreviewEnabled).toBe(true);
    act(() =>
      useAppStore.setState({ activeTabId: b.id, currentFilePath: b.path }),
    );
    expect(currentOptions().livePreviewEnabled).toBe(false);
    act(() => useAppStore.getState().setViewMode(ViewMode.LIVE));
    expect(currentOptions().livePreviewEnabled).toBe(true);
  });
});
