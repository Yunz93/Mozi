/** @vitest-environment happy-dom */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WereadNotebook,
  WereadStoreBook,
} from "../../utils/weread/wereadTypes";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const raceBook = (id: string) => ({ bookId: id, book: { title: id } });
const raceProps = () => ({
  isOpen: true,
  isImporting: false,
  defaultSaveCover: false,
  defaultIncludeHotHighlights: false,
  onClose: vi.fn(),
  onLoadNotebooks: vi.fn<() => Promise<WereadNotebook[]>>(async () => []),
  onSearchStore: vi.fn<() => Promise<WereadStoreBook[]>>(async () => []),
  onImport: vi.fn(async () => []),
});

it("ignores stale list results after close and reopen", async () => {
  const old = deferred<WereadNotebook[]>(),
    current = deferred<WereadNotebook[]>();
  const p = {
    ...raceProps(),
    onLoadNotebooks: vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise),
  };
  const view = render(<WeReadImportDialog {...p} />);
  view.rerender(<WeReadImportDialog {...p} isOpen={false} />);
  view.rerender(<WeReadImportDialog {...p} />);
  await act(async () => {
    current.resolve([raceBook("CURRENT")]);
  });
  expect(screen.getByText("CURRENT")).toBeTruthy();
  await act(async () => {
    old.resolve([raceBook("STALE")]);
  });
  expect(screen.queryByText("STALE")).toBeNull();
  expect(screen.getByText("CURRENT")).toBeTruthy();
});
it("ends the search spinner when query is cleared during a pending request", async () => {
  const pending = deferred<WereadStoreBook[]>();
  const p = { ...raceProps(), onSearchStore: vi.fn(() => pending.promise) };
  render(<WeReadImportDialog {...p} />);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "unmatched" } });
  await waitFor(() => expect(p.onSearchStore).toHaveBeenCalled(), {
    timeout: 1500,
  });
  fireEvent.change(input, { target: { value: "" } });
  await act(async () => {
    pending.resolve([]);
  });
  expect(screen.queryByText("正在书城搜索…")).toBeNull();
});
it("imports selected store books even after the search query changes", async () => {
  const p = {
    ...raceProps(),
    onSearchStore: vi
      .fn()
      .mockResolvedValueOnce([{ bookId: "a", title: "Store A" }])
      .mockResolvedValueOnce([{ bookId: "b", title: "Store B" }]),
  };
  render(<WeReadImportDialog {...p} />);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "first" } });
  await screen.findByText("Store A");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(input, { target: { value: "second" } });
  await screen.findByText("Store B");
  const submit = screen.getByRole("button", { name: "导入 1 本" });
  fireEvent.click(submit);
  await act(async () => {});
  expect(p.onImport).toHaveBeenCalledTimes(1);
  expect(p.onImport).toHaveBeenCalledWith(
    expect.objectContaining({
      notebooks: [expect.objectContaining({ bookId: "a" })],
    }),
  );
});
