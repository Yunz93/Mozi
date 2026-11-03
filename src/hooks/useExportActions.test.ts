/** @vitest-environment happy-dom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import { getExportInFlight, useExportActions } from "./useExportActions";
import { registerActiveEditorFlush } from "../utils/editorSelectionBridge";

const { exportToHtml, exportToPdf, showNotification } = vi.hoisted(() => ({
  exportToHtml: vi.fn(async () => "<html></html>"),
  exportToPdf: vi.fn<() => Promise<string | null>>(async () => null),
  showNotification: vi.fn(),
}));

vi.mock("../utils/export", () => ({
  exportToHtml,
  downloadHtml: vi.fn(),
  exportToPdf,
}));

describe("useExportActions re-entrancy", () => {
  beforeEach(() => {
    showNotification.mockClear();
    exportToHtml.mockClear();
    exportToPdf.mockReset().mockResolvedValue(null);
    useAppStore.setState({
      files: [
        {
          id: "/vault/a.md",
          name: "a.md",
          type: "file",
          path: "/vault/a.md",
        },
      ],
      openTabs: ["/vault/a.md"],
      activeTabId: "/vault/a.md",
      currentFilePath: "/vault/a.md",
      fileContents: { "/vault/a.md": "# hi" },
      lastSavedContent: { "/vault/a.md": "# hi" },
      settings: { ...defaultSettings },
      showNotification,
    });
  });

  afterEach(() => {
    cleanup();
    registerActiveEditorFlush(null);
    vi.restoreAllMocks();
  });

  it("blocks a second export while one is in flight and exposes isExporting", async () => {
    let finishExport!: (path: string | null) => void;
    exportToPdf.mockImplementationOnce(
      () => new Promise((resolve) => (finishExport = resolve)),
    );
    const { result } = renderHook(() => useExportActions(null));
    expect(result.current.isExporting).toBe(false);
    expect(getExportInFlight()).toBe(false);

    let firstExport!: Promise<void>;
    act(() => {
      firstExport = result.current.handleExportToPdf();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getExportInFlight()).toBe(true);
    expect(result.current.isExporting).toBe(true);

    await act(async () => {
      await result.current.handleExportToPdf();
    });

    expect(showNotification).toHaveBeenCalled();
    const message = String(showNotification.mock.calls.at(-1)?.[0] ?? "");
    expect(message).toMatch(/导出|Exporting/i);
    await act(async () => {
      finishExport(null);
      await firstExport;
    });
    expect(getExportInFlight()).toBe(false);
  });

  it.each([
    "handleExportToPdf",
    "handleExportToHtml",
    "buildLongImageSharePayload",
  ] as const)(
    "%s captures pending input and current settings before exporting",
    async (action) => {
      const { result } = renderHook(() => useExportActions(null));
      const latestContent = "# hi\nlatest input still in the editor";
      const flush = vi.fn(() => {
        useAppStore.setState((state) => ({
          fileContents: { ...state.fileContents, "/vault/a.md": latestContent },
          settings: { ...state.settings, themeMode: "dark", fontSize: 19 },
        }));
      });
      registerActiveEditorFlush(flush);

      await act(async () => {
        await result.current[action]();
      });

      expect(flush).toHaveBeenCalledOnce();
      expect(exportToHtml).toHaveBeenCalledWith(
        latestContent,
        expect.objectContaining({
          theme: "dark",
          fontSize: 19,
          fontSettings: expect.objectContaining({
            themeMode: "dark",
            fontSize: 19,
          }),
        }),
      );
    },
  );
});
