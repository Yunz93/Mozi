import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { convertHtmlToMarkdown } from "../../../utils/htmlToMarkdown";
import { isInsideFencedCode, isInsideFrontmatter } from "./core";

/**
 * Convert clipboard HTML to Markdown when the setting is on.
 * Skip fenced code / frontmatter so a literal `\` paste is not rewritten.
 */
export function tryConvertHtmlPaste(
  view: EditorView,
  event: ClipboardEvent,
): boolean {
  const html = event.clipboardData?.getData("text/html")?.trim();
  if (!html) return false;

  const selection = view.state.selection.main;
  if (
    isInsideFencedCode(view.state, selection.from) ||
    isInsideFrontmatter(view.state, selection.from)
  ) {
    return false;
  }

  const markdownText = convertHtmlToMarkdown(html);
  if (!markdownText) return false;

  event.preventDefault();
  view.dispatch(
    view.state.update({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: markdownText,
      },
      selection: EditorSelection.cursor(selection.from + markdownText.length),
      scrollIntoView: true,
      userEvent: "input.paste",
    }),
  );
  return true;
}
