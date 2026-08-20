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

  it("draws a continuous live-preview link underline through URL punctuation", () => {
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\][\s\S]*?\.cm-md-link-dest\s*\{[^}]*text-decoration-skip-ink:\s*none/s,
    );
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\][\s\S]*?\.cm-md-link-dest\s*\{[^}]*text-decoration-skip:\s*none/s,
    );
    const theme = readFileSync(
      resolve(
        process.cwd(),
        "src/components/editor/livePreview/hideFormattingMarks.ts",
      ),
      "utf8",
    );
    expect(theme).toMatch(
      /\.cm-live-preview-link":\s*\{[^}]*textDecorationSkipInk:\s*"none"/s,
    );
  });

  it("indents inactive nested live list lines beyond the parent marker", () => {
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-list-level-2\s*\{[^}]*padding-left:\s*calc\(\s*var\(--pane-content-px\)\s*\+\s*var\(--mp-live-list-step\)/s,
    );
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-list-line\.is-nested::before\s*\{[^}]*background:\s*var\(--mp-doc-border/s,
    );
  });

  it("does not shrink live mermaid diagrams to the text column", () => {
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\]\s+\.cm-live-preview-mermaid\s*\{[^}]*overflow-x:\s*auto/s,
    );
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\][\s\S]*?\.cm-live-preview-mermaid[\s\S]*?\.mermaid\s*>\s*svg\s*\{[^}]*max-width:\s*none !important/s,
    );
  });

  it("uses the Reading code-block fill for live/source fences", () => {
    expect(editorCss).toMatch(
      /--editor-code-block-bg:\s*var\(--mp-doc-code-bg/,
    );
    expect(editorCss).toMatch(
      /\.cm-fenced-code-line\s*\{[^}]*isolation:\s*isolate/s,
    );
    expect(editorCss).toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*background-color:\s*var\(--editor-code-block-bg\)/s,
    );
    expect(editorCss).toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*z-index:\s*-1/s,
    );
    expect(editorCss).not.toMatch(
      /\.cm-fenced-code-line::before\s*\{[^}]*color-mix\([^)]*--editor-code-block-bg/s,
    );
    expect(editorCss).toMatch(
      /\.cm-fenced-code-line \.tok-inline-code[\s\S]*?background:\s*none/s,
    );
  });

  it("underlines live URL tokens like markdown links", () => {
    expect(editorCss).toMatch(
      /\[data-live-preview="true"\] \.tok-link,[\s\S]*?\[data-live-preview="true"\] \.tok-url,/s,
    );
  });
});
