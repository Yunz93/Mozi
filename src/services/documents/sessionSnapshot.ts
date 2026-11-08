/** Read-only single-document contract over the existing buffer storage.
 * No third copy of the text/history is introduced. Legacy map-shaped adapters
 * remain inside storage/attachment APIs while application workflows use this view.
 */
export interface DocumentSession {
  documentId: string;
  path: string | null;
  vaultRoot: string | null;
  content: string | undefined;
  savedContent: string | undefined;
  revision: number;
}
export interface DocumentSessionState {
  activeTabId: string | null;
  currentFilePath: string | null;
  rootFolderPath: string | null;
  fileContents: Record<string, string>;
  lastSavedContent: Record<string, string>;
}
export type DocumentSessionToken = Pick<
  DocumentSession,
  "documentId" | "path" | "vaultRoot" | "revision"
>;
let revision = 0;
const revisions = new WeakMap<object, number>();
const sessions = new WeakMap<object, DocumentSession | null>();
export function selectDocumentSession(
  state: DocumentSessionState,
): DocumentSession | null {
  if (!state.activeTabId) return null;
  // Each immutable text buffer has a stable runtime revision, including edits
  // followed by undo to the same text. Revisions are never persisted.
  let currentRevision = revisions.get(state.fileContents);
  if (currentRevision === undefined) {
    currentRevision = ++revision;
    revisions.set(state.fileContents, currentRevision);
  }
  const previous = sessions.get(state.fileContents);
  const savedContent = state.lastSavedContent[state.activeTabId];
  if (
    previous?.documentId === state.activeTabId &&
    previous.path === state.currentFilePath &&
    previous.vaultRoot === state.rootFolderPath &&
    previous.savedContent === savedContent
  )
    return previous;
  const session = {
    documentId: state.activeTabId,
    path: state.currentFilePath,
    vaultRoot: state.rootFolderPath,
    content: state.fileContents[state.activeTabId],
    savedContent,
    revision: currentRevision,
  };
  sessions.set(state.fileContents, session);
  return session;
}
export function matchesDocumentSession(
  state: DocumentSessionState,
  token: DocumentSessionToken,
  requireRevision = false,
): boolean {
  const current = selectDocumentSession(state);
  return (
    !!current &&
    current.documentId === token.documentId &&
    current.path === token.path &&
    current.vaultRoot === token.vaultRoot &&
    (!requireRevision || current.revision === token.revision)
  );
}

export function captureDocumentSession(
  state: DocumentSessionState,
): DocumentSessionToken | undefined {
  const session = selectDocumentSession(state);
  if (!session) return undefined;
  const { documentId, path, vaultRoot, revision } = session;
  return { documentId, path, vaultRoot, revision };
}
