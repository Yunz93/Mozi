import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listeners: new Map<
    string,
    (event: { payload: Record<string, unknown> }) => void
  >(),
  emit: vi.fn(),
  windows: vi.fn(),
  flush: vi.fn(),
  invoke: vi.fn(),
  backup: vi.fn(),
  editorFlush: vi.fn(),
  openTabs: [] as string[],
  contents: {} as Record<string, string>,
  dirty: new Set<string>(),
}));
vi.mock("../utils/draftBackup", () => ({ writeDraftBackup: mocks.backup }));
vi.mock("../utils/editorSelectionBridge", () => ({
  flushActiveEditorPendingChanges: mocks.editorFlush,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mocks.emit,
  listen: vi.fn(
    async (
      name: string,
      handler: (event: { payload: Record<string, unknown> }) => void,
    ) => {
      mocks.listeners.set(name, handler);
      return () => {
        if (mocks.listeners.get(name) === handler) mocks.listeners.delete(name);
      };
    },
  ),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
  getAllWindows: mocks.windows,
}));
vi.mock("./filesystem/flushActiveDocument", () => ({
  flushAllDirtyOpenTabs: mocks.flush,
}));
vi.mock("../store/appStore", () => ({
  useAppStore: {
    getState: () => ({
      settings: { language: "zh-CN" },
      files: [],
      openTabs: mocks.openTabs,
      fileContents: mocks.contents,
      hasUnsavedChanges: (id: string) => mocks.dirty.has(id),
    }),
  },
}));

let guard: typeof import("./updateDocumentGuard");
let release: (() => Promise<void>) | undefined;
function acknowledge(
  label: string,
  payload: Record<string, unknown>,
  saved: boolean,
) {
  mocks.listeners.get("update-save-result")?.({
    payload: { requestId: payload.requestId, label, saved },
  });
}

beforeEach(async () => {
  vi.resetModules();
  mocks.listeners.clear();
  mocks.backup.mockReset().mockReturnValue(true);
  mocks.editorFlush.mockReset();
  mocks.openTabs = [];
  mocks.contents = {};
  mocks.dirty = new Set();
  mocks.flush.mockReset().mockResolvedValue(true);
  mocks.windows
    .mockReset()
    .mockResolvedValue([{ label: "main" }, { label: "file-1" }]);
  mocks.emit
    .mockReset()
    .mockImplementation(
      async (label: string, name: string, payload: Record<string, unknown>) => {
        if (name === "update-save-request") acknowledge(label, payload, true);
      },
    );
  guard = await import("./updateDocumentGuard");
  guard.registerUpdateInstallBlocker(() => true);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  release = undefined;
});
afterEach(async () => {
  await release?.();
  vi.useRealTimers();
});

