/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportToHtml } from "./htmlExport";
import {
  getMarkdownStyleTokens,
  MARKDOWN_STYLE_PRESETS,
} from "../markdownStyle";
import {
  EXPORT_RASTER_HOST_CLASS,
  EXPORT_RASTER_STYLE_ID,
  buildHtml2CanvasRasterOptions,
  disposeAllExportRasterArtifacts,
  disposeExportRasterHost,
  mountExportHtmlForRasterization,
  restoreExportRasterHostStyles,
  revealExportRasterHostForCapture,
  withExportTimeout,
} from "./exportRasterHost";

describe("mountExportHtmlForRasterization", () => {
  afterEach(() => {
    document.getElementById(EXPORT_RASTER_STYLE_ID)?.remove();
    document.body.innerHTML = "";
    document.getElementById("test-app-theme")?.remove();
    document.documentElement.classList.remove("dark");
  });

  it.each(MARKDOWN_STYLE_PRESETS)(
    "keeps %s raster headings independent of the app theme cascade",
    async (preset) => {
      const appStyle = document.createElement("style");
      appStyle.id = "test-app-theme";
      appStyle.textContent =
        readFileSync(
          resolve(process.cwd(), "src/styles/markdown-theme.css"),
          "utf8",
        ) +
        readFileSync(resolve(process.cwd(), "src/styles/preview.css"), "utf8");
      document.head.appendChild(appStyle);
      document.documentElement.classList.add("dark");
      const html = await exportToHtml("# 导出标题", {
        theme: "dark",
        markdownStylePreset: preset,
      });
      const { host, renderTarget } = mountExportHtmlForRasterization(html);
      const article = renderTarget.querySelector<HTMLElement>("article")!;
      expect(
        getComputedStyle(article).getPropertyValue("--mp-doc-heading-1").trim(),
      ).toBe(getMarkdownStyleTokens(preset, "dark").heading1);
      disposeExportRasterHost(host);
    },
  );

  it.each(["light", "dark"] as const)(
    "keeps %s HTML and raster backgrounds consistent with the workspace",
    async (theme) => {
      const workspaceCss = readFileSync(
        resolve(process.cwd(), "src/styles/workspace.css"),
        "utf8",
      );
      const selector = theme === "dark" ? "\\.dark" : ":root";
      const canvasColor = workspaceCss.match(
        new RegExp(`${selector}\\s*\\{[^}]*--workspace-canvas:\\s*([^;]+)`),
      )?.[1];
      expect(canvasColor).toBeTruthy();
      const html = await exportToHtml("正文和==划线==\n\n> 书评", { theme });
      const { host, backgroundColor } = mountExportHtmlForRasterization(html);
      const css =
        document.getElementById(EXPORT_RASTER_STYLE_ID)?.textContent ?? "";
      expect(
        css.match(/html, body\s*\{[^}]*background-color:\s*([^;]+)/)?.[1],
      ).toBe(canvasColor);
      expect(backgroundColor).toBe(canvasColor);
      const options = buildHtml2CanvasRasterOptions({
        scale: 1,
        backgroundColor,
        renderTarget: host,
      });
      expect(options.backgroundColor).toBe(canvasColor);
      disposeExportRasterHost(host);
    },
  );

  it("injects export CSS into document.head for html2canvas", () => {
    const html = `<!DOCTYPE html><html data-theme="light"><head><style>
      .export-document .markdown-body { color: #112233; }
    </style></head><body><div class="export-document"><article class="markdown-body"><p>Hi</p></article></div></body></html>`;

    const { host } = mountExportHtmlForRasterization(html);
    const styleElement = document.getElementById(EXPORT_RASTER_STYLE_ID);

    expect(styleElement?.textContent).toContain("color: #112233");
    expect(host.querySelector("style")).toBeNull();

    disposeExportRasterHost(host);
    expect(document.getElementById(EXPORT_RASTER_STYLE_ID)).toBeNull();
  });

  it("keeps the raster host in-viewport instead of far off-screen offsets", () => {
    const html = `<!DOCTYPE html><html data-theme="light"><head><style></style></head><body><div class="export-document"><p>Hi</p></div></body></html>`;
    const { host } = mountExportHtmlForRasterization(html);

    expect(host.className).toBe(EXPORT_RASTER_HOST_CLASS);
    expect(host.style.left).toBe("0px");
    expect(host.style.top).toBe("0px");
    expect(host.style.visibility).toBe("visible");
    expect(Number.parseFloat(host.style.opacity)).toBeCloseTo(0.01, 5);

    disposeExportRasterHost(host);
  });
});

