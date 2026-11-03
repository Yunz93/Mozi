/** @vitest-environment happy-dom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../../store/appStore";
import { ViewMode } from "../../../types";
import {
  __resetPreviewNavigationBridgeForTests,
  flushPendingPreviewHeadingScroll,
  registerPreviewPane,
} from "../../../utils/previewNavigationBridge";
import { useSidebarSearch } from "./useSidebarSearch";

const { editorFocus } = vi.hoisted(() => ({ editorFocus: vi.fn() }));
vi.mock("../../../utils/editorSelectionBridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../utils/editorSelectionBridge")
  >()),
  requestEditorRangeFocus: editorFocus,
}));

const file = {
  id: "/vault/source.md",
  path: "/vault/source.md",
  name: "source.md",
  type: "file" as const,
};

beforeEach(() => {
  editorFocus.mockReset();
  __resetPreviewNavigationBridgeForTests();
  useAppStore.setState({
    activeTabId: "/vault/other.md",
    settings: { ...defaultSettings },
    viewMode: ViewMode.PREVIEW,
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  __resetPreviewNavigationBridgeForTests();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function setup(content: string, select?: () => Promise<void>) {
  const onFileSelect = vi.fn(
    select ??
      (async () => {
        useAppStore.setState({
          activeTabId: file.id,
          currentFilePath: file.path,
          fileContents: { [file.id]: content },
        });
      }),
  );
  const options = {
    files: [file],
    fileContents: { [file.id]: content },
    readFile: vi.fn(async () => content),
  };
  const deps = { onFileSelect, onClose: vi.fn() };
  const { result } = renderHook(() => useSidebarSearch(options, deps));
  return { result, onFileSelect };
}

describe("sidebar result navigation", () => {
  it.each(["vault", "document"])(
    "drops a delayed open after switching %s",
    async (context) => {
      useAppStore.setState({
        viewMode: ViewMode.LIVE,
        rootFolderPath: "/vault",
      });
      let finish!: () => void;
      const { result } = setup("source", () => {
        useAppStore.setState({
          activeTabId: file.id,
          fileContents: { [file.id]: "source" },
        });
        return new Promise<void>((resolve) => (finish = resolve));
      });
      let selecting!: Promise<void>;
      act(() => {
        selecting = result.current.handleSearchResultSelect(file, {
          line: 1,
          start: 0,
          end: 6,
          text: "source",
        });
      });
      await act(async () => {
        useAppStore.setState(
          context === "vault"
            ? { rootFolderPath: "/other-vault" }
            : { activeTabId: "/vault/other.md" },
        );
        finish();
        await selecting;
      });
      expect(editorFocus).not.toHaveBeenCalled();
    },
  );

  it("queues the nearest preceding reading heading until its preview registers", async () => {
    const { result } = setup(
      "# Intro\n\n## Target\nA matching paragraph\n\n## Later",
    );
    await act(async () => {
      await result.current.handleSearchResultSelect(file, {
        line: 4,
        start: 20,
        end: 40,
        text: "A matching paragraph",
      });
    });
    const pane = document.createElement("div");
    pane.innerHTML =
      '<article class="markdown-body"><h2 id="target">Target</h2></article>';
    document.body.appendChild(pane);
    Object.defineProperties(pane, {
      clientHeight: { value: 400 },
      scrollHeight: { value: 3000 },
    });
    pane.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    pane.querySelector("h2")!.getBoundingClientRect = () =>
      ({ top: 1600, height: 40 }) as DOMRect;
    const scrollTo = vi.fn();
    pane.scrollTo = scrollTo;
    registerPreviewPane(file.id, pane);
    expect(flushPendingPreviewHeadingScroll(file.id)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1480, behavior: "auto" });
    expect(editorFocus).not.toHaveBeenCalled();
  });

  it("opens a headingless reading result without focusing the hidden editor", async () => {
    const { result, onFileSelect } = setup("A plain matching paragraph");
    await act(async () => {
      await result.current.handleSearchResultSelect(file, {
        line: 1,
        start: 0,
        end: 20,
        text: "A plain matching paragraph",
      });
    });
    expect(onFileSelect).toHaveBeenCalledOnce();
    expect(editorFocus).not.toHaveBeenCalled();
    expect(flushPendingPreviewHeadingScroll(file.id)).toBe(false);
  });

  it("preserves exact editor selection outside reading mode", async () => {
    useAppStore.setState({ viewMode: ViewMode.LIVE });
    const { result } = setup("A matching paragraph");
    await act(async () => {
      await result.current.handleSearchResultSelect(file, {
        line: 1,
        start: 2,
        end: 10,
        text: "matching",
      });
    });
    expect(editorFocus).toHaveBeenCalledWith(file.id, 2, 10, {
      alignTopRatio: 0.3,
    });
    expect(flushPendingPreviewHeadingScroll(file.id)).toBe(false);
  });
});
