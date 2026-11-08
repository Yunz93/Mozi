import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect } from "react";
import { useAppStore, selectContent } from "../store/appStore";
import {
  getActiveEditorView,
  redoInActiveEditor,
  undoInActiveEditor,
} from "../utils/editorSelectionBridge";

/**
 * Global undo/redo wiring.
 *
 * The editor's CodeMirror history is the single source of truth whenever an
 * editor view is focused: Ctrl+Z inside the editor is handled by CodeMirror.
 * When focus is outside the editor, this hook routes to CodeMirror first and
 * falls back to store-level history if CM has nothing to undo (e.g. content
 * changed via AI apply while the editor was not focused).
 *
 * Per-tab CodeMirror history is preserved across tab switches via the editor
 * state cache in useCodeMirror, so remounting is no longer required.
 */
export function useUndoRedo() {
  const { undo, redo, canUndo, canRedo, activeTabId, fileHistories } =
    useAppStore(
      useShallow((state) => ({
        undo: state.undo,
        redo: state.redo,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        activeTabId: state.activeTabId,
        fileHistories: state.fileHistories,
      })),
    );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      // Focus inside the editor: CodeMirror's own history keymap handles it.
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.closest(".cm-editor")) return;

      const isMod = e.ctrlKey || e.metaKey;

      if (!isMod || !activeTabId) return;

      // Undo: Ctrl+Z or Cmd+Z (not Shift+Z for redo)
      if (e.key === "z" && !e.shiftKey) {
        if (getActiveEditorView()) {
          e.preventDefault();
          if (!undoInActiveEditor() && canUndo()) {
            undo();
          }
        } else if (canUndo()) {
          e.preventDefault();
          undo();
        }
      }
      // Redo: Ctrl+Shift+Z or Cmd+Shift+Z, or Ctrl+Y
      else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        if (getActiveEditorView()) {
          e.preventDefault();
          if (!redoInActiveEditor() && canRedo()) {
            redo();
          }
        } else if (canRedo()) {
          e.preventDefault();
          redo();
        }
      }
    },
    [undo, redo, canUndo, canRedo, activeTabId],
  );

  // Set up global keyboard listener
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const history = activeTabId ? fileHistories[activeTabId] : undefined;

  return {
    canUndo: Boolean(history && history.past.length > 0),
    canRedo: Boolean(history && history.future.length > 0),
    undo,
    redo,
  };
}

/**
 * Hook for tracking content history stats per file
 */
export function useHistoryStats() {
  const activeTabId = useAppStore((state) => state.activeTabId);
  const fileHistories = useAppStore((state) => state.fileHistories);
  const content = useAppStore(selectContent);

  const history = activeTabId ? fileHistories[activeTabId] : undefined;

  return {
    pastLength: history?.past.length ?? 0,
    futureLength: history?.future.length ?? 0,
    maxHistory: history?.maxHistory ?? 100,
    currentContentLength: content.length,
  };
}
