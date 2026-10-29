/** @vitest-environment happy-dom */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";

const {
  listenMock,
  destroyMock,
  exitMock,
  flushAllDirtyMock,
  invokeMock,
  updateLockMock,
  updateListenMock,
  beginShutdownMock,
  releaseShutdownMock,
} = vi.hoisted(() => ({
  listenMock: vi.fn(),
  updateLockMock: vi.fn(() => false),
  updateListenMock: vi.fn(async () => vi.fn()),
  beginShutdownMock: vi.fn(),
  releaseShutdownMock: vi.fn(async () => {}),
  destroyMock: vi.fn(async () => {}),
  exitMock: vi.fn(async () => {}),
  flushAllDirtyMock: vi.fn(async () => true),
  invokeMock: vi.fn(async (_cmd?: string) => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: destroyMock,
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: exitMock,
}));

vi.mock("../services/updateDocumentGuard", () => ({
  isUpdateInstallLocked: updateLockMock,
  listenForUpdateSaveRequests: updateListenMock,
  beginDocumentShutdown: beginShutdownMock,
}));

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: () => true,
}));

vi.mock("../services/filesystem/flushActiveDocument", () => ({
  flushAllDirtyOpenTabs: () => flushAllDirtyMock(),
}));

vi.mock("../utils/editorSelectionBridge", () => ({
  flushActiveEditorPendingChanges: vi.fn(),
}));

import {
  completeAppClose,
  completeAppCloseAfterDiscard,
  useCloseGuard,
} from "./useCloseGuard";

const NOTE_ID = "/vault/note.md";

function Harness({
  forceSave,
}: {
  forceSave: (
    content?: string,
    options?: { trigger?: "auto" | "manual" | "system" },
  ) => Promise<boolean>;
}) {
  useCloseGuard(forceSave);
  return null;
}

