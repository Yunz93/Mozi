import { ViewMode } from "../types";
import {
  normalizeSessionViewMode,
  resolveLastNonSplitViewMode,
  type NonSplitViewMode,
} from "../utils/viewMode";

// History state for undo/redo per file
export interface HistoryState {
  past: string[];
  future: string[];
  maxHistory: number;
}

/**
 * Editor store state interface
 * Note: `content` is NOT stored here. It is derived from
 * `fileContents[activeTabId]` via the `selectContent` selector.
 *
 * History is keyed by fileId so undo state is cleared when the open
 * document is replaced (single-document editing).
 */
export interface EditorState {
  viewMode: ViewMode;
  lastNonSplitViewMode: NonSplitViewMode;
  lastViewModeChangeSource: "direct" | "toggle";
  /** Mode to restore after leaving a preview-only file (PDF/image/HTML). */
  viewModeBeforePreviewOnly: ViewMode | null;
  fileHistories: Record<string, HistoryState>; // Per open document
}

/**
 * Editor store actions interface
 */
export interface EditorActions {
  setContent: (content: string, skipHistory?: boolean) => void;
  setContentForFile: (
    fileId: string,
    content: string,
    skipHistory?: boolean,
  ) => void;
  setViewMode: (mode: ViewMode, source?: "direct" | "toggle") => void;
  setViewModeBeforePreviewOnly: (mode: ViewMode | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

/**
 * Initial editor state
 */
export const initialEditorState: EditorState = {
  viewMode: ViewMode.LIVE,
  lastNonSplitViewMode: ViewMode.LIVE,
  lastViewModeChangeSource: "direct",
  viewModeBeforePreviewOnly: null,
  fileHistories: {}, // Initialize as empty object, histories created per file
};

// Combined type needed by the slice to access fileContents + activeTabId
interface EditorSliceContext {
  activeTabId: string | null;
  fileContents: Record<string, string>;
  updateTabContent: (fileId: string, content: string) => void;
}

/**
 * Selector: derive current content from fileContents[activeTabId].
 * Use this instead of reading `state.content` directly.
 */
export function selectContent(state: EditorState & EditorSliceContext): string {
  return state.activeTabId ? (state.fileContents[state.activeTabId] ?? "") : "";
}

/**
 * Create editor store slice
 */
export function createEditorSlice(
  set: (
    fn: (
      state: EditorState & EditorSliceContext,
    ) => Partial<EditorState & EditorSliceContext>,
  ) => void,
  get: () => EditorState & EditorActions & EditorSliceContext,
): EditorState & EditorActions {
  const buildContentUpdate = (
    state: EditorState & EditorSliceContext,
    fileId: string | null,
    content: string,
    skipHistory: boolean,
  ): Partial<EditorState & EditorSliceContext> => {
    if (!fileId) return {};

    const current = state.fileContents[fileId] ?? "";

    if (current === content) return {};

    if (skipHistory) {
      return {
        fileContents: { ...state.fileContents, [fileId]: content },
      };
    }

    const existingHistory = state.fileHistories[fileId] || {
      past: [],
      future: [],
      maxHistory: 100,
    };
    const newPast = [...existingHistory.past, current];
    const trimmedPast =
      newPast.length > existingHistory.maxHistory
        ? newPast.slice(-existingHistory.maxHistory)
        : newPast;

    return {
      fileContents: { ...state.fileContents, [fileId]: content },
      fileHistories: {
        ...state.fileHistories,
        [fileId]: {
          ...existingHistory,
          past: trimmedPast,
          future: [],
        },
      },
    };
  };

  return {
    ...initialEditorState,

    setContent: (content, skipHistory = false) =>
      set((state) =>
        buildContentUpdate(state, state.activeTabId, content, skipHistory),
      ),

    setContentForFile: (fileId, content, skipHistory = false) =>
      set((state) => buildContentUpdate(state, fileId, content, skipHistory)),

    setViewMode: (mode, source = "direct") =>
      set(() => {
        const normalized = normalizeSessionViewMode(mode);
        return {
          viewMode: normalized,
          lastNonSplitViewMode: resolveLastNonSplitViewMode(normalized),
          lastViewModeChangeSource: source,
        };
      }),

    setViewModeBeforePreviewOnly: (mode) =>
      set(() => ({
        viewModeBeforePreviewOnly:
          mode === null ? null : normalizeSessionViewMode(mode),
      })),

    undo: () =>
      set((state) => {
        const { activeTabId, fileContents, fileHistories } = state;
        if (!activeTabId) return {};

        const history = fileHistories[activeTabId];
        if (!history || history.past.length === 0) return {};

        const { past, future, maxHistory } = history;
        const current = fileContents[activeTabId] ?? "";
        const previous = past[past.length - 1];
        const newPast = past.slice(0, -1);

        return {
          fileContents: { ...fileContents, [activeTabId]: previous },
          fileHistories: {
            ...fileHistories,
            [activeTabId]: {
              past: newPast,
              future: [current, ...future],
              maxHistory,
            },
          },
        };
      }),

    redo: () =>
      set((state) => {
        const { activeTabId, fileContents, fileHistories } = state;
        if (!activeTabId) return {};

        const history = fileHistories[activeTabId];
        if (!history || history.future.length === 0) return {};

        const { past, future, maxHistory } = history;
        const current = fileContents[activeTabId] ?? "";
        const next = future[0];
        const newFuture = future.slice(1);

        return {
          fileContents: { ...fileContents, [activeTabId]: next },
          fileHistories: {
            ...fileHistories,
            [activeTabId]: {
              past: [...past, current],
              future: newFuture,
              maxHistory,
            },
          },
        };
      }),

    canUndo: () => {
      const state = get();
      const history = state.fileHistories[state.activeTabId || ""];
      return Boolean(history && history.past.length > 0);
    },

    canRedo: () => {
      const state = get();
      const history = state.fileHistories[state.activeTabId || ""];
      return Boolean(history && history.future.length > 0);
    },

    clearHistory: () =>
      set((state) => ({
        fileHistories: {}, // Clear all file histories
      })),
  };
}
