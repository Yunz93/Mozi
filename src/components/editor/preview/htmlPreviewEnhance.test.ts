/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";
import {
  clampHtmlPreviewZoom,
  computeHtmlPreviewFitZoom,
  ensureHtmlPreviewMermaidStyles,
  isHtmlPreviewZoomModifier,
  nextHtmlPreviewZoom,
  normalizeMermaidPlaceholdersInDocument,
} from "./htmlPreviewEnhance";

describe("htmlPreviewEnhance zoom math", () => {
  it("clamps and rounds zoom values", () => {
    expect(clampHtmlPreviewZoom(0.01)).toBe(0.25);
    expect(clampHtmlPreviewZoom(9)).toBe(3);
    expect(clampHtmlPreviewZoom(1.234)).toBe(1.23);
  });

  it("steps zoom by 10%", () => {
    expect(nextHtmlPreviewZoom(1, 1)).toBe(1.1);
    expect(nextHtmlPreviewZoom(1, -1)).toBe(0.9);
    expect(nextHtmlPreviewZoom(0.25, -1)).toBe(0.25);
  });

  it("fits content into the viewport without upscaling past 100%", () => {
    expect(computeHtmlPreviewFitZoom(800, 600, 400, 300)).toBe(0.5);
    expect(computeHtmlPreviewFitZoom(200, 100, 800, 600)).toBe(1);
    expect(computeHtmlPreviewFitZoom(0, 100, 800, 600)).toBe(1);
  });

  it("treats meta or ctrl as zoom modifiers", () => {
    expect(isHtmlPreviewZoomModifier({ metaKey: true, ctrlKey: false })).toBe(
      true,
    );
    expect(isHtmlPreviewZoomModifier({ metaKey: false, ctrlKey: true })).toBe(
      true,
    );
    expect(isHtmlPreviewZoomModifier({ metaKey: false, ctrlKey: false })).toBe(
      false,
    );
  });
});

describe("normalizeMermaidPlaceholdersInDocument", () => {
  it("converts fenced language-mermaid code blocks into .mermaid hosts", () => {
    const doc = document.implementation.createHTMLDocument("t");
    doc.body.innerHTML =
      '<pre><code class="language-mermaid">flowchart TD\nA-->B</code></pre>';

    expect(normalizeMermaidPlaceholdersInDocument(doc)).toBe(1);
    const host = doc.querySelector(".mermaid");
    expect(host?.tagName).toBe("DIV");
    expect(host?.textContent).toContain("flowchart TD");
    expect(doc.querySelector("code.language-mermaid")).toBeNull();
  });

  it("leaves existing .mermaid nodes alone", () => {
    const doc = document.implementation.createHTMLDocument("t");
    doc.body.innerHTML = '<div class="mermaid">graph TD;A-->B;</div>';
    expect(normalizeMermaidPlaceholdersInDocument(doc)).toBe(0);
    expect(doc.querySelectorAll(".mermaid")).toHaveLength(1);
  });

  it("injects mermaid helper styles once", () => {
    const doc = document.implementation.createHTMLDocument("t");
    ensureHtmlPreviewMermaidStyles(doc);
    ensureHtmlPreviewMermaidStyles(doc);
    expect(doc.querySelectorAll("#mp-html-preview-mermaid-style")).toHaveLength(
      1,
    );
  });
});
