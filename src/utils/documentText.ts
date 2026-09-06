/**
 * Compare Markdown buffers the way the editor actually stores them.
 * CodeMirror's `doc.toString()` always emits `\n`, while disk / last-saved
 * snapshots may still carry CRLF or a UTF-8 BOM from the original file.
 */
export function normalizeTextForCompare(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function sameDocumentText(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return normalizeTextForCompare(left) === normalizeTextForCompare(right);
}
