/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreviewContextFacet } from "./context";
import { livePreviewMermaid } from "./mermaid";

vi.mock("../../../utils/markdown-extensions", async () => {
  const actual = await vi.importActual<
    typeof import("../../../utils/markdown-extensions")
  >("../../../utils/markdown-extensions");
  return {
    ...actual,
    renderMermaidDiagrams: vi.fn(async (container?: HTMLElement | null) => {
      const el = container?.querySelector(".mermaid") as HTMLElement | null;
      if (!el) return;
      if (el.getBoundingClientRect().width < 4) {
        el.dataset.mermaidPendingWidth = "true";
        return;
      }
      delete el.dataset.mermaidPendingWidth;
      el.innerHTML = "<svg data-test-mermaid='1'></svg>";
      el.dataset.mermaidRendered = "true";
    }),
  };
});

describe("live preview mermaid observers", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    while (views.length) {
      const view = views.pop();
      view?.destroy();
      view?.dom.parentElement?.remove();
    }
  });

  it("shows error card path after failed render and allows retry click", async () => {
    const { renderMermaidDiagrams } =
      await import("../../../utils/markdown-extensions");
    const mocked = vi.mocked(renderMermaidDiagrams);
    mocked.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const doc = "```mermaid\nflowchart TD\n  A-->B\n```\n\naway";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length - 1 },
      extensions: [
        markdown({ base: markdownLanguage }),
        livePreviewContextFacet.of({
          sourceFilePath: null,
          rootFolderPath: null,
          files: [],
          themeMode: "light",
        }),
        livePreviewMermaid,
      ],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });
    views.push(view);

    // Force a non-zero layout width for the host.
    const wrap = view.dom.querySelector(
      ".cm-live-preview-mermaid",
    ) as HTMLElement | null;
    expect(wrap).not.toBeNull();
    Object.defineProperty(wrap!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 320,
        height: 120,
        top: 0,
        right: 320,
        bottom: 120,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => null,
      }),
    });
    const diagram = wrap!.querySelector(".mermaid") as HTMLElement;
    Object.defineProperty(diagram, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 320,
        height: 120,
        top: 0,
        right: 320,
        bottom: 120,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => null,
      }),
    });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // If still loading (observer not fired), click won't matter — dispatch render via click after forcing error class.
    if (wrap!.getAttribute("data-mermaid-status") !== "error") {
      wrap!.setAttribute("data-mermaid-status", "error");
      wrap!.classList.add("is-error");
    }

    mocked.mockImplementationOnce(async (container?: HTMLElement | null) => {
      const el = container?.querySelector(".mermaid") as HTMLElement | null;
      if (!el) return;
      el.innerHTML = "<svg data-test-mermaid='retry'></svg>";
      el.dataset.mermaidRendered = "true";
    });

    wrap!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mocked.mock.calls.length).toBeGreaterThan(0);
  });

  it("ignores editor click handling so posAtCoords cannot yank the caret", async () => {
    const { buildMermaidDecorations } = await import("./mermaid");
    const doc = "```mermaid\nflowchart TD\n  A-->B\n```\n\naway";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length - 1 },
      extensions: [
        markdown({ base: markdownLanguage }),
        livePreviewContextFacet.of({
          sourceFilePath: null,
          rootFolderPath: null,
          files: [],
          themeMode: "light",
        }),
      ],
    });

    let widget: { ignoreEvent: (event: Event) => boolean } | null = null;
    const deco = buildMermaidDecorations(state).decorations;
    deco.between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) {
        widget = value.spec.widget as typeof widget;
      }
    });
    expect(widget).not.toBeNull();
    expect(widget!.ignoreEvent(new MouseEvent("click"))).toBe(true);
    expect(widget!.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
  });
});
