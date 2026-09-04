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

    unmount();
    resolveListen?.(unlisten);

    await waitFor(() => {
      expect(unlisten).toHaveBeenCalled();
    });
  });
});
