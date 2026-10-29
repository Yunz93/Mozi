/** @vitest-environment happy-dom */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeReadImportDialog } from "./WeReadImportDialog";

afterEach(() => {
  cleanup();
});

describe("WeReadImportDialog", () => {
  it("defaults to merge and lists notebooks", async () => {
    render(
      <WeReadImportDialog
        isOpen
        isImporting={false}
        defaultSaveCover
        defaultIncludeHotHighlights={false}
        onClose={() => undefined}
        onLoadNotebooks={vi.fn(async () => [
          {
            bookId: "123",
            book: { title: "三体", author: "刘慈欣" },
            noteCount: 4,
            reviewCount: 2,
            bookmarkCount: 1,
          },
        ])}
        onSearchStore={vi.fn(async () => [])}
        onImport={vi.fn(async () => [])}
      />,
    );

    expect(await screen.findByText("三体")).toBeTruthy();
    expect((screen.getByLabelText(/合并/) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.queryByLabelText(/下载封面/)).toBeNull();
    expect(screen.queryByLabelText(/热门划线/)).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    "imports with the saved settings (%s, %s)",
    async (saveCover, includeHotHighlights) => {
      const notebook = { bookId: "123", book: { title: "三体" } };
      const onImport = vi.fn(async () => []);
      render(
        <WeReadImportDialog
          isOpen
          isImporting={false}
          defaultSaveCover={saveCover}
          defaultIncludeHotHighlights={includeHotHighlights}
          onClose={vi.fn()}
          onLoadNotebooks={vi.fn(async () => [notebook])}
          onSearchStore={vi.fn(async () => [])}
          onImport={onImport}
        />,
      );
      await screen.findByText("三体");
      fireEvent.click(screen.getByRole("button", { name: "导入 1 本" }));
      await waitFor(() =>
        expect(onImport).toHaveBeenCalledWith({
          notebooks: [notebook],
          conflictMode: "merge",
          saveCover,
          includeHotHighlights,
        }),
      );
    },
  );

  it("uses updated settings without resetting the selected book or conflict mode", async () => {
    const notebook = { bookId: "123", book: { title: "三体" } };
    const onImport = vi.fn(async () => []);
    const onLoadNotebooks = vi.fn(async () => [notebook]);
    const props = {
      isOpen: true,
      isImporting: false,
      defaultSaveCover: true,
      defaultIncludeHotHighlights: false,
      onClose: vi.fn(),
      onLoadNotebooks,
      onSearchStore: vi.fn(async () => []),
      onImport,
    };
    const { rerender } = render(<WeReadImportDialog {...props} />);
    await screen.findByText("三体");
    fireEvent.click(screen.getByLabelText("跳过"));
    rerender(
      <WeReadImportDialog
        {...props}
        defaultSaveCover={false}
        defaultIncludeHotHighlights
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "导入 1 本" }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith({
        notebooks: [notebook],
        conflictMode: "skip",
        saveCover: false,
        includeHotHighlights: true,
      }),
    );
    expect(onLoadNotebooks).toHaveBeenCalledTimes(1);
  });
});
