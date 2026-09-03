/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const renderMermaidSVG = vi.fn();
const initialize = vi.fn();
const run = vi.fn();

vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVG: (...args: unknown[]) => renderMermaidSVG(...args),
  THEMES: {
    "nord-light": { bg: "#eceff4", fg: "#2e3440" },
    nord: { bg: "#2e3440", fg: "#eceff4" },
  },
}));

vi.mock("mermaid", () => ({
  default: {
    initialize,
    run,
  },
}));

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: vi.fn(() => false),
}));

vi.mock("katex", async () => {
  const actual = await vi.importActual<typeof import("katex")>("katex");
  return {
    default: {
      ...actual,
      renderToString: vi.fn(
        (...args: Parameters<typeof actual.renderToString>) =>
          actual.renderToString(...args),
      ),
    },
  };
});

import katex from "katex";

import {
  applyKatexDarkTheme,
  clearKatexRenderCacheForTests,
  getKatexRenderMode,
  getMermaidDefinition,
  getMermaidFirstDirective,
  getMermaidRendererKind,
  getRootMermaidSvg,
  initKaTeX,
  initMermaid,
  mixSrgbHex,
  normalizeMermaidSvg,
  parseSvgLength,
  parseSvgViewBoxSize,
  prepareBeautifulMermaidSvg,
  removeSvgLengthAttribute,
  renderMermaidDiagrams,
  resetMermaidPlaceholders,
} from "./markdown-extensions";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createVisibleMermaidHost(
  innerHTML = "flowchart LR\nA-->B",
): HTMLElement {
  const el = document.createElement("div");
  el.className = "mermaid";
  el.innerHTML = innerHTML;
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 480,
      height: 240,
      top: 0,
      right: 480,
      bottom: 240,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => null,
    }),
  });
  return el;
}

