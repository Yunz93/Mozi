/** @vitest-environment happy-dom */

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";

const { listenMock, destroyMock, exitMock, flushAllDirtyMock } = vi.hoisted(
  () => ({
    listenMock: vi.fn(),
    destroyMock: vi.fn(async () => {}),
    exitMock: vi.fn(async () => {}),
    flushAllDirtyMock: vi.fn(async () => true),
  }),
);

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: destroyMock,
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: exitMock,
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

import { useCloseGuard } from "./useCloseGuard";

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
    exitMock.mockClear();
    flushAllDirtyMock.mockClear();
    flushAllDirtyMock.mockResolvedValue(true);
    useAppStore.setState({
      openTabs: [NOTE_ID],
      activeTabId: NOTE_ID,
      fileContents: { [NOTE_ID]: "edited" },
      lastSavedContent: { [NOTE_ID]: "saved" },
      settings: defaultSettings,
    });
  });

  afterEach(() => {
    useAppStore.setState({
      openTabs: [],
      activeTabId: null,
      fileContents: {},
      lastSavedContent: {},
      settings: defaultSettings,
    });
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

  it("does not destroy when forceSave fails and shows a notification", async () => {
    const forceSave = vi.fn(async () => false);
    const showNotification = vi.fn();
    useAppStore.setState({ showNotification });

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
});
