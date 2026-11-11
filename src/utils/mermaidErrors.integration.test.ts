// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownIt from "markdown-it";
import mermaid from "mermaid";
import {
  initMermaid,
  renderMermaidDiagrams,
  resetMermaidPlaceholders,
} from "./markdown-extensions";

vi.mock("../types/filesystem", () => ({
  isTauriEnvironment: () => false,
}));

function createDiagram(source: string) {
  const host = document.createElement("div");
  const diagram = document.createElement("div");
  diagram.className = "mermaid";
  diagram.textContent = source;
  Object.defineProperty(diagram, "getBoundingClientRect", {
    value: () => ({ width: 480, height: 200 }),
  });
  host.append(diagram);
  document.body.append(host);
  return { host, diagram };
}

const originalGetBBox = Object.getOwnPropertyDescriptor(
  SVGElement.prototype,
  "getBBox",
);

afterEach(() => {
  if (originalGetBBox) {
    Object.defineProperty(SVGElement.prototype, "getBBox", originalGetBBox);
  } else {
    Reflect.deleteProperty(SVGElement.prototype, "getBBox");
  }
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("official Mermaid Gantt layout", () => {
  it("keeps date ticks readable in a narrow preview instead of squeezing the timeline", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(480);
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: function (this: SVGElement) {
        return {
          x: 0,
          y: 0,
          width: (this.textContent?.length ?? 0) * 8,
          height: 16,
        };
      },
    });
    const { host, diagram } = createDiagram(`gantt
dateFormat YYYY-MM-DD
section Section
Completed :done, des1, 2014-01-06,2014-01-08
Active :active, des2, 2014-01-07, 3d
Parallel 1 : des3, after des1, 1d
Parallel 2 : des4, after des1, 1d
Parallel 3 : des5, after des3, 1d
Parallel 4 : des6, after des4, 1d`);
    await renderMermaidDiagrams(host, { themeMode: "light" });
    expect(diagram.dataset.mermaidRendered).toBe("true");
    const ticks = Array.from(
      diagram.querySelectorAll<SVGGElement>(".grid .tick"),
    );
    expect(ticks.length).toBeGreaterThan(1);
    const position = (tick: SVGGElement) =>
      Number(tick.getAttribute("transform")?.match(/translate\(([^,)]+)/)?.[1]);
    for (let i = 1; i < ticks.length; i += 1) {
      const previous = ticks[i - 1]!;
      const current = ticks[i]!;
      const labelWidth =
        (previous.textContent!.length + current.textContent!.length) * 4;
      expect(position(current) - position(previous)).toBeGreaterThan(
        labelWidth + 8,
      );
    }
    expect(diagram.querySelector("svg")!.style.maxWidth).toBe("none");
  });
});

describe("official Mermaid syntax errors", () => {
  it("replaces the real engine's error canvas with a settled compact error", async () => {
    const source = "this is not a Mermaid diagram";
    const control = createDiagram(source);
    // 官方引擎只设置 suppressErrors 时仍会生成巨大的错误 SVG。
    mermaid.initialize({ startOnLoad: false, suppressErrorRendering: false });
    await mermaid.run({ nodes: [control.diagram], suppressErrors: true });
    expect(control.diagram.querySelector("svg .error-icon")).not.toBeNull();
    expect(control.diagram.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 2412 512",
    );
    control.host.remove();

    const { host, diagram } = createDiagram(source);
    await renderMermaidDiagrams(host, { themeMode: "dark" });
    expect(diagram.dataset.mermaidRendered).toBe("error");
    expect(diagram.dataset.mermaidSource).toBe(source);
    expect(diagram.querySelector("svg")).toBeNull();
    expect(diagram.querySelector(".mermaid-error")?.textContent).toBe(
      "Failed to render diagram",
    );

    const error = diagram.firstElementChild;
    await renderMermaidDiagrams(host, { themeMode: "dark" });
    expect(diagram.firstElementChild).toBe(error);
  });

  it("can render corrected source after resetting an error", async () => {
    const { host, diagram } = createDiagram("another invalid diagram");
    await renderMermaidDiagrams(host, { themeMode: "dark" });
    expect(diagram.dataset.mermaidRendered).toBe("error");

    resetMermaidPlaceholders(host);
    diagram.textContent = "flowchart LR\nA --> B";
    await renderMermaidDiagrams(host, { themeMode: "dark" });
    expect(diagram.dataset.mermaidRendered).toBe("true");
    expect(diagram.dataset.mermaidEngine).toBe("beautiful");
    expect(diagram.querySelector("svg")).not.toBeNull();
    expect(diagram.querySelector(".mermaid-error")).toBeNull();
  });
});

describe("Mermaid fenced source", () => {
  it.each(["mermaid", "mmd"])(
    "preserves angle brackets and entities in %s fences as source text",
    (language) => {
      const md = new MarkdownIt();
      initMermaid(md);
      const source = 'flowchart LR\nA["<user> &amp; literal<br/>text"] --> B';
      const host = document.createElement("div");
      host.innerHTML = md.render(`\`\`\`${language}\n${source}\n\`\`\``);
      const diagram = host.querySelector(".mermaid");
      expect(diagram).not.toBeNull();
      expect(diagram?.textContent).toBe(source);
      expect(diagram?.children.length).toBe(0);
    },
  );
});
