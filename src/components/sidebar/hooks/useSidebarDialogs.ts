import { useState, useCallback } from 'react';
import type { FileNode } from '../../../types';
import { useAppStore } from '../../../store/appStore';
import { t } from '../../../utils/i18n';

export type DialogType =
  | 'newFile'
  | 'newDrawing'
  | 'rename'
  | 'newFolder'
  | 'delete'
  | 'emptyTrash'
  | null;

export interface DialogState {
  type: DialogType;
  file?: FileNode;
  defaultValue?: string;
}

export interface UseSidebarDialogsOptions {
  onCreateFile?: (folder: FileNode | undefined, name: string) => void;
  onCreateDrawing?: (folder: FileNode | undefined, name: string) => void;
  onRename?: (file: FileNode, name: string) => void;
  onNewFolder?: (folder: FileNode | undefined, name: string) => void;
  onDelete?: (file: FileNode) => void;
  onEmptyTrash?: (items: FileNode[]) => void;
}

export interface UseSidebarDialogsReturn {
  dialogState: DialogState;
  setDialogState: (state: DialogState) => void;
  openNewFileDialog: (folder?: FileNode, defaultValue?: string) => void;
  openNewDrawingDialog: (folder?: FileNode, defaultValue?: string) => void;
  openRenameDialog: (file: FileNode, defaultValue?: string) => void;
  openNewFolderDialog: (folder?: FileNode) => void;
  openDeleteDialog: (file: FileNode) => void;
  openEmptyTrashDialog: () => void;
  closeDialog: () => void;
  handleNewFileConfirm: (folder: FileNode | undefined, value: string) => void;
  handleNewDrawingConfirm: (folder: FileNode | undefined, value: string) => void;
  handleRenameConfirm: (file: FileNode | undefined, value: string) => void;
  handleNewFolderConfirm: (folder: FileNode | undefined, value: string) => void;
  handleDeleteConfirm: (file: FileNode | undefined) => void;
  handleEmptyTrashConfirm: (items: FileNode[]) => void;
}

export function useSidebarDialogs(options: UseSidebarDialogsOptions): UseSidebarDialogsReturn {
  const {
    onCreateFile,
    onCreateDrawing,
    onRename,
    onNewFolder,
    onDelete,
    onEmptyTrash,
  } = options;
  const [dialogState, setDialogState] = useState<DialogState>({ type: null });

  const closeDialog = useCallback(() => {
    setDialogState({ type: null });
  }, []);

  const openNewFileDialog = useCallback((folder?: FileNode, defaultValue = t(useAppStore.getState().settings.language, 'app_untitled')) => {
    setDialogState({ type: 'newFile', file: folder, defaultValue });
  }, []);

  const openNewDrawingDialog = useCallback((folder?: FileNode, defaultValue = t(useAppStore.getState().settings.language, 'app_untitledDrawing')) => {
    setDialogState({ type: 'newDrawing', file: folder, defaultValue });
  }, []);

  const openRenameDialog = useCallback((file: FileNode, defaultValue?: string) => {
    setDialogState({ type: 'rename', file, defaultValue });
  }, []);

  const openNewFolderDialog = useCallback((folder?: FileNode) => {
    setDialogState({ type: 'newFolder', file: folder });
  }, []);

  const openDeleteDialog = useCallback((file: FileNode) => {
    setDialogState({ type: 'delete', file });
  }, []);

  const openEmptyTrashDialog = useCallback(() => {
    setDialogState({ type: 'emptyTrash' });
  }, []);

  const handleNewFileConfirm = useCallback(
    (folder: FileNode | undefined, value: string) => {
      if (onCreateFile && value.trim()) {
        onCreateFile(folder, value.trim());
      }
      closeDialog();
    },
    [onCreateFile, closeDialog]
  );

  const handleNewDrawingConfirm = useCallback(
    (folder: FileNode | undefined, value: string) => {
      if (onCreateDrawing && value.trim()) {
        onCreateDrawing(folder, value.trim());
      }
      closeDialog();
    },
    [onCreateDrawing, closeDialog]
  );

  const handleRenameConfirm = useCallback(
    (file: FileNode | undefined, value: string) => {
      if (onRename && file && value.trim()) {
        onRename(file, value.trim());
      }
      closeDialog();
    },
    [onRename, closeDialog]
  );

  const handleNewFolderConfirm = useCallback(
    (folder: FileNode | undefined, value: string) => {
      if (onNewFolder && value.trim()) {
        onNewFolder(folder, value.trim());
      }
      closeDialog();
    },
    [onNewFolder, closeDialog]
  );

  const handleDeleteConfirm = useCallback(
    (file: FileNode | undefined) => {
      if (onDelete && file) {
        onDelete(file);
      }
      closeDialog();
    },
    [onDelete, closeDialog]
  );

  const handleEmptyTrashConfirm = useCallback(
    (items: FileNode[]) => {
      if (onEmptyTrash) {
        onEmptyTrash(items);
      }
      closeDialog();
    },
    [onEmptyTrash, closeDialog]
  );

  return {
    dialogState,
    setDialogState,
    openNewFileDialog,
    openNewDrawingDialog,
    openRenameDialog,
    openNewFolderDialog,
    openDeleteDialog,
    openEmptyTrashDialog,
    closeDialog,
    handleNewFileConfirm,
    handleNewDrawingConfirm,
    handleRenameConfirm,
    handleNewFolderConfirm,
    handleDeleteConfirm,
    handleEmptyTrashConfirm,
  };
}