describe("escapeHtml (KaTeX/Mermaid XSS prevention)", () => {
  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes img onerror XSS vector", () => {
    const malicious = "<img src=x onerror=alert(1)>";
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain("<img");
    expect(escaped).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("leaves safe content unchanged", () => {
    const safe = "x^2 + y^2 = z^2";
    expect(escapeHtml(safe)).toBe(safe);
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("handles multiple XSS vectors in one string", () => {
    const input = '<img src=x onerror="alert(document.cookie)">&<script>';
    const output = escapeHtml(input);
    expect(output).not.toContain("<");
    expect(output).not.toContain(">");
  });
});

describe("mixSrgbHex", () => {
  it("mixes two hex colors by foreground weight", () => {
    expect(mixSrgbHex("#000000", "#ffffff", 0)).toBe("#ffffff");
    expect(mixSrgbHex("#000000", "#ffffff", 100)).toBe("#000000");
    expect(mixSrgbHex("#2e3440", "#eceff4", 3)).toBe("#e6e9ef");
  });
});

describe("prepareBeautifulMermaidSvg", () => {
  it("strips blocked font imports and injects computed surface tokens", () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" style="--bg:#eceff4;--fg:#2e3440"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter');
  svg { --_node-fill: var(--surface, color-mix(in srgb, var(--fg) 3%, var(--bg))); }
</style><rect fill="var(--_node-fill)" /></svg>`;

    const prepared = prepareBeautifulMermaidSvg(raw, {
      bg: "#eceff4",
      fg: "#2e3440",
    });

    expect(prepared).not.toContain("@import");
    expect(prepared).toContain("--surface:#e6e9ef");
    expect(prepared).toContain("--_group-hdr:");
    expect(prepared).toContain("--_text-faint:");
  });
});

describe("renderMermaidDiagrams", () => {
  beforeEach(() => {
    renderMermaidSVG.mockReset();
    initialize.mockReset();
    run.mockReset();
    document.body.innerHTML = "";
  });

  it("does not rerun for an already rendered diagram when only legacy layout width metadata differs", async () => {
    const container = document.createElement("div");
    const el = createVisibleMermaidHost("<svg><g></g></svg>");
    el.dataset.mermaidRendered = "true";
    el.dataset.mermaidSource = "flowchart LR\nA-->B";
    el.dataset.mermaidTheme = "light";
    el.dataset.mermaidLayoutWidth = "120";
    container.appendChild(el);

    await renderMermaidDiagrams(container, { themeMode: "light" });

    expect(renderMermaidSVG).not.toHaveBeenCalled();
  });

  it("resets rendered placeholders back to source text", () => {
    const container = document.createElement("div");
    const el = createVisibleMermaidHost("<svg><g></g></svg>");
    el.dataset.mermaidRendered = "true";
    el.dataset.mermaidSource = "flowchart LR\nA-->B";
    el.dataset.mermaidTheme = "dark";
    container.appendChild(el);

    resetMermaidPlaceholders(container);

    expect(el.textContent).toBe("flowchart LR\nA-->B");
    expect(el.dataset.mermaidRendered).toBeUndefined();
    expect(el.dataset.mermaidTheme).toBeUndefined();
    expect(el.dataset.mermaidSource).toBeUndefined();
  });

  it("marks a rendered diagram with source and theme metadata", async () => {
    renderMermaidSVG.mockReturnValue(
      '<svg viewBox="0 0 120 60"><text>ok</text></svg>',
    );
    const container = document.createElement("div");
    const el = createVisibleMermaidHost("flowchart LR\nA-->B");
    container.appendChild(el);

    await renderMermaidDiagrams(container, { themeMode: "light" });

    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.dataset.mermaidRendered).toBe("true");
    expect(el.dataset.mermaidSource).toBe("flowchart LR\nA-->B");
    expect(el.dataset.mermaidTheme).toBe("light");
    expect(el.dataset.mermaidEngine).toBe("beautiful");
    expect(el.querySelector(".mermaid-error")).toBeNull();
  });

  it("normalizes SVGs with empty width and height attributes without keeping invalid dimensions", async () => {
    const removeAttribute = SVGSVGElement.prototype.removeAttribute;
    const directEmptyDimensionRemovals: string[] = [];
    const removeAttributeSpy = vi
      .spyOn(SVGSVGElement.prototype, "removeAttribute")
      .mockImplementation(function removeSvgAttribute(
        this: SVGSVGElement,
        name: string,
      ) {
        if (
          (name === "width" || name === "height") &&
          this.getAttribute(name) === ""
        ) {
          directEmptyDimensionRemovals.push(name);
        }
        return removeAttribute.call(this, name);
      });

    renderMermaidSVG.mockReturnValue(
      '<svg width="" height="" viewBox="0 0 120 60"><text>ok</text></svg>',
    );
    const container = document.createElement("div");
    const el = createVisibleMermaidHost("flowchart LR\nA-->B");
    container.appendChild(el);

    try {
      await renderMermaidDiagrams(container, { themeMode: "light" });
    } finally {
      removeAttributeSpy.mockRestore();
    }

    const svg = el.querySelector("svg") as SVGSVGElement | null;
    expect(svg).not.toBeNull();
    expect(svg?.hasAttribute("width")).toBe(false);
    expect(svg?.hasAttribute("height")).toBe(false);
    expect(svg?.style.aspectRatio).toBe("120 / 60");
    expect(el.dataset.mermaidRendered).toBe("true");
    expect(directEmptyDimensionRemovals).toEqual([]);
  });

  it("shows a deterministic error state when Mermaid does not produce SVG", async () => {
    renderMermaidSVG.mockReturnValue("<span>not svg</span>");
    const container = document.createElement("div");
    const el = createVisibleMermaidHost("flowchart LR\nA-->");
    container.appendChild(el);

    await renderMermaidDiagrams(container, { themeMode: "dark" });

    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.dataset.mermaidRendered).toBe("error");
    expect(el.dataset.mermaidTheme).toBe("dark");
    expect(el.querySelector(".mermaid-error")?.textContent).toBe(
      "Failed to render diagram",
    );
  });

  it("renders more than 20 supported diagrams without batching limits", async () => {
    renderMermaidSVG.mockReturnValue(
      '<svg viewBox="0 0 120 60"><text>ok</text></svg>',
    );
    const container = document.createElement("div");
    for (let index = 0; index < 25; index += 1) {
      container.appendChild(
        createVisibleMermaidHost(`flowchart LR\nA${index}-->B${index}`),
      );
    }

    await renderMermaidDiagrams(container, { themeMode: "light" });

    expect(renderMermaidSVG).toHaveBeenCalledTimes(25);
    expect(container.querySelectorAll(".mermaid svg")).toHaveLength(25);
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".mermaid")).every(
        (node) => node.dataset.mermaidRendered === "true",
      ),
    ).toBe(true);
  });

  it("routes pie charts to official Mermaid instead of beautiful-mermaid", async () => {
    run.mockImplementation(async ({ nodes }: { nodes: HTMLElement[] }) => {
      nodes.forEach((node) => {
        node.innerHTML = '<svg viewBox="0 0 120 60"><text>pie</text></svg>';
      });
    });
    const container = document.createElement("div");
    const el = createVisibleMermaidHost(
      'pie title Demo\n  "A" : 40\n  "B" : 60',
    );
    container.appendChild(el);

    await renderMermaidDiagrams(container, { themeMode: "light" });

    expect(renderMermaidSVG).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(el.dataset.mermaidEngine).toBe("official");
    expect(el.dataset.mermaidRendered).toBe("true");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        flowchart: expect.objectContaining({ useMaxWidth: false }),
      }),
    );
  });
});

describe("getKatexRenderMode", () => {
  it("enables MathML fallback for Tauri-like surfaces", () => {
    expect(
      getKatexRenderMode({
        isTauri: true,
        protocol: "tauri:",
      }),
    ).toBe("mathml");
  });

  it("enables MathML fallback for custom app protocols without relying on production build", () => {
    expect(
      getKatexRenderMode({
        isTauri: false,
        protocol: "tauri:",
      }),
    ).toBe("mathml");
  });

  it("does not enable MathML fallback for non-Tauri web builds", () => {
    expect(
      getKatexRenderMode({
        isTauri: false,
        protocol: "https:",
      }),
    ).toBeNull();
  });

  it("enables MathML fallback for asset: protocol", () => {
    expect(
      getKatexRenderMode({
        isTauri: false,
        protocol: "asset:",
      }),
    ).toBe("mathml");
  });

  it("enables MathML fallback for app: protocol", () => {
    expect(
      getKatexRenderMode({
        isTauri: false,
        protocol: "app:",
      }),
    ).toBe("mathml");
  });
});

describe("applyKatexDarkTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-katex-render-mode");
    document
      .querySelectorAll('[id="katex-dark-theme"]')
      .forEach((el) => el.remove());
  });

  it("removes legacy katex-dark-theme element if present", () => {
    const legacyStyle = document.createElement("style");
    legacyStyle.id = "katex-dark-theme";
    document.head.appendChild(legacyStyle);

    applyKatexDarkTheme();

    expect(document.getElementById("katex-dark-theme")).toBeNull();
  });

  it("sets data-katex-render-mode to mathml when in Tauri environment", async () => {
    const { isTauriEnvironment } = await import("../types/filesystem");
    vi.mocked(isTauriEnvironment).mockReturnValue(true);

    applyKatexDarkTheme();

    expect(
      document.documentElement.getAttribute("data-katex-render-mode"),
    ).toBe("mathml");
  });

  it("removes data-katex-render-mode when not in Tauri environment", async () => {
    const { isTauriEnvironment } = await import("../types/filesystem");
    vi.mocked(isTauriEnvironment).mockReturnValue(false);

    document.documentElement.setAttribute("data-katex-render-mode", "mathml");
    applyKatexDarkTheme();

    expect(
      document.documentElement.hasAttribute("data-katex-render-mode"),
    ).toBe(false);
  });

  it("does nothing when document is undefined", () => {
    // happy-dom has document, so this just verifies no throw
    expect(() => applyKatexDarkTheme()).not.toThrow();
  });
});

describe("renderMermaidDiagrams edge cases", () => {
  beforeEach(() => {
    renderMermaidSVG.mockReset();
    initialize.mockReset();
    run.mockReset();
    document.body.innerHTML = "";
  });

  it("skips diagrams with zero-width bounding rect (invisible layout)", async () => {
    const container = document.createElement("div");
    const el = document.createElement("div");
    el.className = "mermaid";
    el.textContent = "flowchart LR\nA-->B";
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 0,
        height: 240,
        top: 0,
        right: 0,
        bottom: 240,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => null,
      }),
    });
    container.appendChild(el);

    await renderMermaidDiagrams(container, { themeMode: "light" });

    expect(renderMermaidSVG).not.toHaveBeenCalled();
    expect(el.dataset.mermaidPendingWidth).toBe("true");
  });

  it("logs error when official Mermaid run throws but continues processing", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    run.mockRejectedValue(new Error("Mermaid crashed"));

    const container = document.createElement("div");
    const el = createVisibleMermaidHost(
      "gantt\n  title Demo\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2024-01-01, 1d",
    );
    container.appendChild(el);

    await renderMermaidDiagrams(container, { themeMode: "light" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Official Mermaid run failed:",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it("returns early when window is undefined (SSR)", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error - simulate SSR
    globalThis.window = undefined;

    await renderMermaidDiagrams(document.createElement("div"));

    expect(renderMermaidSVG).not.toHaveBeenCalled();
    globalThis.window = originalWindow;
  });

  it("returns early when no mermaid nodes exist", async () => {
    const container = document.createElement("div");
    await renderMermaidDiagrams(container, { themeMode: "light" });
    expect(renderMermaidSVG).not.toHaveBeenCalled();
  });

  it("uses document.querySelectorAll when container is null", async () => {
    renderMermaidSVG.mockReturnValue(
      '<svg viewBox="0 0 120 60"><text>ok</text></svg>',
    );

    const el = createVisibleMermaidHost("flowchart LR\nA-->B");
    document.body.appendChild(el);

    await renderMermaidDiagrams(null, { themeMode: "light" });

    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
    document.body.innerHTML = "";
  });

  it("skips elements with no definition and no existing svg", async () => {
    const container = document.createElement("div");
    const el = document.createElement("div");
    el.className = "mermaid";
    el.textContent = "";
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 480,
        height: 240,
        top: 0,
        right: 480,
        bottom: 240,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => null,
      }),
    });
    container.appendChild(el);

    await renderMermaidDiagrams(container, { themeMode: "light" });

    expect(renderMermaidSVG).not.toHaveBeenCalled();
  });
});

describe("initKaTeX", () => {
  beforeEach(() => {
    // Rendered formulas are memoized module-wide; clear so mocks that throw
    // (error-path tests) are actually invoked instead of hitting the cache.
    clearKatexRenderCacheForTests();
  });

  it("registers inline math ruler and renders KaTeX", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.inline.ruler.rules.find(
      (r: any) => r.name === "katex_inline_math",
    );
    expect(rule).toBeDefined();

    const state = createMockInlineState("$x^2$");
    const result = rule.fn(state, false);
    expect(result).toBe(true);
    expect(state.pos).toBe(5);
    expect(state.tokens.length).toBe(1);
    expect(state.tokens[0].type).toBe("html_inline");
  });

  it("returns false for inline math when no closing $", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.inline.ruler.rules.find(
      (r: any) => r.name === "katex_inline_math",
    );
    const state = createMockInlineState("$x^2");
    const result = rule.fn(state, false);
    expect(result).toBe(false);
  });

  it("returns false for inline math when `$` is escaped as `\\$`", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.inline.ruler.rules.find(
      (r: any) => r.name === "katex_inline_math",
    );
    const state = createMockInlineState("\\$x$");
    state.pos = 1; // parser is at `$`
    const result = rule.fn(state, false);
    expect(result).toBe(false);
  });

  it("returns false for inline math when closing `$` is after a newline", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.inline.ruler.rules.find(
      (r: any) => r.name === "katex_inline_math",
    );
    const state = createMockInlineState("$x\n$");
    const result = rule.fn(state, false);
    expect(result).toBe(false);
  });

  it("returns false for display math $$ in inline rule", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.inline.ruler.rules.find(
      (r: any) => r.name === "katex_inline_math",
    );
    const state = createMockInlineState("$$x^2$$");
    const result = rule.fn(state, false);
    expect(result).toBe(false);
  });

  it("registers display math block ruler", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.block.ruler.rules.find(
      (r: any) => r.name === "katex_display_math",
    );
    expect(rule).toBeDefined();

    const state = createMockBlockState("$$x^2$$");
    const result = rule.fn(state, 0, 10);
    expect(result).toBe(true);
    expect(state.line).toBe(1);
    expect(state.tokens.length).toBe(1);
    expect(state.tokens[0].type).toBe("katex_display");
    expect(state.tokens[0].content).toBe("x^2");
  });

  it("handles multi-line display math", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.block.ruler.rules.find(
      (r: any) => r.name === "katex_display_math",
    );
    const state = createMockBlockState("$$\nx^2\n$$");
    const result = rule.fn(state, 0, 10);
    expect(result).toBe(true);
    expect(state.tokens[0].content).toBe("x^2");
  });

  it("returns false for display math without closing $$", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.block.ruler.rules.find(
      (r: any) => r.name === "katex_display_math",
    );
    const state = createMockBlockState("$$x^2");
    const result = rule.fn(state, 0, 10);
    expect(result).toBe(false);
  });

  it("returns false when line is too short for $$", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.block.ruler.rules.find(
      (r: any) => r.name === "katex_display_math",
    );
    const state = createMockBlockState("$");
    const result = rule.fn(state, 0, 10);
    expect(result).toBe(false);
  });

  it("renders display math via renderer rule", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const tokens = [{ content: "x^2" }];
    const html = md.renderer.rules.katex_display(tokens, 0);
    expect(html).toContain("katex-display");
  });

  it("falls back to error div on invalid display math", () => {
    vi.mocked(katex.renderToString).mockImplementationOnce(() => {
      throw new Error("KaTeX render failed");
    });

    const md = createMockMarkdownIt();
    initKaTeX(md);

    const tokens = [{ content: "x^2" }];
    const html = md.renderer.rules.katex_display(tokens, 0);
    expect(html).toContain("katex-error");
  });

  it("falls back to raw text on invalid inline math", () => {
    vi.mocked(katex.renderToString).mockImplementationOnce(() => {
      throw new Error("KaTeX render failed");
    });

    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.inline.ruler.rules.find(
      (r: any) => r.name === "katex_inline_math",
    );
    const state = createMockInlineState("$x^2$");
    rule.fn(state, false);
    expect(state.tokens[0].type).toBe("text");
    expect(state.tokens[0].content).toBe("$x^2$");
  });

  it("does not push token in silent mode for inline math", () => {
    const md = createMockMarkdownIt();
    initKaTeX(md);

    const rule = md.inline.ruler.rules.find(
      (r: any) => r.name === "katex_inline_math",
    );
    const state = createMockInlineState("$x^2$");
    const result = rule.fn(state, true);
    expect(result).toBe(true);
    expect(state.tokens.length).toBe(0);
  });
});

describe("initMermaid", () => {
  it("returns mermaid div for mermaid fence language", () => {
    const md = createMockMarkdownIt();
    initMermaid(md);

    const tokens = [{ info: "mermaid", content: "flowchart LR\nA-->B" }];
    const result = md.renderer.rules.fence(tokens, 0, {}, {}, {});
    expect(result).toBe('<div class="mermaid">flowchart LR\nA-->B</div>');
  });

  it("returns mermaid div for mmd fence language", () => {
    const md = createMockMarkdownIt();
    initMermaid(md);

    const tokens = [{ info: "mmd", content: "graph TD\nA-->B" }];
    const result = md.renderer.rules.fence(tokens, 0, {}, {}, {});
    expect(result).toBe('<div class="mermaid">graph TD\nA-->B</div>');
  });

  it("falls back to default fence for non-mermaid languages", () => {
    const md = createMockMarkdownIt();
    const defaultFence = vi.fn(() => "<pre>code</pre>");
    md.renderer.rules.fence = defaultFence;
    initMermaid(md);

    const tokens = [{ info: "js", content: "const x = 1;" }];
    const result = md.renderer.rules.fence(tokens, 0, {}, {}, {});
    expect(result).toBe("<pre>code</pre>");
  });
});

describe("getMermaidRendererKind", () => {
  it("routes common supported diagram types to beautiful-mermaid", () => {
    expect(getMermaidRendererKind("flowchart LR\nA-->B")).toBe("beautiful");
    expect(getMermaidRendererKind("graph TD\nA-->B")).toBe("beautiful");
    expect(getMermaidRendererKind("sequenceDiagram\nA->>B: hi")).toBe(
      "beautiful",
    );
    expect(getMermaidRendererKind("classDiagram\nclass A")).toBe("beautiful");
    expect(getMermaidRendererKind("erDiagram\nA ||--o{ B : has")).toBe(
      "beautiful",
    );
    expect(getMermaidRendererKind("stateDiagram-v2\n[*] --> A")).toBe(
      "beautiful",
    );
    expect(
      getMermaidRendererKind("xychart-beta\n  title Demo\n  bar [1,2]"),
    ).toBe("beautiful");
  });

  it("routes unsupported diagram types to official Mermaid", () => {
    expect(getMermaidRendererKind('pie title Demo\n  "A" : 40')).toBe(
      "official",
    );
    expect(getMermaidRendererKind("gantt\n  title Demo")).toBe("official");
    expect(getMermaidRendererKind("gitGraph\n  commit")).toBe("official");
    expect(getMermaidRendererKind("journey\n  title Demo")).toBe("official");
  });

  it("ignores leading comments when detecting the diagram type", () => {
    expect(
      getMermaidRendererKind('%% comment\npie title Demo\n  "A" : 40'),
    ).toBe("official");
    expect(getMermaidRendererKind("%% comment\nflowchart LR\nA-->B")).toBe(
      "beautiful",
    );
  });
});

describe("getMermaidFirstDirective", () => {
  it("returns the first non-empty, non-comment line", () => {
    expect(getMermaidFirstDirective("%% note\npie title Demo")).toBe(
      "pie title demo",
    );
    expect(getMermaidFirstDirective("\n\nflowchart LR")).toBe("flowchart lr");
  });
});

describe("getMermaidDefinition", () => {
  it("returns data-mermaid-source when present", () => {
    const el = document.createElement("div");
    el.dataset.mermaidSource = "flowchart LR\nA-->B";
    expect(getMermaidDefinition(el)).toBe("flowchart LR\nA-->B");
  });

  it("falls back to trimmed textContent", () => {
    const el = document.createElement("div");
    el.textContent = "  graph TD\nA-->B  ";
    expect(getMermaidDefinition(el)).toBe("graph TD\nA-->B");
  });
});

describe("parseSvgLength", () => {
  it("parses positive pixel values", () => {
    expect(parseSvgLength("100")).toBe(100);
    expect(parseSvgLength("100px")).toBe(100);
  });

  it("returns null for empty or whitespace", () => {
    expect(parseSvgLength("")).toBeNull();
    expect(parseSvgLength("   ")).toBeNull();
    expect(parseSvgLength(null)).toBeNull();
  });

  it("returns null for non-positive or invalid values", () => {
    expect(parseSvgLength("0")).toBeNull();
    expect(parseSvgLength("-5")).toBeNull();
    expect(parseSvgLength("abc")).toBeNull();
    expect(parseSvgLength("NaN")).toBeNull();
  });
});

describe("parseSvgViewBoxSize", () => {
  it("parses standard viewBox", () => {
    expect(parseSvgViewBoxSize("0 0 100 200")).toEqual({
      width: 100,
      height: 200,
    });
  });

  it("parses comma-separated viewBox", () => {
    expect(parseSvgViewBoxSize("0,0,100,200")).toEqual({
      width: 100,
      height: 200,
    });
  });

  it("returns null for fewer than 4 parts", () => {
    expect(parseSvgViewBoxSize("0 0 100")).toBeNull();
  });

  it("returns null for empty or invalid", () => {
    expect(parseSvgViewBoxSize("")).toBeNull();
    expect(parseSvgViewBoxSize(null)).toBeNull();
    expect(parseSvgViewBoxSize("a b c d")).toBeNull();
  });

  it("returns null for non-positive dimensions", () => {
    expect(parseSvgViewBoxSize("0 0 0 0")).toBeNull();
    expect(parseSvgViewBoxSize("0 0 -10 20")).toBeNull();
  });
});

describe("removeSvgLengthAttribute", () => {
  it("does nothing when attribute is absent", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    removeSvgLengthAttribute(svg, "width");
    expect(svg.hasAttribute("width")).toBe(false);
  });

  it("removes attribute when present", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100");
    removeSvgLengthAttribute(svg, "width");
    expect(svg.hasAttribute("width")).toBe(false);
  });

  it("sets to 1 then removes when value is empty string", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "");
    removeSvgLengthAttribute(svg, "width");
    expect(svg.hasAttribute("width")).toBe(false);
  });
});

describe("getRootMermaidSvg", () => {
  it("returns first child svg", () => {
    const el = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.appendChild(svg);
    expect(getRootMermaidSvg(el)).toBe(svg);
  });

  it("returns svg found by querySelector when first child is not svg", () => {
    const el = document.createElement("div");
    const span = document.createElement("span");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.appendChild(span);
    el.appendChild(svg);
    expect(getRootMermaidSvg(el)).toBe(svg);
  });

  it("returns null when no svg exists", () => {
    const el = document.createElement("div");
    el.appendChild(document.createElement("span"));
    expect(getRootMermaidSvg(el)).toBeNull();
  });
});

describe("normalizeMermaidSvg", () => {
  it("sets aspect ratio when viewBox is present", () => {
    const el = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 200");
    svg.classList.add("flowchart");
    el.appendChild(svg);

    normalizeMermaidSvg(el);
    expect(svg.style.aspectRatio).toBe("100 / 200");
    expect(svg.style.width).toBe("100px");
    expect(svg.style.maxWidth).toBe("none");
    expect(svg.style.height).toBe("auto");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMin meet");
  });

  it("keeps wide flowcharts at natural width instead of shrinking to the column", () => {
    const el = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 2400 140");
    el.appendChild(svg);

    normalizeMermaidSvg(el);
    expect(svg.style.width).toBe("2400px");
    expect(svg.style.maxWidth).toBe("none");
    expect(svg.style.width).not.toContain("min(");
  });

  it("falls back to width/height attributes when no viewBox", () => {
    const el = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "150");
    svg.setAttribute("height", "300");
    svg.classList.add("flowchart");
    el.appendChild(svg);

    normalizeMermaidSvg(el);
    expect(svg.style.aspectRatio).toBe("150 / 300");
  });

  it("uses auto sizing when no dimensions are available", () => {
    const el = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("flowchart");
    el.appendChild(svg);

    normalizeMermaidSvg(el);
    expect(svg.style.width).toBe("");
    expect(svg.style.height).toBe("auto");
    expect(svg.style.maxWidth).toBe("none");
    expect(svg.style.aspectRatio).toBe("");
  });

  it("removes empty width/height attributes", () => {
    const el = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "");
    svg.setAttribute("height", "");
    svg.setAttribute("viewBox", "0 0 100 200");
    svg.classList.add("flowchart");
    el.appendChild(svg);

    normalizeMermaidSvg(el);
    expect(svg.hasAttribute("width")).toBe(false);
    expect(svg.hasAttribute("height")).toBe(false);
  });

  it("does nothing when no svg is found", () => {
    const el = document.createElement("div");
    expect(() => normalizeMermaidSvg(el)).not.toThrow();
  });
});

// Helper factories for mock markdown-it
function createMockMarkdownIt() {
  const inlineRules: any[] = [];
  const blockRules: any[] = [];
  return {
    inline: {
      ruler: {
        after: vi.fn((_chain: string, name: string, fn: any) => {
          inlineRules.push({ name, fn });
        }),
        rules: inlineRules,
      },
    },
    block: {
      ruler: {
        after: vi.fn((_chain: string, name: string, fn: any) => {
          blockRules.push({ name, fn });
        }),
        rules: blockRules,
      },
    },
    renderer: { rules: {} as Record<string, any> },
  };
}

function createMockInlineState(src: string) {
  const tokens: any[] = [];
  const state = {
    src,
    pos: 0,
    tokens,
    push: (type: string, _tag: string, _nesting: number) => {
      const token = { type, content: "" };
      state.tokens.push(token);
      return token;
    },
  };
  return state;
}

function createMockBlockState(src: string) {
  const lines = src.split("\n");
  const bMarks = lines.map(
    (_, i) => lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0),
  );
  const eMarks = lines.map((line, i) => bMarks[i] + line.length);
  const tokens: any[] = [];
  const state: any = {
    src,
    bMarks,
    eMarks,
    tShift: lines.map(() => 0),
    line: 0,
    lineMax: lines.length,
    tokens,
    push: (type: string, _tag: string, _nesting: number) => {
      const token = { type, content: "", map: [0, 0] as [number, number] };
      state.tokens.push(token);
      return token;
    },
  };
  return state;
}