describe("useCloseGuard", () => {
  let closeListener: ((event: { payload?: unknown }) => void) | null = null;

  beforeEach(() => {
    closeListener = null;
    releaseShutdownMock.mockReset().mockResolvedValue(undefined);
    beginShutdownMock.mockReset().mockResolvedValue(releaseShutdownMock);
    updateLockMock.mockReset().mockReturnValue(false);
    updateListenMock.mockReset().mockResolvedValue(vi.fn());
    listenMock.mockImplementation(
      async (
        _event: string,
        handler: (event: { payload?: unknown }) => void,
      ) => {
        closeListener = handler;
        return vi.fn();
      },
    );
    destroyMock.mockClear();
    destroyMock.mockResolvedValue(undefined);
    exitMock.mockClear();
    exitMock.mockResolvedValue(undefined);
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
    flushAllDirtyMock.mockClear();
    flushAllDirtyMock.mockResolvedValue(true);
    useAppStore.setState({
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      fileContents: { [NOTE_ID]: "edited" },
      lastSavedContent: { [NOTE_ID]: "saved" },
      settings: defaultSettings,
      pendingCloseDespiteSaveFailure: null,
    });
  });

  afterEach(() => {
    useAppStore.setState({
      openTabs: [],
      activeTabId: null,
      fileContents: {},
      lastSavedContent: {},
      settings: defaultSettings,
      pendingCloseDespiteSaveFailure: null,
    });
  });

  it("destroys the window after the user discards unsaved changes", async () => {
    await completeAppClose("window");
    expect(invokeMock).not.toHaveBeenCalledWith("allow_next_window_close");
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(exitMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("force_close_window");
  });

  it("exits the process when the close source is exit", async () => {
    await completeAppClose("exit");
    expect(invokeMock).not.toHaveBeenCalledWith("allow_next_window_close");
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("force-closes via rust when javascript destroy is denied", async () => {
    destroyMock.mockRejectedValueOnce(new Error("destroy not allowed"));
    await completeAppClose("window");
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("force_close_window");
    expect(exitMock).not.toHaveBeenCalled();
  });

  it("keeps other windows running when rust force-close also fails", async () => {
    destroyMock.mockRejectedValueOnce(new Error("destroy not allowed"));
    invokeMock.mockImplementation(async (cmd?: string) => {
      if (cmd === "force_close_window") {
        throw new Error("force close failed");
      }
    });
    await expect(completeAppClose("window")).rejects.toThrow(
      "force close failed",
    );
    expect(exitMock).not.toHaveBeenCalled();
  });

  it("force-exits via rust when javascript exit is denied", async () => {
    exitMock.mockRejectedValueOnce(new Error("exit not allowed"));
    await completeAppClose("exit");
    expect(invokeMock).toHaveBeenCalledWith("force_exit_app");
  });

  it("force-saves dirty tabs then destroys the window", async () => {
    const forceSave = vi.fn(async () => true);
    render(<Harness forceSave={forceSave} />);

    await waitFor(() => {
      expect(closeListener).not.toBeNull();
    });

    await act(async () => {
      closeListener?.({ payload: "window" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(forceSave).toHaveBeenCalledWith(undefined, { trigger: "system" });
      expect(destroyMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does not destroy when forceSave fails and asks to discard and close", async () => {
    const forceSave = vi.fn(async () => false);
    const showNotification = vi.fn();
    useAppStore.setState({
      showNotification,
      pendingCloseDespiteSaveFailure: null,
    });

    render(<Harness forceSave={forceSave} />);
    await waitFor(() => {
      expect(closeListener).not.toBeNull();
    });

    await act(async () => {
      closeListener?.({ payload: "window" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalled();
    });
    expect(destroyMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingCloseDespiteSaveFailure).toBe(
      "window",
    );
  });

  it("closes without saving when the only difference is CRLF vs LF", async () => {
    useAppStore.setState({
      fileContents: { [NOTE_ID]: "# Title\n\nBody\n" },
      lastSavedContent: { [NOTE_ID]: "# Title\r\n\r\nBody\r\n" },
    });
    const forceSave = vi.fn(async () => false);

    render(<Harness forceSave={forceSave} />);
    await waitFor(() => {
      expect(closeListener).not.toBeNull();
    });

    await act(async () => {
      closeListener?.({ payload: "window" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(destroyMock).toHaveBeenCalledTimes(1);
    });
    expect(forceSave).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingCloseDespiteSaveFailure).toBeNull();
  });

  it("destroys immediately when there are no dirty tabs", async () => {
    useAppStore.setState({
      fileContents: { [NOTE_ID]: "saved" },
      lastSavedContent: { [NOTE_ID]: "saved" },
    });
    const forceSave = vi.fn(async () => true);

    render(<Harness forceSave={forceSave} />);
    await waitFor(() => {
      expect(closeListener).not.toBeNull();
    });

    await act(async () => {
      closeListener?.({ payload: "window" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(destroyMock).toHaveBeenCalledTimes(1);
    });
    expect(forceSave).not.toHaveBeenCalled();
  });
  it("waits for a pending write even when undo made the tab look clean", async () => {
    useAppStore.setState({
      fileContents: { [NOTE_ID]: "saved" },
      lastSavedContent: { [NOTE_ID]: "saved" },
    });
    let finishWrite!: (value: boolean) => void;
    flushAllDirtyMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishWrite = resolve;
        }),
    );
    render(<Harness forceSave={vi.fn(async () => true)} />);
    await waitFor(() => expect(closeListener).not.toBeNull());
    await act(async () => {
      closeListener?.({ payload: "window" });
      await Promise.resolve();
    });
    expect(flushAllDirtyMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).not.toHaveBeenCalled();
    await act(async () => {
      finishWrite(true);
    });
    await waitFor(() => expect(destroyMock).toHaveBeenCalledTimes(1));
  });
  it("keeps ordinary close protection when update listener registration fails", async () => {
    updateListenMock.mockRejectedValueOnce(new Error("listener unavailable"));
    render(<Harness forceSave={vi.fn(async () => true)} />);
    await waitFor(() => expect(closeListener).not.toBeNull());
    await act(async () => {
      closeListener?.({ payload: "window" });
    });
    await waitFor(() => expect(destroyMock).toHaveBeenCalledTimes(1));
  });

  it("does not exit while another window coordinates an update installation", async () => {
    updateLockMock.mockReturnValue(true);
    const forceSave = vi.fn(async () => true);
    render(<Harness forceSave={forceSave} />);
    await waitFor(() => expect(closeListener).not.toBeNull());
    await act(async () => {
      closeListener?.({ payload: "exit" });
    });
    expect(forceSave).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("keeps a seemingly clean window open if its queued write cannot finish saving", async () => {
    useAppStore.setState({
      fileContents: { [NOTE_ID]: "saved" },
      lastSavedContent: { [NOTE_ID]: "saved" },
    });
    flushAllDirtyMock.mockResolvedValueOnce(false);
    render(<Harness forceSave={vi.fn(async () => true)} />);
    await waitFor(() => expect(closeListener).not.toBeNull());
    await act(async () => {
      closeListener?.({ payload: "window" });
    });
    await waitFor(() =>
      expect(useAppStore.getState().pendingCloseDespiteSaveFailure).toBe(
        "window",
      ),
    );
    expect(destroyMock).not.toHaveBeenCalled();
  });
  it("waits for every window to save before a coordinated application exit", async () => {
    let saved!: (release: () => Promise<void>) => void;
    beginShutdownMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          saved = resolve;
        }),
    );
    render(<Harness forceSave={vi.fn(async () => true)} />);
    await waitFor(() => expect(closeListener).not.toBeNull());
    await act(async () => {
      closeListener?.({ payload: "exit" });
    });
    expect(beginShutdownMock).toHaveBeenCalledWith("exit");
    expect(exitMock).not.toHaveBeenCalled();
    await act(async () => {
      saved(releaseShutdownMock);
    });
    await waitFor(() => expect(exitMock).toHaveBeenCalledWith(0));
    expect(releaseShutdownMock).toHaveBeenCalledTimes(1);
  });

  it("cancels application exit when a different window cannot save", async () => {
    beginShutdownMock.mockRejectedValueOnce(
      new Error("another window could not save"),
    );
    render(<Harness forceSave={vi.fn(async () => true)} />);
    await waitFor(() => expect(closeListener).not.toBeNull());
    await act(async () => {
      closeListener?.({ payload: "exit" });
    });
    await waitFor(() =>
      expect(useAppStore.getState().pendingCloseDespiteSaveFailure).toBe(
        "exit",
      ),
    );
    expect(exitMock).not.toHaveBeenCalled();
  });

  it("never arms a shared bypass when destroying A before closing B", async () => {
    await completeAppClose("window");
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("allow_next_window_close");
    const forceSave = vi.fn(async () => true);
    render(<Harness forceSave={forceSave} />);
    await waitFor(() => expect(closeListener).not.toBeNull());
    await act(async () => {
      closeListener?.({ payload: "window" });
    });
    await waitFor(() => expect(destroyMock).toHaveBeenCalledTimes(2));
    expect(forceSave).toHaveBeenCalledWith(undefined, { trigger: "system" });
    expect(invokeMock).not.toHaveBeenCalledWith("allow_next_window_close");
  });
  it("backs up every window before the user-confirmed discard exits the application", async () => {
    let backedUp!: (release: () => Promise<void>) => void;
    beginShutdownMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          backedUp = resolve;
        }),
    );
    const running = completeAppCloseAfterDiscard("exit");
    await Promise.resolve();
    expect(beginShutdownMock).toHaveBeenCalledWith("exit", {
      backupOnly: true,
    });
    expect(exitMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("force_exit_app");
    backedUp(releaseShutdownMock);
    await running;
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(releaseShutdownMock).toHaveBeenCalledTimes(1);
  });

  it("keeps all windows open when confirmed discard cannot back up another window", async () => {
    beginShutdownMock.mockRejectedValueOnce(new Error("backup failed"));
    await expect(completeAppCloseAfterDiscard("exit")).rejects.toThrow(
      "backup failed",
    );
    expect(exitMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("force_exit_app");
  });

  it("preserves the existing single-window discard close path", async () => {
    await completeAppCloseAfterDiscard("window");
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(beginShutdownMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });
});
