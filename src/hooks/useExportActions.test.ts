/** @vitest-environment happy-dom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "../store/appStore";
import { getExportInFlight, useExportActions } from "./useExportActions";

const { exportToHtml, exportToPdf, showNotification } = vi.hoisted(() => ({
  exportToHtml: vi.fn(async () => "<html></html>"),
  exportToPdf: vi.fn(
    () =>
      new Promise<string>(() => {
        /* hang so a second export can race */
      }),
  ),
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
    exportToPdf.mockClear();
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
    vi.restoreAllMocks();
  });

  it("blocks a second export while one is in flight and exposes isExporting", async () => {
    const { result } = renderHook(() => useExportActions(null));
    expect(result.current.isExporting).toBe(false);
    expect(getExportInFlight()).toBe(false);

    void act(() => {
      void result.current.handleExportToPdf();
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
  });
});
