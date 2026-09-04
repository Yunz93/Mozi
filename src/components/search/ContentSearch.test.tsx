/** @vitest-environment happy-dom */

import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import {
  ContentSearch,
  findClosestMatchIndex,
  findContentSearchMatches,
  MAX_MATCHES,
} from "./ContentSearch";
import {
  clearActiveEditorView,
  registerActiveEditorView,
} from "../../utils/editorSelectionBridge";
import { defaultSettings, useAppStore } from "../../store/appStore";
import { ViewMode } from "../../types";

describe("findContentSearchMatches", () => {
  it("finds matches without computing line/column", () => {
    const { matches, truncated } = findContentSearchMatches(
      "foo bar foo",
      "foo",
      { caseSensitive: false, useRegex: false, wholeWord: false },
    );
    expect(truncated).toBe(false);
    expect(matches).toEqual([
      { index: 0, length: 3 },
      { index: 8, length: 3 },
    ]);
  });

  it("finds 5000 matches in a 1MB document within 300ms", () => {
    const needle = "MATCHTOK";
    const padding = "x".repeat(200);
    const chunk = `${needle}${padding}`;
    const repeats = 5000;
    const content = chunk.repeat(repeats);
    expect(content.length).toBeGreaterThan(1_000_000);

    const started = performance.now();
    const { matches, truncated } = findContentSearchMatches(content, needle, {
      caseSensitive: true,
      useRegex: false,
      wholeWord: false,
    });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(300);
    expect(matches.length).toBe(MAX_MATCHES);
    expect(truncated).toBe(true);
  });
});

describe("findClosestMatchIndex", () => {
  it("keeps the nearest match after content changes", () => {
    const matches = [
      { index: 10, length: 3 },
      { index: 80, length: 3 },
      { index: 200, length: 3 },
    ];
    expect(findClosestMatchIndex(matches, 78)).toBe(1);
    expect(findClosestMatchIndex(matches, 0)).toBe(0);
  });
});

describe("ContentSearch replace history", () => {
  beforeEach(() => {
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
      fileContents: { "/vault/a.md": "hello world hello" },
      lastSavedContent: { "/vault/a.md": "hello world hello" },
      settings: { ...defaultSettings },
      viewMode: ViewMode.LIVE,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("puts replace into CodeMirror history so undo restores the original text", async () => {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({
        doc: "hello world hello",
        extensions: [history()],
      }),
    });
    registerActiveEditorView(view, "/vault/a.md");

    const { getByPlaceholderText, getByText } = render(
      <ContentSearch onClose={() => undefined} />,
    );

    fireEvent.change(getByPlaceholderText(/搜索|Search/i), {
      target: { value: "hello" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    fireEvent.click(getByText(/替换|Replace/i));
    const replaceInput = document.querySelector(
      'input[placeholder*="替换"], input[placeholder*="Replace"]',
    ) as HTMLInputElement | null;
    expect(replaceInput).toBeTruthy();
    fireEvent.change(replaceInput!, { target: { value: "hi" } });
    const replaceCurrent = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        /替换|Replace/.test(button.textContent ?? "") &&
        button.getAttribute("aria-pressed") == null &&
        !(button as HTMLButtonElement).disabled,
    );
    expect(replaceCurrent).toBeTruthy();
    fireEvent.click(replaceCurrent!);

    expect(view.state.doc.toString()).toBe("hi world hello");
    undo(view);
    expect(view.state.doc.toString()).toBe("hello world hello");

    clearActiveEditorView(view);
    view.destroy();
  });
});
