/**
 * True when the app is showing one or more files without an open vault root —
 * typically after launching by double-clicking a Markdown/Excalidraw file in
 * the system file browser.
 */
export function isStandaloneDocumentSession(
  rootFolderPath: string | null | undefined,
  filesLen: number,
): boolean {
  return !rootFolderPath?.trim() && filesLen > 0;
}
