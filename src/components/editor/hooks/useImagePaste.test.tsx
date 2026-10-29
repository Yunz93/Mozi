/** @vitest-environment happy-dom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../../../store/appStore";
import { useImagePaste } from "./useImagePaste";

const mocks = vi.hoisted(() => ({
  uploadImageToHosting: vi.fn(),
  createDirectory: vi.fn(async () => undefined),
}));
vi.mock("../../../services/imageHostingService", () => ({
  isImageHostingEnabled: (settings: typeof defaultSettings) =>
    settings.imageHosting.pasteAction === "upload",
  uploadImageToHosting: mocks.uploadImageToHosting,
}));
vi.mock("../../../types/filesystem", () => ({
  getFileSystem: async () => ({ createDirectory: mocks.createDirectory }),
}));
vi.mock("../../../utils/attachmentResolver", () => ({
  clearAttachmentResolverCache: vi.fn(),
}));
vi.mock("../livePreview/wiki", () => ({
  invalidateLivePreviewWikiCachesForPath: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const views: EditorView[] = [];
function setup() {
  const writeBinaryFile = vi.fn(
    async (_path: string, _data: Uint8Array): Promise<void> => undefined,
  );
  const refreshFileTree = vi.fn(async () => undefined);
  const hook = renderHook(
    ({ path }) =>
      useImagePaste({
        rootFolderPath: "/vault",
        currentFilePath: path,
        writeBinaryFile,
        refreshFileTree,
        showNotification: vi.fn(),
      }),
    { initialProps: { path: "/vault/a.md" } },
  );
  const view = new EditorView({
    state: EditorState.create({
      doc: "prefix original body",
      selection: { anchor: 7 },
    }),
    parent: document.body,
  });
  views.push(view);
  const file = {
    type: "image/png",
    arrayBuffer: async () => new ArrayBuffer(0),
  } as File;
  return { ...hook, view, file, writeBinaryFile };
}

async function startPaste(context: ReturnType<typeof setup>) {
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = context.result.current.handlePastedImage(
      context.file,
      context.view,
    );
    await Promise.resolve();
  });
  return { pending };
}

describe("useImagePaste async document safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      settings: {
        ...defaultSettings,
        imageHosting: {
          ...defaultSettings.imageHosting,
          pasteAction: "upload",
          keepLocalCopy: false,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    for (const view of views.splice(0)) view.destroy();
  });

  it("keeps new text intact when the upload placeholder was deleted", async () => {
    const upload = deferred<{ url: string }>();
    mocks.uploadImageToHosting.mockReturnValue(upload.promise);
    const context = setup();
    const { pending } = await startPaste(context);
    expect(context.view.state.doc.toString()).toContain("Uploading");
    const edited = "prefix newly written important paragraph after cancel";
    context.view.dispatch({
      changes: { from: 0, to: context.view.state.doc.length, insert: edited },
    });
    await act(async () => {
      upload.resolve({ url: "https://example.com/upload.png" });
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe(edited);
  });

  it("replaces only the surviving placeholder after edits before it", async () => {
    const upload = deferred<{ url: string }>();
    mocks.uploadImageToHosting.mockReturnValue(upload.promise);
    const context = setup();
    const { pending } = await startPaste(context);
    context.view.dispatch({ changes: { from: 0, insert: "new " } });
    await act(async () => {
      upload.resolve({ url: "https://example.com/upload.png" });
      await pending;
    });
    expect(context.view.state.doc.toString()).toMatch(
      /^new prefix !\[a-[0-9a-f-]+\]\(https:\/\/example.com\/upload.png\)original body$/,
    );
  });

  it("does not write to another document reusing the same editor", async () => {
    const upload = deferred<{ url: string }>();
    mocks.uploadImageToHosting.mockReturnValue(upload.promise);
    const context = setup();
    const { pending } = await startPaste(context);
    context.rerender({ path: "/vault/b.md" });
    context.view.setState(EditorState.create({ doc: "second note content" }));
    await act(async () => {
      upload.resolve({ url: "https://example.com/upload.png" });
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe("second note content");
  });

  it("does not start uploading after a document switch during file reading", async () => {
    const context = setup();
    const read = deferred<ArrayBuffer>();
    context.file.arrayBuffer = () => read.promise;
    const pending = context.result.current.handlePastedImage(
      context.file,
      context.view,
    );
    context.rerender({ path: "/vault/b.md" });
    context.view.setState(EditorState.create({ doc: "second note content" }));
    await act(async () => {
      read.resolve(new ArrayBuffer(0));
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe("second note content");
    expect(mocks.uploadImageToHosting).not.toHaveBeenCalled();
  });

  it("does not dispatch after the hook has unmounted", async () => {
    const upload = deferred<{ url: string }>();
    mocks.uploadImageToHosting.mockReturnValue(upload.promise);
    const context = setup();
    const { pending } = await startPaste(context);
    const currentDoc = context.view.state.doc.toString();
    context.unmount();
    await act(async () => {
      upload.resolve({ url: "https://example.com/upload.png" });
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe(currentDoc);
  });

  it("does not overwrite a selection in another document after local saving", async () => {
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        imageHosting: { ...defaultSettings.imageHosting, pasteAction: "local" },
      },
    });
    const context = setup();
    const write = deferred<void>();
    context.writeBinaryFile.mockReturnValue(write.promise);
    const { pending } = await startPaste(context);
    context.rerender({ path: "/vault/b.md" });
    context.view.setState(
      EditorState.create({
        doc: "second note content",
        selection: { anchor: 0, head: 6 },
      }),
    );
    await act(async () => {
      write.resolve();
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe("second note content");
  });

  it("does not reinsert a cancelled upload through the local fallback", async () => {
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        imageHosting: {
          ...useAppStore.getState().settings.imageHosting,
          keepLocalCopy: true,
        },
      },
    });
    const upload = deferred<{ url: string }>();
    mocks.uploadImageToHosting.mockReturnValue(upload.promise);
    const context = setup();
    const { pending } = await startPaste(context);
    const edited = "replacement text";
    context.view.dispatch({
      changes: { from: 0, to: context.view.state.doc.length, insert: edited },
    });
    await act(async () => {
      upload.reject(new Error("network failed"));
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe(edited);
    expect(context.writeBinaryFile).not.toHaveBeenCalled();
  });
});

describe("useImagePaste local and fallback targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeTabId: "/vault/a.md",
      settings: {
        ...defaultSettings,
        imageHosting: {
          ...defaultSettings.imageHosting,
          pasteAction: "local",
          keepLocalCopy: true,
        },
      },
    });
  });
  afterEach(() => {
    cleanup();
    for (const view of views.splice(0)) view.destroy();
  });

  it("inserts a locally saved image at the original selection", async () => {
    const context = setup();
    const write = deferred<void>();
    context.writeBinaryFile.mockReturnValue(write.promise);
    const { pending } = await startPaste(context);
    context.view.dispatch({ selection: { anchor: 0, head: 6 } });
    await act(async () => {
      write.resolve();
      await pending;
    });
    expect(context.view.state.doc.toString()).toMatch(
      /^prefix !\[\[resources\/a-[0-9a-f-]+\.png\]\]original body$/,
    );
  });

  it("preserves edits made while a local image is being saved", async () => {
    const context = setup();
    const write = deferred<void>();
    context.writeBinaryFile.mockReturnValue(write.promise);
    const { pending } = await startPaste(context);
    context.view.dispatch({ changes: { from: 7, insert: "new " } });
    await act(async () => {
      write.resolve();
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe("prefix new original body");
  });

  it("uses the surviving upload placeholder for a local fallback", async () => {
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        imageHosting: {
          ...useAppStore.getState().settings.imageHosting,
          pasteAction: "upload",
        },
      },
    });
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const upload = deferred<{ url: string }>();
    mocks.uploadImageToHosting.mockReturnValue(upload.promise);
    const context = setup();
    const { pending } = await startPaste(context);
    context.view.dispatch({ selection: { anchor: 0, head: 6 } });
    await act(async () => {
      upload.reject(new Error("network failed"));
      await pending;
    });
    expect(context.view.state.doc.toString()).toMatch(
      /^prefix !\[\[resources\/a-[0-9a-f-]+\.png\]\]original body$/,
    );
    error.mockRestore();
  });

  it("checks the active tab immediately even before hook rerender", async () => {
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        imageHosting: {
          ...useAppStore.getState().settings.imageHosting,
          pasteAction: "upload",
        },
      },
    });
    const upload = deferred<{ url: string }>();
    mocks.uploadImageToHosting.mockReturnValue(upload.promise);
    const context = setup();
    const { pending } = await startPaste(context);
    useAppStore.setState({ activeTabId: "/vault/b.md" });
    context.view.setState(EditorState.create({ doc: "second note content" }));
    await act(async () => {
      upload.resolve({ url: "https://example.com/upload.png" });
      await pending;
    });
    expect(context.view.state.doc.toString()).toBe("second note content");
  });
});

describe("useImagePaste same-clock requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(123456);
    useAppStore.setState({
      activeTabId: "/vault/a.md",
      rootFolderPath: "/vault",
      settings: {
        ...defaultSettings,
        imageHosting: {
          ...defaultSettings.imageHosting,
          pasteAction: "upload",
          keepLocalCopy: true,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    for (const view of views.splice(0)) view.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps reverse-order uploads attached to their own placeholders and local copies", async () => {
    const first = deferred<{ url: string }>();
    const second = deferred<{ url: string }>();
    mocks.uploadImageToHosting
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const context = setup();
    const firstPaste = await startPaste(context);
    const secondPaste = await startPaste(context);
    await act(async () => {
      second.resolve({ url: "https://example.com/second.png" });
      await secondPaste.pending;
    });
    await act(async () => {
      first.resolve({ url: "https://example.com/first.png" });
      await firstPaste.pending;
    });
    const destinations = [
      ...context.view.state.doc.toString().matchAll(/\]\((https:[^)]+)\)/g),
    ].map((match) => match[1]);
    expect(destinations).toEqual([
      "https://example.com/first.png",
      "https://example.com/second.png",
    ]);
    expect(mocks.uploadImageToHosting).toHaveBeenCalledTimes(2);
    const paths = context.writeBinaryFile.mock.calls.map(([path]) => path);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
  });

  it.each([true, false])(
    "saves same-clock local pastes to distinct resources (randomUUID available: %s)",
    async (hasUUID) => {
      if (!hasUUID) {
        vi.stubGlobal("crypto", {
          getRandomValues: globalThis.crypto.getRandomValues.bind(
            globalThis.crypto,
          ),
        });
      }
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          imageHosting: {
            ...useAppStore.getState().settings.imageHosting,
            pasteAction: "local",
          },
        },
      });
      const context = setup();
      await act(async () => {
        await context.result.current.handlePastedImage(
          context.file,
          context.view,
        );
        await context.result.current.handlePastedImage(
          context.file,
          context.view,
        );
      });
      const paths = context.writeBinaryFile.mock.calls.map(([path]) => path);
      expect(paths).toHaveLength(2);
      expect(new Set(paths).size).toBe(2);
      const references = [
        ...context.view.state.doc.toString().matchAll(/!\[\[([^\]]+)\]\]/g),
      ].map((match) => match[1]);
      expect(references).toHaveLength(2);
      expect(new Set(references).size).toBe(2);
    },
  );
});
