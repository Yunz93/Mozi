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
  // 保持编辑中间态稳定：
  // - 关闭 setext 标题（`foo\n---` / `foo\n-`），避免输入分隔线时上一行突然变成 H2
  // - 关闭下标/上标解析，让 Live 与 Preview 一致（Preview 端的 markdown-it 本来就不渲染它们）
  remove: ["SetextHeading", "Subscript", "Superscript"],
};

export function createEditorMarkdownLanguage(): LanguageSupport {
  return markdown({
    base: markdownLanguage,
    codeLanguages: resolveEditorCodeLanguage,
    extensions: disableSetextHeading,
  });
}
