/** @vitest-environment happy-dom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(
      (screen.getByLabelText(/下载封面/) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/热门划线/) as HTMLInputElement).checked,
    ).toBe(false);
  });
});
