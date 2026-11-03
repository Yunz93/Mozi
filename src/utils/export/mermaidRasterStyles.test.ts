/** @vitest-environment happy-dom */

import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMermaidSVG } from "beautiful-mermaid";
import {
  normalizeMermaidSvg,
  renderMermaidDiagrams,
} from "../markdown-extensions";
import { prepareExportRenderTargetForRasterization } from "./exportRasterHost";
import { buildExportStyles } from "./styles";

vi.mock("./images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./images")>()),
  waitForNextPaint: vi.fn(async () => {}),
}));

const { copyCSSStyles } = createRequire(import.meta.url)(
  "html2canvas/dist/lib/dom/document-cloner.js",
) as {
  copyCSSStyles: (style: CSSStyleDeclaration, target: Element) => Element;
};

afterEach(() => {
  vi.restoreAllMocks();
  document.head
    .querySelectorAll("[data-export-svg-test]")
    .forEach((node) => node.remove());
  document.body.innerHTML = "";
});

describe("Mermaid raster SVG coordinates", () => {
  it.each(["light", "dark"] as const)(
    "fits wide %s diagrams during shared raster preparation without changing nested coordinates",
    async (theme) => {
      const style = document.createElement("style");
      style.dataset.exportSvgTest = "true";
      style.textContent = buildExportStyles(theme);
      document.head.appendChild(style);
      const root = document.createElement("div");
      root.className = "export-document";
      root.innerHTML =
        '<article class="markdown-body"><div class="mermaid"></div></article>';
      document.body.appendChild(root);
      const card = root.querySelector<HTMLElement>(".mermaid")!;
      card.textContent = `flowchart LR
A[收集想法与资料] --> B[整理正文和补充说明]
B --> C[插入图片图表与双向链接]
C --> D[切换阅读模式检查排版]
D --> E[导出完整长图并分享文稿]
E --> F[保留最后一个节点的完整内容]`;
      vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 575, 200),
      );
      await renderMermaidDiagrams(root, { themeMode: theme });
      const svg = card.querySelector<SVGSVGElement>("svg")!;
      const viewBox = svg.getAttribute("viewBox");
      const naturalWidth = Number(viewBox!.split(/\s+/)[2]);
      const naturalWidthStyle = svg.style.width;
      const aspectRatio = svg.style.aspectRatio;
      expect(naturalWidth).toBeGreaterThan(920);
      expect(Number.parseFloat(naturalWidthStyle)).toBeCloseTo(naturalWidth, 2);
      expect(svg.style.maxWidth).toBe("none");

      const nested = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      nested.setAttribute("x", "900");
      nested.setAttribute("width", "80");
      nested.setAttribute("height", "40");
      nested.setAttribute("viewBox", "0 0 80 40");
      svg.appendChild(nested);
      const nestedMarkup = nested.outerHTML;

      await prepareExportRenderTargetForRasterization(root, theme);

      expect(getComputedStyle(svg).maxWidth).toBe("100%");
      expect(svg.style.getPropertyPriority("max-width")).toBe("important");
      expect(svg.style.width).toBe(naturalWidthStyle);
      expect(svg.getAttribute("viewBox")).toBe(viewBox);
      expect(svg.style.aspectRatio).toBe(aspectRatio);
      expect(svg.textContent).toContain("保留最后一个节点的完整内容");
      expect(nested.outerHTML).toBe(nestedMarkup);
    },
  );

  it.each(
    (["light", "dark"] as const).flatMap((theme) =>
      [400, 575].flatMap((cardWidth) =>
        [
          ["写作者", "墨知", "保存一篇笔记", "保留原始 Markdown"],
          ["Writer", "Mozi", "Save note", "Keep Markdown"],
        ].map((labels) => ({ theme, cardWidth, labels })),
      ),
    ),
  )(
    "keeps both actors inside a serialized $theme SVG in a $cardWidth px card: $labels",
    ({ theme, cardWidth, labels }) => {
      const style = document.createElement("style");
      style.dataset.exportSvgTest = "true";
      style.textContent = buildExportStyles(theme);
      document.head.appendChild(style);
      const root = document.createElement("div");
      root.className = "export-document";
      root.innerHTML =
        '<article class="markdown-body"><div class="mermaid"></div></article>';
      document.body.appendChild(root);
      const card = root.querySelector<HTMLElement>(".mermaid")!;
      card.innerHTML = renderMermaidSVG(`sequenceDiagram
participant W as ${labels[0]}
participant M as ${labels[1]}
W->>M: ${labels[2]}
M-->>W: ${labels[3]}`);
      normalizeMermaidSvg(card);
      const svg = card.querySelector<SVGSVGElement>("svg")!;
      // PDF 克隆同样只约束根 SVG；html2canvas 随后复制其 computed CSS。
      svg.style.setProperty("max-width", "100%", "important");
      const viewportWidth = Number(
        svg.getAttribute("viewBox")!.split(/\s+/)[2],
      );
      const computed = getComputedStyle(svg);
      const resolvedStyles = document.createElement("div");
      copyCSSStyles(computed, resolvedStyles);
      // DOM 模拟器不计算布局，这里按 CSS 块级居中规则还原浏览器的像素 margin。
      for (const side of ["margin-left", "margin-right"]) {
        if (computed.getPropertyValue(side) === "auto") {
          resolvedStyles.style.setProperty(
            side,
            `${(cardWidth - viewportWidth) / 2}px`,
          );
        }
      }
      const clone = svg.cloneNode(true) as SVGSVGElement;
      copyCSSStyles(resolvedStyles.style, clone);
      const serialized = new DOMParser().parseFromString(
        new XMLSerializer().serializeToString(clone),
        "text/html",
      );
      const serializedSvg = serialized.querySelector<SVGSVGElement>("svg")!;
      const internalOffset =
        Number.parseFloat(serializedSvg.style.marginLeft) || 0;
      const actors = Array.from(serializedSvg.querySelectorAll("g.actor rect"));
      expect(actors.length).toBe(2);
      for (const actor of actors) {
        const left = Number(actor.getAttribute("x")) + internalOffset;
        const right = left + Number(actor.getAttribute("width"));
        expect(left).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(viewportWidth);
      }
      expect(internalOffset).toBe(0);
      for (const label of labels)
        expect(serializedSvg.textContent).toContain(label);
      expect(getComputedStyle(card).textAlign).toBe("center");
    },
  );
});
