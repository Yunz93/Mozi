import type { FileNode } from "../types";
import { findFileInTree } from "../utils/fileTree";
import { remapPathBoundarySafe } from "../utils/pathRemap";

/**
 * File store state interface
 */
export interface FileState {
  files: FileNode[];
  currentFilePath: string | null;
  rootFolderPath: string | null;
}

/**
 * File store actions interface
 */
export interface FileActions {
  setFiles: (files: FileNode[]) => void;
  setCurrentFilePath: (path: string | null) => void;
  setRootFolderPath: (path: string | null) => void;
  addFile: (file: FileNode) => void;
  removeFile: (fileId: string) => void;
  updateFileName: (fileId: string, newName: string, newPath: string) => void;
  toggleFileTrash: (fileId: string) => void;
  deleteFileForever: (fileId: string) => void;
}

/**
 * Initial file state
 */
export const initialFileState: FileState = {
  files: [],
  currentFilePath: null,
  rootFolderPath: null,
};

/**
 * Create file store slice
 */
export function createFileSlice(
  set: (fn: (state: FileState) => Partial<FileState>) => void,
  get: () => FileState & FileActions,
): FileState & FileActions {
  return {
    ...initialFileState,

    setFiles: (files) => set(() => ({ files })),

    setCurrentFilePath: (path) => set(() => ({ currentFilePath: path })),

    setRootFolderPath: (path) => set(() => ({ rootFolderPath: path })),

    addFile: (file) => {
      set((state) => {
        // Guard against optimistic insert racing a directory watcher refresh
        // (or a double-submit create) that already put this path in the tree.
        // Duplicate ids select together in the sidebar and look like one file.
        if (findFileInTree(state.files, file.id)) {
          return state;
        }

        const parentPath = file.path.substring(
          0,
          file.path.lastIndexOf(file.name) - 1,
        );

        if (!parentPath || parentPath === state.rootFolderPath) {
          return { files: [...state.files, file] };
        }

        let parentFound = false;
        const addToTree = (nodes: FileNode[]): FileNode[] =>
          nodes.map((node) => {
            if (node.path === parentPath) {
              parentFound = true;
              return { ...node, children: [...(node.children || []), file] };
            }
            if (node.children) {
              return { ...node, children: addToTree(node.children) };
            }
            return node;
          });

        const nextFiles = addToTree(state.files);
        if (!parentFound) {
          return { files: [...state.files, file] };
        }
        return { files: nextFiles };
      });
    },

    removeFile: (fileId) => {
      set((state) => {
        const removeFromTree = (nodes: FileNode[]): FileNode[] =>
          nodes
            .filter((node) => node.id !== fileId)
            .map((node) =>
              node.children
                ? { ...node, children: removeFromTree(node.children) }
                : node,
            );
        return { files: removeFromTree(state.files) };
      });
    },

    updateFileName: (fileId, newName, newPath) => {
      set((state) => {
        const updateNodeAndChildren = (
          node: FileNode,
          oldBasePath: string,
          nextBasePath: string,
        ): FileNode => {
          const nextPath = remapPathBoundarySafe(
            node.path,
            oldBasePath,
            nextBasePath,
          );
          const nextId = remapPathBoundarySafe(
            node.id,
            oldBasePath,
            nextBasePath,
          );

          return {
            ...node,
            name: node.id === fileId ? newName : node.name,
            path: nextPath,
            id: nextId,
            children: node.children?.map((child) =>
              updateNodeAndChildren(child, oldBasePath, nextBasePath),
            ),
          };
        };

        const updateTree = (nodes: FileNode[]): FileNode[] =>
          nodes.map((node) => {
            if (node.id === fileId) {
              return updateNodeAndChildren(node, node.path, newPath);
            }
            if (node.children) {
              return { ...node, children: updateTree(node.children) };
            }
            return node;
          });

        return { files: updateTree(state.files) };
      });
    },

    toggleFileTrash: (fileId) => {
      set((state) => {
        const updateTree = (nodes: FileNode[]): FileNode[] =>
          nodes.map((node) => {
            if (node.id === fileId) {
              return { ...node, isTrash: !node.isTrash };
            }
            if (node.children) {
              return { ...node, children: updateTree(node.children) };
            }
            return node;
          });
        return { files: updateTree(state.files) };
      });
    },

    deleteFileForever: (fileId) => {
      set((state) => {
        const removeFromTree = (nodes: FileNode[]): FileNode[] =>
          nodes
            .filter((node) => node.id !== fileId)
            .map((node) =>
              node.children
                ? { ...node, children: removeFromTree(node.children) }
                : node,
            );
        return { files: removeFromTree(state.files) };
      });
    },
  };
}
