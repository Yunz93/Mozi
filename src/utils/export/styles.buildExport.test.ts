import { describe, it, expect } from "vitest";
import {
  buildExportDocument,
  buildExportStyles,
  extractGithubMarkdownThemeVars,
} from "./styles";

describe("buildExportStyles", () => {
  it("removes github-markdown h2 bottom border in export body", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body h2\s*\{[^}]*border-bottom:\s*none/m,
    );
  });

  it("matches preview heading font-size scale in export body", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body h1\s*\{[^}]*font-size:\s*1\.6em;/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body h2\s*\{[^}]*font-size:\s*1\.35em;/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body h3\s*\{[^}]*font-size:\s*1\.2em;/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body h4\s*\{[^}]*font-size:\s*1\.05em;/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body h5\s*\{[^}]*font-size:\s*0\.95em;/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body h6\s*\{[^}]*font-size:\s*0\.9em;/m,
    );
  });

  it("includes explicit list markers for export body (matches preview pane)", () => {
    const css = buildExportStyles("light");
    expect(css).toContain(".export-document .markdown-body ul");
    expect(css).toMatch(
      /\.export-document \.markdown-body ul\s*\{[^}]*list-style:\s*disc/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body ol\s*\{[^}]*list-style:\s*decimal/m,
    );
  });

  it("gives nested lists enough padding-left so guide border does not overlap ol markers", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body li > ul\s*,\s*\.export-document \.markdown-body li > ol\s*\{[^}]*padding-left:\s*2rem/m,
    );
  });

  it("tightens li > p margins like preview (avoids misaligned html2canvas list markers)", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body li > p\s*\{[^}]*margin-top:\s*0\.15em/m,
    );
    expect(css).toMatch(
      /\.mp-export-raster-list li > p:first-child\s*\{[^}]*display:\s*inline/m,
    );
    expect(css).toMatch(/list-style-position:\s*inside/);
  });

  it("includes raster inline-code chunk styles for html2canvas", () => {
    const css = buildExportStyles("light");
    // var() references are resolved for html2canvas compatibility;
    // background value must be a concrete colour, not a var() placeholder.
    expect(css).toMatch(
      /\.mp-export-raster-code-chunk\s*\{[^}]*background:\s*#[0-9a-fA-F]{3,8}/m,
    );
    expect(css).toMatch(
      /code\.mp-export-raster-code\s*\{[^}]*background:\s*transparent/m,
    );
  });

  it("draws del and s with native line-through like preview", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body del\s*,\s*\.export-document \.markdown-body s\s*\{[^}]*text-decoration:\s*line-through/m,
    );
    const delBlock = css.match(
      /\.export-document \.markdown-body del\s*,\s*\.export-document \.markdown-body s\s*\{[^}]*\}/,
    );
    expect(delBlock?.[0]).toBeDefined();
    expect(delBlock![0]).not.toContain("linear-gradient");
  });

  it("draws ins and u with a background line instead of html2canvas text-decoration", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body ins\s*,\s*\.export-document \.markdown-body u\s*\{[^}]*text-decoration:\s*none/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body ins\s*,\s*\.export-document \.markdown-body u\s*\{[^}]*background-image:\s*linear-gradient\(currentColor,\s*currentColor\)/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body ins\s*,\s*\.export-document \.markdown-body u\s*\{[^}]*background-position:\s*0 88%/m,
    );
  });

  it("scopes export theme colors to .export-document[data-theme] for off-screen rasterization", () => {
    const css = buildExportStyles("light");
    // var() references are resolved for html2canvas compatibility. Overrides
    // must target the modern github-markdown-css names (--fgColor-*), not the
    // legacy --color-fg-* names which no longer exist.
    expect(css).toMatch(
      /\.export-document\[data-theme="light"\] \.markdown-body\s*\{[^}]*--fgColor-default:\s*#[0-9a-fA-F]{3,8}/m,
    );
    expect(css).toMatch(
      /\.export-document\[data-theme="dark"\] \.markdown-body\s*\{[^}]*--fgColor-default:\s*#[0-9a-fA-F]{3,8}/m,
    );
    expect(css).toMatch(/\.export-document \{\s*[^}]*--mp-doc-text:/m);
    expect(css).not.toMatch(/html\.dark \.export-document/);
    expect(css).not.toMatch(/html:not\(\.dark\) \.export-document/);
  });

  it("bakes github-markdown theme variables so raster export ignores the OS color scheme", () => {
    for (const theme of ["light", "dark"] as const) {
      const css = buildExportStyles(theme);
      // Every github var() reference used by style rules must resolve to a
      // concrete value; html2canvas cannot resolve custom properties and the
      // OS prefers-color-scheme may not match the export theme.
      expect(css).not.toContain("var(--fgColor-default)");
      expect(css).not.toContain("var(--borderColor-default)");
      expect(css).not.toContain("var(--bgColor-muted)");
      expect(css).not.toContain("var(--base-size-16)");
      expect(css).not.toContain("var(--fontStack-monospace)");
    }
  });

  it("embeds export theme on .export-document for raster selectors", () => {
    const markup = buildExportDocument("<p>Hi</p>", "", "nord", "dark");
    expect(markup).toContain('data-theme="dark"');
  });

  it("resolves markdown theme css variables for html2canvas raster export", () => {
    const css = buildExportStyles(
      "light",
      undefined,
      16,
      "",
      undefined,
      14,
      "nord",
    );
    expect(css.match(/var\(--mp-doc-[^)]+\)/g) ?? []).toEqual([]);
  });

  it("matches preview attachment image decoration in export CSS", () => {
    const lightCss = buildExportStyles("light");
    const darkCss = buildExportStyles("dark");

    expect(lightCss).toMatch(
      /\.export-document \.markdown-body \.preview-attachment-image\s*\{[^}]*border-radius:\s*1rem/m,
    );
    expect(lightCss).toMatch(
      /\.export-document \.markdown-body \.preview-attachment-image\s*\{[^}]*box-shadow:\s*0 16px 40px/m,
    );
    expect(darkCss).toMatch(
      /\.export-document \.markdown-body \.preview-attachment-image\s*\{[^}]*box-shadow:\s*0 20px 44px rgba\(0,\s*0,\s*0,\s*0\.3\)/m,
    );
    expect(lightCss).toMatch(
      /img\.preview-attachment-image\[data-wiki-embed-w\][\s\S]*?attr\(data-wiki-embed-w px,\s*100%\)/m,
    );
  });

  it("matches preview Shiki line-height and wrapper styles in export CSS", () => {
    const css = buildExportStyles("light");

    expect(css).toMatch(
      /\.export-document \.markdown-body pre\.shiki \.line[\s\S]*?line-height:\s*1\.75/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body \.mp-shiki-block\s*\{/,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body pre\.shiki[\s\S]*?clip-path:\s*inset\(0 round 1rem\)/m,
    );
  });

  it("gives the Shiki wrapper the code background lost to the transparent pre override", () => {
    const css = buildExportStyles("light");
    const block = css.match(
      /\.export-document \.markdown-body \.mp-shiki-block\s*\{[^}]*\}/,
    );
    expect(block?.[0]).toBeDefined();
    expect(block![0]).toMatch(/background:\s*#[0-9a-fA-F]{3,8}/);
  });

  it("keeps source blank-line spacing so shared images match the preview rhythm", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body \.preview-source-blank-line\s*\{[^}]*height:\s*1\.95em/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body > :has\(\+ \.preview-source-blank-line\)\s*\{[^}]*margin-bottom:\s*0/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body \.preview-source-blank-line \+ \*\s*\{[^}]*margin-top:\s*0/m,
    );
  });

  it("matches preview paragraph rhythm and inline-code line-height", () => {
    const css = buildExportStyles("light");
    expect(css).toMatch(
      /\.export-document \.markdown-body p\s*\{[^}]*margin-bottom:\s*1em/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body code\s*\{[^}]*line-height:\s*1\.35/m,
    );
    expect(css).toMatch(
      /\.export-document \.markdown-body pre\s*\{[^}]*margin:\s*1\.95em 0/m,
    );
  });

  it("uses a single preview-like padding layer instead of double padding", () => {
    const css = buildExportStyles("light");
    const docBlock = css.match(/\.export-document\s*\{[^}]*\}/);
    expect(docBlock?.[0]).toContain("padding: 44px 40px 72px");
    const bodyBlock = css.match(
      /\.export-document \.markdown-body\s*\{[^}]*\}/,
    );
    expect(bodyBlock?.[0]).toMatch(/padding:\s*0/);
  });

  it("mirrors preview Mermaid container styling and nested-SVG guards", () => {
    const lightCss = buildExportStyles("light");
    const darkCss = buildExportStyles("dark");

    expect(lightCss).toMatch(
      /\.export-document \.markdown-body \.mermaid\s*\{[^}]*padding:\s*1\.5em/m,
    );
    expect(lightCss).toMatch(
      /\.export-document \.markdown-body \.mermaid\s*\{[^}]*background:\s*rgba\(128, 128, 128, 0\.05\)/m,
    );
    expect(darkCss).toMatch(
      /\.export-document \.markdown-body \.mermaid\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.05\)/m,
    );
    expect(lightCss).toMatch(
      /\.export-document \.markdown-body \.mermaid svg\s*\{[^}]*max-width:\s*none !important/m,
    );
    expect(lightCss).toMatch(
      /\.export-document \.markdown-body \.mermaid svg svg\s*\{[^}]*width:\s*auto !important/m,
    );
    expect(lightCss).toMatch(
      /\.export-document \.markdown-body \.mermaid > svg\s*\{[^}]*max-width:\s*100% !important/m,
    );
  });

  it("aligns hr color with the preview border token", () => {
    const css = buildExportStyles("light");
    const hrBlock = css.match(
      /\.export-document \.markdown-body hr\s*\{[^}]*\}/,
    );
    expect(hrBlock?.[0]).toBeDefined();
    expect(hrBlock![0]).toMatch(
      /background-color:\s*(#[0-9a-fA-F]{3,8}|rgba?\()/,
    );
    expect(hrBlock![0]).not.toContain("var(");
  });
});

describe("extractGithubMarkdownThemeVars", () => {
  const sampleCss = `
.markdown-body {
  --base-size-16: 1rem;
  --fontStack-monospace: ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) {
  .markdown-body, [data-theme="dark"] {
    --fgColor-default: #f0f6fc;
    --borderColor-default: #3d444d;
  }
}
@media (prefers-color-scheme: light) {
  .markdown-body, [data-theme="light"] {
    --fgColor-default: #1f2328;
    --borderColor-default: #d1d9e0;
  }
}
.markdown-body { color: var(--fgColor-default); }
`;

  it("returns base tokens plus the block matching the requested theme", () => {
    const light = extractGithubMarkdownThemeVars(sampleCss, "light");
    expect(light["--base-size-16"]).toBe("1rem");
    expect(light["--fontStack-monospace"]).toBe("ui-monospace, monospace");
    expect(light["--fgColor-default"]).toBe("#1f2328");
    expect(light["--borderColor-default"]).toBe("#d1d9e0");

    const dark = extractGithubMarkdownThemeVars(sampleCss, "dark");
    expect(dark["--fgColor-default"]).toBe("#f0f6fc");
    expect(dark["--borderColor-default"]).toBe("#3d444d");
  });
});
