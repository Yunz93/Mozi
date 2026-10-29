// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { registerActiveEditorFlush } from "../../utils/editorSelectionBridge";
import { flushActiveDocumentIfDirty } from "./flushActiveDocument";

const { writeFile } = vi.hoisted(() => ({
  writeFile: vi.fn(async (_path: string, _content: string) => {}),
}));
vi.mock("../../types/filesystem", () => ({
  getFileSystem: async () => ({ writeFile }),
  isTauriEnvironment: () => false,
}));

const tabId = "/vault/drawing.excalidraw";

describe("flushActiveDocumentIfDirty pending drawing changes", () => {
  beforeEach(() => {
    writeFile.mockReset();
    writeFile.mockResolvedValue(undefined);
    useAppStore.setState({
      files: [
        { id: tabId, path: tabId, name: "drawing.excalidraw", type: "file" },
      ],
      openTabs: [tabId],
      activeTabId: tabId,
      currentFilePath: tabId,
      fileContents: { [tabId]: "original" },
      lastSavedContent: { [tabId]: "original" },
      settings: { ...defaultSettings },
    });
  });
  afterEach(() => registerActiveEditorFlush(null));

  it("persists strokes created while the first disk write is pending before allowing a switch", async () => {
    let finishFirstWrite!: () => void;
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirstWrite = resolve;
        }),
    );
    let pending: string | null = "scene-a";
    registerActiveEditorFlush(() => {
      if (pending !== null) {
        useAppStore.getState().setContentForFile(tabId, pending);
        pending = null;
      }
    });
    const flushed = flushActiveDocumentIfDirty();
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(tabId, "scene-a"),
    );
    pending = "scene-b";
    finishFirstWrite();

    expect(await flushed).toBe(true);
    expect(writeFile.mock.calls.map(([, content]) => content)).toEqual([
      "scene-a",
      "scene-b",
    ]);
    expect(useAppStore.getState().fileContents[tabId]).toBe("scene-b");
    expect(useAppStore.getState().hasUnsavedChanges(tabId)).toBe(false);
  });

  it("blocks a switch when saving the additional strokes fails", async () => {
    let finishFirstWrite!: () => void;
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirstWrite = resolve;
        }),
    );
    writeFile.mockRejectedValueOnce(new Error("disk full"));
    let pending = "scene-a";
    registerActiveEditorFlush(() =>
      useAppStore.getState().setContentForFile(tabId, pending),
    );
    const flushed = flushActiveDocumentIfDirty();
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    pending = "scene-b";
    finishFirstWrite();

    expect(await flushed).toBe(false);
    expect(useAppStore.getState().fileContents[tabId]).toBe("scene-b");
    expect(useAppStore.getState().hasUnsavedChanges(tabId)).toBe(true);
  });
});
