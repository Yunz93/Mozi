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

afterEach(() => {
  document.body.replaceChildren();
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