describe("revealExportRasterHostForCapture", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("restores host styles after capture", () => {
    const host = document.createElement("div");
    host.style.left = "0";
    host.style.top = "0";
    host.style.opacity = "0.01";
    host.style.visibility = "visible";
    host.style.zIndex = "-1";
    document.body.appendChild(host);

    const snapshot = revealExportRasterHostForCapture(host);
    expect(host.style.opacity).toBe("1");
    expect(host.style.zIndex).toBe("-1");

    restoreExportRasterHostStyles(host, snapshot);
    expect(host.style.opacity).toBe("0.01");
  });
});

describe("buildHtml2CanvasRasterOptions", () => {
  it("includes explicit canvas and window dimensions", () => {
    const renderTarget = document.createElement("div");
    Object.defineProperty(renderTarget, "scrollWidth", {
      value: 832,
      configurable: true,
    });
    Object.defineProperty(renderTarget, "scrollHeight", {
      value: 4200,
      configurable: true,
    });

    expect(
      buildHtml2CanvasRasterOptions({
        scale: 2,
        backgroundColor: "#ffffff",
        renderTarget,
      }),
    ).toMatchObject({
      width: 832,
      height: 4200,
      windowWidth: 832,
      windowHeight: 4200,
    });
  });
});

describe("disposeAllExportRasterArtifacts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("removes stale raster hosts and injected export styles", () => {
    const style = document.createElement("style");
    style.id = EXPORT_RASTER_STYLE_ID;
    document.head.appendChild(style);

    const host = document.createElement("div");
    host.className = EXPORT_RASTER_HOST_CLASS;
    document.body.appendChild(host);

    disposeAllExportRasterArtifacts();

    expect(document.getElementById(EXPORT_RASTER_STYLE_ID)).toBeNull();
    expect(document.querySelector(`.${EXPORT_RASTER_HOST_CLASS}`)).toBeNull();
  });

  it("keeps a newer raster session intact when an old cancelled session finishes", () => {
    const html = (color: string) =>
      `<html><head><style>.export-document { color: ${color}; }</style></head><body><div class="export-document">Visible note</div></body></html>`;
    const oldSession = mountExportHtmlForRasterization(html("red"));
    disposeAllExportRasterArtifacts();
    const newSession = mountExportHtmlForRasterization(html("blue"));
    const newStyles = document.getElementById(EXPORT_RASTER_STYLE_ID);
    expect(newStyles?.textContent).toContain("color: blue");

    disposeExportRasterHost(oldSession.host);

    expect(document.getElementById(EXPORT_RASTER_STYLE_ID)).toBe(newStyles);
    expect(newStyles?.textContent).toContain("color: blue");
    expect(document.body.contains(newSession.host)).toBe(true);
    expect(newSession.renderTarget.textContent).toBe("Visible note");
    disposeExportRasterHost(newSession.host);
    expect(document.getElementById(EXPORT_RASTER_STYLE_ID)).toBeNull();
  });
});

describe("withExportTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects when an export stage never settles", async () => {
    vi.useFakeTimers();

    const pending = expect(
      withExportTimeout(new Promise(() => {}), 1000, "stage timed out"),
    ).rejects.toThrow("stage timed out");
    await vi.advanceTimersByTimeAsync(1000);

    await pending;
  });
});