describe("update saves across windows", () => {
  it("locks the initiating window and waits for every other window acknowledgement", async () => {
    let request: Record<string, unknown> | undefined;
    mocks.emit.mockImplementation(async (_label, name, payload) => {
      if (name === "update-save-request") request = payload;
    });
    const running = guard.beginUpdateInstall();
    await vi.waitFor(() => expect(request).toBeDefined());
    expect(guard.isUpdateInstallLocked()).toBe(true);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    acknowledge("file-1", request!, true);
    release = await running;
    expect(guard.isUpdateInstallLocked()).toBe(true);
    await release();
    expect(guard.isUpdateInstallLocked()).toBe(false);
    expect(mocks.emit).toHaveBeenCalledWith("file-1", "update-save-release", {
      requestId: request!.requestId,
    });
  });

  it("releases every participant when another window cannot save", async () => {
    mocks.emit.mockImplementation(async (label, name, payload) => {
      if (name === "update-save-request") acknowledge(label, payload, false);
    });
    await expect(guard.beginUpdateInstall()).rejects.toThrow("保存失败");
    expect(guard.isUpdateInstallLocked()).toBe(false);
    expect(mocks.emit).toHaveBeenCalledWith(
      "file-1",
      "update-save-release",
      expect.any(Object),
    );
  });

  it("includes a window opened while acknowledgements are pending", async () => {
    mocks.windows
      .mockResolvedValueOnce([{ label: "main" }, { label: "file-1" }])
      .mockResolvedValue([
        { label: "main" },
        { label: "file-1" },
        { label: "file-2" },
      ]);
    release = await guard.beginUpdateInstall();
    expect(mocks.emit).toHaveBeenCalledWith(
      "file-2",
      "update-save-request",
      expect.any(Object),
    );
  });

  it("does not wait forever for a window that has already closed", async () => {
    mocks.windows
      .mockResolvedValueOnce([{ label: "main" }, { label: "file-1" }])
      .mockResolvedValue([{ label: "main" }]);
    mocks.emit.mockResolvedValue(undefined);
    release = await guard.beginUpdateInstall();
    expect(guard.isUpdateInstallLocked()).toBe(true);
  });

  it("blocks installation and unlocks after a live window stops responding", async () => {
    vi.useFakeTimers();
    mocks.emit.mockResolvedValue(undefined);
    const assertion = expect(guard.beginUpdateInstall()).rejects.toThrow(
      "保存失败",
    );
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    expect(guard.isUpdateInstallLocked()).toBe(false);
    expect(mocks.emit).toHaveBeenCalledWith(
      "file-1",
      "update-save-release",
      expect.any(Object),
    );
  });

  it("also times out when a local write never settles", async () => {
    vi.useFakeTimers();
    mocks.flush.mockImplementation(() => new Promise(() => {}));
    const assertion = expect(guard.beginUpdateInstall()).rejects.toThrow(
      "保存失败",
    );
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    expect(guard.isUpdateInstallLocked()).toBe(false);
  });

  it("ignores responses belonging to an earlier update", async () => {
    let request: Record<string, unknown> | undefined;
    mocks.emit.mockImplementation(async (_label, name, payload) => {
      if (name === "update-save-request") request = payload;
    });
    let completed = false;
    const running = guard.beginUpdateInstall().then((result) => {
      completed = true;
      return result;
    });
    await vi.waitFor(() => expect(request).toBeDefined());
    acknowledge("file-1", { requestId: "stale" }, true);
    await Promise.resolve();
    expect(completed).toBe(false);
    acknowledge("file-1", request!, true);
    release = await running;
  });

  it("remote windows report saved state without exiting and keep the install lock until released", async () => {
    const unlisten = await guard.listenForUpdateSaveRequests();
    mocks.listeners.get("update-save-request")?.({
      payload: { requestId: "request", replyTo: "other" },
    });
    await vi.waitFor(() =>
      expect(mocks.emit).toHaveBeenCalledWith("other", "update-save-result", {
        requestId: "request",
        label: "main",
        saved: true,
      }),
    );
    expect(guard.isUpdateInstallLocked()).toBe(true);
    mocks.listeners.get("update-save-release")?.({
      payload: { requestId: "stale" },
    });
    expect(guard.isUpdateInstallLocked()).toBe(true);
    mocks.listeners.get("update-save-release")?.({
      payload: { requestId: "request" },
    });
    expect(guard.isUpdateInstallLocked()).toBe(false);
    unlisten();
  });

  it("does not allow a second updater to take over an active install lock", async () => {
    release = await guard.beginUpdateInstall();
    await expect(guard.beginUpdateInstall()).rejects.toThrow("保存失败");
    expect(guard.isUpdateInstallLocked()).toBe(true);
  });
  it("refuses installation if the native modal blocker could not activate", async () => {
    guard.registerUpdateInstallBlocker(() => false);
    await expect(guard.beginUpdateInstall()).rejects.toThrow("保存失败");
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("activates native window creation protection before saving and releases it afterwards", async () => {
    mocks.flush.mockImplementation(async () => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "set_update_install_lock",
        expect.objectContaining({ locked: true }),
      );
      return true;
    });
    release = await guard.beginUpdateInstall();
    await release();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "set_update_install_lock",
      expect.objectContaining({ locked: false }),
    );
  });
  it("ordinary application exit uses the same all-window barrier with saving copy", async () => {
    const blocker = vi.fn(() => true);
    guard.registerUpdateInstallBlocker(blocker);
    release = await guard.beginDocumentShutdown("exit");
    expect(blocker).toHaveBeenCalledWith(true, "exit");
    expect(mocks.emit).toHaveBeenCalledWith(
      "file-1",
      "update-save-request",
      expect.objectContaining({ reason: "exit" }),
    );
  });
  it("backs up trailing editor input and every dirty tab before confirmed discard without writing files", async () => {
    mocks.openTabs = ["a", "b", "clean"];
    mocks.contents = {
      a: "before debounce",
      b: "other changes",
      clean: "saved",
    };
    mocks.dirty = new Set(["a", "b"]);
    mocks.editorFlush.mockImplementation(() => {
      mocks.contents.a = "latest keystrokes";
    });
    release = await guard.beginDocumentShutdown("exit", { backupOnly: true });
    expect(mocks.editorFlush).toHaveBeenCalledTimes(1);
    expect(mocks.backup.mock.calls).toEqual([
      ["a", "latest keystrokes"],
      ["b", "other changes"],
    ]);
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(
      "file-1",
      "update-save-request",
      expect.objectContaining({ backupOnly: true }),
    );
    expect(guard.isUpdateInstallLocked()).toBe(true);
  });

  it("does not allow confirmed discard to proceed when local draft storage fails", async () => {
    mocks.openTabs = ["a", "b"];
    mocks.contents = { a: "draft A", b: "draft B" };
    mocks.dirty = new Set(mocks.openTabs);
    mocks.backup.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(
      guard.beginDocumentShutdown("exit", { backupOnly: true }),
    ).rejects.toThrow("保存失败");
    expect(mocks.backup).toHaveBeenCalledTimes(2);
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(guard.isUpdateInstallLocked()).toBe(false);
  });

  it("remote windows acknowledge failed backups instead of silently exiting or writing the original files", async () => {
    mocks.openTabs = ["remote"];
    mocks.contents = { remote: "remote draft" };
    mocks.dirty = new Set(mocks.openTabs);
    mocks.backup.mockReturnValue(false);
    const unlisten = await guard.listenForUpdateSaveRequests();
    mocks.listeners.get("update-save-request")?.({
      payload: {
        requestId: "discard",
        replyTo: "other",
        reason: "exit",
        backupOnly: true,
      },
    });
    await vi.waitFor(() =>
      expect(mocks.emit).toHaveBeenCalledWith("other", "update-save-result", {
        requestId: "discard",
        label: "main",
        saved: false,
      }),
    );
    expect(mocks.editorFlush).toHaveBeenCalledTimes(1);
    expect(mocks.backup).toHaveBeenCalledWith("remote", "remote draft");
    expect(mocks.flush).not.toHaveBeenCalled();
    mocks.listeners.get("update-save-release")?.({
      payload: { requestId: "discard" },
    });
    expect(guard.isUpdateInstallLocked()).toBe(false);
    unlisten();
  });

  it("keeps all windows open and unlocks when a remote draft backup fails", async () => {
    mocks.emit.mockImplementation(async (label, name, payload) => {
      if (name === "update-save-request") acknowledge(label, payload, false);
    });
    await expect(
      guard.beginDocumentShutdown("exit", { backupOnly: true }),
    ).rejects.toThrow("保存失败");
    expect(mocks.emit).toHaveBeenCalledWith(
      "file-1",
      "update-save-request",
      expect.objectContaining({ backupOnly: true }),
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      "file-1",
      "update-save-release",
      expect.any(Object),
    );
    expect(guard.isUpdateInstallLocked()).toBe(false);
  });

  it("also cancels confirmed discard when a live window never acknowledges its backup", async () => {
    vi.useFakeTimers();
    mocks.emit.mockResolvedValue(undefined);
    const assertion = expect(
      guard.beginDocumentShutdown("exit", { backupOnly: true }),
    ).rejects.toThrow("保存失败");
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(guard.isUpdateInstallLocked()).toBe(false);
  });
  it("waits for an older write before creating the final draft backup", async () => {
    mocks.openTabs = ["a"];
    mocks.contents = { a: "new changes" };
    mocks.dirty = new Set(["a"]);
    const { acquireDocumentWrite } =
      await import("./filesystem/documentWriteQueue");
    const releaseWrite = await acquireDocumentWrite("a");
    const running = guard.beginDocumentShutdown("exit", { backupOnly: true });
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "set_update_install_lock",
        expect.objectContaining({ locked: true }),
      ),
    );
    expect(mocks.backup).not.toHaveBeenCalled();
    mocks.contents.a = "latest changes after old write";
    releaseWrite();
    release = await running;
    expect(mocks.backup).toHaveBeenCalledWith(
      "a",
      "latest changes after old write",
    );
    expect(mocks.flush).not.toHaveBeenCalled();
  });
});
