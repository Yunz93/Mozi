/** @vitest-environment happy-dom */
import React, { useMemo } from "react";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMarkdownCache } from "../../../utils/markdown";
import * as renderCore from "../preview/previewRenderCore";
import { usePreviewRenderer } from "./usePreviewRenderer";

(globalThis as typeof globalThis & { __PROD__?: boolean }).__PROD__ = false;
const files: import("../../../types").FileNode[] = [];
const buffers: Record<string, string> = {};
const readFile = async () => "";
function Harness({
  content,
  enabled = true,
  path = "/perf/note.md",
  theme = "light",
}: {
  content: string;
  enabled?: boolean;
  path?: string;
  theme?: "light" | "dark";
}) {
  const result = usePreviewRenderer({
    content,
    currentFilePath: path,
    isMarkdownPreview: true,
    isHtmlPreview: false,
    files,
    rootFolderPath: null,
    fileContents: buffers,
    activeTabId: path,
    readFile,
    enabled,
    themeMode: theme,
  });
  const html = useMemo(
    () => ({
      __html: result.requiresAsyncEnhancement
        ? result.enhancedBodyHtml
        : result.parsedContent.bodyHTML,
    }),
    [
      result.requiresAsyncEnhancement,
      result.enhancedBodyHtml,
      result.parsedContent.bodyHTML,
    ],
  );
  return <article data-testid="preview" dangerouslySetInnerHTML={html} />;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => clearMarkdownCache());

describe("preview work while switching modes", () => {
  it("handles an initially inactive pane without a file or tab identity", () => {
    const { result } = renderHook(() =>
      usePreviewRenderer({
        content: "",
        enabled: false,
        isMarkdownPreview: true,
        isHtmlPreview: false,
        files,
        fileContents: buffers,
        readFile,
      }),
    );
    expect(result.current.parsedContent.bodyHTML).toBe("");
  });

  it("retains the current document DOM and skips reparsing an unchanged large document", () => {
    const parse = vi.spyOn(renderCore, "renderMarkdownPreview");
    const content = "# Title\n\n" + "body text ".repeat(12000);
    const pane = render(<Harness content={content} />);
    const heading = screen.getByRole("heading");
    expect(parse).toHaveBeenCalledTimes(1);
    pane.rerender(<Harness content={content} enabled={false} />);
    expect(screen.getByRole("heading")).toBe(heading);
    pane.rerender(<Harness content={content} />);
    expect(screen.getByRole("heading")).toBe(heading);
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it("does no hidden parsing, then displays the latest edit when returning to reading", () => {
    const parse = vi.spyOn(renderCore, "renderMarkdownPreview");
    const pane = render(<Harness content={"# Old\n\noriginal"} />);
    pane.rerender(<Harness content={"# New\n\nlatest body"} enabled={false} />);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("preview").textContent).toContain("original");
    pane.rerender(<Harness content={"# New\n\nlatest body"} />);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading").textContent).toBe("New");
    expect(screen.getByTestId("preview").textContent).toContain("latest body");
  });
  it("does not carry another document into an inactive new pane", () => {
    const pane = render(<Harness content="# Document A" />);
    pane.rerender(
      <Harness content="# Document B" path="/perf/b.md" enabled={false} />,
    );
    expect(screen.getByTestId("preview").innerHTML).toBe("");
    pane.rerender(<Harness content="# Document B" path="/perf/b.md" />);
    expect(screen.getByRole("heading").textContent).toBe("Document B");
  });
  it("invalidates the retained render when its theme changes", () => {
    const parse = vi.spyOn(renderCore, "renderMarkdownPreview");
    const pane = render(<Harness content="# Theme" />);
    pane.rerender(<Harness content="# Theme" enabled={false} theme="dark" />);
    pane.rerender(<Harness content="# Theme" theme="dark" />);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading").textContent).toBe("Theme");
  });
});
