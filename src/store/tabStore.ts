/**
 * Document buffer state (single open document).
 * `openTabs` is kept as a 0-or-1 array so path remaps and legacy call sites
 * stay simple; multi-document tabs are no longer supported.
 */
export interface TabState {
  openTabs: string[]; // At most one file id
  activeTabId: string | null;
  fileContents: Record<string, string>;
  lastSavedContent: Record<string, string>;
}

/**
 * Document buffer actions
 */
export interface TabActions {
  /** Open (or re-activate) a single document, replacing any previous buffer. */
  addTab: (fileId: string, content?: string) => void;
  closeTab: (fileId: string) => void;
  setActiveTab: (fileId: string) => void;
  activateTab: (fileId: string, filePath: string | null) => void;
  /**
   * Update a file's content WITHOUT recording undo history. `fileContents`
   * is the single source of truth for editor content (FileNode no longer
   * carries a `content` field). Use editor `setContent`/`setContentForFile`
   * when the change should be undoable.
   */
  updateTabContent: (fileId: string, content: string) => void;
  getActiveContent: () => string | undefined;
  clearAllCache: () => void;
  markAsSaved: (fileId: string, savedContent?: string) => void;
  hasUnsavedChanges: (fileId: string) => boolean;
}

/**
 * Initial document buffer state
 */
export const initialTabState: TabState = {
  openTabs: [],
  activeTabId: null,
  fileContents: {},
  lastSavedContent: {},
};

type TabSliceState = TabState & {
  fileHistories?: Record<string, unknown>;
  currentFilePath?: string | null;
};

/**
 * Create document buffer store slice
 */
export function createTabSlice(
  set: (fn: (state: TabSliceState) => Partial<TabSliceState>) => void,
  get: () => TabState & TabActions,
): TabState & TabActions {
  return {
    ...initialTabState,

    addTab: (fileId, content) =>
      set((state) => {
        const alreadyActive =
          state.activeTabId === fileId &&
          state.openTabs.length === 1 &&
          state.openTabs[0] === fileId;

        if (alreadyActive) {
          if (content === undefined) {
            return {};
          }
          return {
            fileContents: { [fileId]: content },
            lastSavedContent: {
              ...state.lastSavedContent,
              [fileId]: content,
            },
          };
        }

        const nextContent =
          content !== undefined ? content : state.fileContents[fileId];
        const nextSaved =
          content !== undefined ? content : state.lastSavedContent[fileId];

        const nextFileContents =
          nextContent !== undefined ? { [fileId]: nextContent } : {};
        const nextLastSavedContent =
          nextSaved !== undefined ? { [fileId]: nextSaved } : {};
        const existingHistory = state.fileHistories?.[fileId];
        const nextFileHistories =
          existingHistory !== undefined ? { [fileId]: existingHistory } : {};

        return {
          openTabs: [fileId],
          activeTabId: fileId,
          fileContents: nextFileContents,
          lastSavedContent: nextLastSavedContent,
          fileHistories: nextFileHistories,
        };
      }),

    closeTab: (fileId) =>
      set((state) => {
        if (!state.openTabs.includes(fileId) && state.activeTabId !== fileId) {
          return {};
        }

        return {
          openTabs: [],
          activeTabId: null,
          fileContents: {},
          lastSavedContent: {},
          fileHistories: {},
        };
      }),

    setActiveTab: (fileId) =>
      set((state) => {
        // Settings and other UI should not open documents via this path.
        // Document opens go through addTab (replace-on-open).
        if (state.activeTabId !== fileId && !state.openTabs.includes(fileId)) {
          return {};
        }
        return {
          activeTabId: fileId,
          openTabs: [fileId],
        };
      }),

    activateTab: (fileId, filePath) =>
      set((state) => {
        if (state.activeTabId !== fileId && !state.openTabs.includes(fileId)) {
          return {};
        }
        return {
          activeTabId: fileId,
          openTabs: [fileId],
          currentFilePath: filePath,
        };
      }),

    updateTabContent: (fileId, content) =>
      set((state) => {
        // Ignore writes for documents that are not the open buffer.
        if (state.activeTabId && state.activeTabId !== fileId) {
          return {};
        }
        return {
          fileContents: { ...state.fileContents, [fileId]: content },
        };
      }),

    getActiveContent: () => {
      const state = get();
      if (!state.activeTabId) return undefined;
      return state.fileContents[state.activeTabId];
    },

    clearAllCache: () =>
      set(() => ({
        fileContents: {},
        lastSavedContent: {},
        openTabs: [],
        activeTabId: null,
        fileHistories: {},
      })),

    markAsSaved: (fileId, savedContent) =>
      set((state) => {
        const content = savedContent ?? state.fileContents[fileId];
        if (content === undefined) return {};
        return {
          lastSavedContent: { ...state.lastSavedContent, [fileId]: content },
        };
      }),

    hasUnsavedChanges: (fileId) => {
      const state = get();
      const content = state.fileContents[fileId];
      const saved = state.lastSavedContent[fileId];
      if (content === undefined) return false;
      return content !== saved;
    },
  };
}
