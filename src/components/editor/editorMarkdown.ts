import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { LanguageSupport } from "@codemirror/language";
import type { MarkdownExtension } from "@lezer/markdown";
import { resolveEditorCodeLanguage } from "../../utils/editorCodeLanguages";

/**
 * Disable Lezer setext headings (`foo\n---` / `foo\n-`).
 *
 * Matches markdown-it's `md.disable("lheading")`: a mid-edit list marker
 * (`-` after a paragraph, before space and item text) must not restyle the
 * previous line as an H2.
 */
export const disableSetextHeading: MarkdownExtension = {
  remove: ["SetextHeading"],
};

export function createEditorMarkdownLanguage(): LanguageSupport {
  return markdown({
    base: markdownLanguage,
    codeLanguages: resolveEditorCodeLanguage,
    extensions: disableSetextHeading,
  });
}
