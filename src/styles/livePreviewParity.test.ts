import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("live preview / reading visual parity", () => {
  const editorCss = readFileSync(
    resolve(process.cwd(), "src/styles/editor.css"),
    "utf8",
  );

  it("insets live block widgets to --pane-content-px like Reading padding", () => {
    expect(editorCss).toMatch(
      /\.cm-live-preview-callout,[\s\S]*?\.cm-live-preview-math-display\s*\{[^}]*margin-inline:\s*var\(--pane-content-px\)/,
    );
  });

  it("clips blockquote fill to the text column instead of full-bleed inset shadow", () => {
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-blockquote\s*\{[^}]*padding-left:\s*calc\(\s*var\(--pane-content-px\)\s*\+\s*var\(--mp-live-quote-inline-pad\)\)/s,
    );
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-blockquote\s*\{[^}]*background-position:\s*var\(--pane-content-px\)/s,
    );
    expect(editorCss).toMatch(
      /\.cm-live-preview-blockquote::before\s*\{[^}]*left:\s*var\(--pane-content-px\)/s,
    );
  });

  it("paints fenced code chrome in the text column instead of clipping the line", () => {
    expect(editorCss).toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*left:\s*var\(--pane-content-px\)/s,
    );
    expect(editorCss).toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*right:\s*var\(--pane-content-px\)/s,
    );
    expect(editorCss).not.toMatch(/\.cm-fenced-code-line\s*\{[^}]*clip-path:/s);
  });

  it("centers live mermaid diagrams in the text column", () => {
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-mermaid\s*\{[^}]*width:\s*fit-content/s,
    );
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-mermaid\s*\{[^}]*max-width:\s*calc\(100% - 2 \* var\(--pane-content-px\)\)/s,
    );
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-mermaid\s+\.mermaid\s*\{[^}]*justify-content:\s*center/s,
    );
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-mermaid\s+\.mermaid\s+>\s+svg\s*\{[^}]*margin-inline:\s*auto/s,
    );
  });

  it("uses the same heading weight as Reading for h3–h6", () => {
    for (const level of [3, 4, 5, 6]) {
      expect(editorCss).toMatch(
        new RegExp(
          `mp-tok-heading-${level}\\s*\\{[^}]*font-weight:\\s*var\\(--mp-doc-heading-weight,\\s*700\\)`,
        ),
      );
      expect(editorCss).not.toMatch(
        new RegExp(
          `\\[data-live-preview="true"\\][^{]*mp-tok-heading-${level}\\s*\\{[^}]*font-weight:\\s*var\\(--mp-doc-heading-weight,\\s*650\\)`,
        ),
      );
    }
  });

  it("keeps KaTeX from inheriting live line wrapping", () => {
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-math\s+\.katex\s+\*\s*\{[^}]*word-break:\s*normal\s*!important/s,
    );
  });
});
