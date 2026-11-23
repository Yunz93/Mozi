/** @vitest-environment happy-dom */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { listenMock, invokeMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeMock: vi.fn(async () => []),
}));

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

vi.mock("../utils/bootOpenFile", () => ({
  takeBootOpenFileQuery: () => ({ paths: [], withVault: false }),
}));

import { useExternalFileOpen } from "./useExternalFileOpen";

function Harness({
  onRuntimePaths,
}: {
  onRuntimePaths: (paths: string[]) => void;
}) {
  useExternalFileOpen({
    settingsHydrated: true,
    onRuntimePaths,
  });
  return null;
}

describe("useExternalFileOpen", () => {
  afterEach(() => {
    listenMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  it("unlistens if the effect is cancelled while listen is pending", async () => {
    const unlisten = vi.fn();
    let resolveListen: ((value: () => void) => void) | undefined;
    listenMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        }),
    );

    const { unmount } = render(<Harness onRuntimePaths={vi.fn()} />);

    await waitFor(() => {
      expect(resolveListen).toEqual(expect.any(Function));
    });
    expect(listenMock).toHaveBeenCalledWith(
      "opened-files",
      expect.any(Function),
      {
        target: { kind: "WebviewWindow", label: "main" },
      },
    );

    unmount();
    resolveListen?.(unlisten);

    await waitFor(() => {
      expect(unlisten).toHaveBeenCalled();
    });
  });
  it("delivers a Windows second-instance file event once with duplicate paths removed", async () => {
    let callback: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(async (_name, listener) => {
      callback = listener;
      return vi.fn();
    });
    const onRuntimePaths = vi.fn();
    const { unmount } = render(<Harness onRuntimePaths={onRuntimePaths} />);
    await waitFor(() => expect(callback).toEqual(expect.any(Function)));
    callback?.({ payload: ["C:\\\\Notes\\\\a.md", "C:\\\\Notes\\\\a.md", "", null] });
    expect(onRuntimePaths).toHaveBeenCalledWith(["C:\\\\Notes\\\\a.md"]);
    unmount();
  });

});
