import type { FileNode } from "../../types";
import {
  watchPath,
  withinWatchPath,
  type NativeChange,
} from "./nativeWatchClient";

function childrenAt(
  tree: FileNode[],
  path: string,
  root: string,
): FileNode[] | undefined {
  if (watchPath(path) === watchPath(root)) return tree;
  for (const node of tree) {
    if (node.type !== "folder") continue;
    if (watchPath(node.path) === watchPath(path)) return node.children ?? [];
    if (withinWatchPath(path, node.path))
      return childrenAt(node.children ?? [], path, node.path);
  }
}
function replaceBranch(
  tree: FileNode[],
  parent: string,
  children: FileNode[],
): FileNode[] {
  return tree.map((node) => {
    if (watchPath(node.path) === watchPath(parent))
      return { ...node, children };
    if (node.children && withinWatchPath(parent, node.path))
      return {
        ...node,
        children: replaceBranch(node.children, parent, children),
      };
    return node;
  });
}
export function watchTreeFiles(tree: FileNode[]): string[] {
  return tree.flatMap((node) =>
    node.type === "file" ? [node.path] : watchTreeFiles(node.children ?? []),
  );
}
export async function reconcileWatchTree(
  tree: FileNode[],
  root: string,
  changes: NativeChange[],
  readBranch: (parent: string, previous: FileNode[]) => Promise<FileNode[]>,
): Promise<{ tree: FileNode[]; modified: string[]; structural: boolean }> {
  const parents = new Set<string>();
  const replacedDirectories = new Set(
    changes
      .filter((change) => change.isDirectory && change.kind !== "modified")
      .map((change) => watchPath(change.path)),
  );
  const known = new Set(watchTreeFiles(tree).map(watchPath));
  const touched = new Set<string>();
  const r = watchPath(root);
  for (const change of changes) {
    if (!withinWatchPath(change.path, root))
      throw new Error("Invalid watch path");
    if (!change.isDirectory) touched.add(change.path);
    if (
      change.kind === "modified" &&
      (change.isDirectory || known.has(watchPath(change.path)))
    )
      continue;
    for (const path of [change.path, change.oldPath].filter(
      (p): p is string => !!p,
    )) {
      if (!withinWatchPath(path, root)) throw new Error("Invalid watch path");
      if (watchPath(path) === r) {
        if (change.kind === "removed")
          throw new Error("Watch root disappeared");
        continue;
      }
      let parent =
        watchPath(path).slice(0, watchPath(path).lastIndexOf("/")) || "/";
      while (parent !== r && !childrenAt(tree, parent, root))
        parent = parent.slice(0, parent.lastIndexOf("/")) || "/";
      parents.add(parent);
    }
  }
  let next = tree;
  // Refresh parents before descendants, retaining children of existing folders.
  for (const parent of [...parents].sort((a, b) => a.length - b.length)) {
    const previous = childrenAt(next, parent, root);
    if (!previous) continue; // Its parent was authoritatively removed above.
    // A directory can be removed and recreated at the same path within one
    // batch. Its former children must not survive the authoritative parent read.
    const reusable = previous.filter(
      (node) =>
        node.type !== "folder" ||
        !replacedDirectories.has(watchPath(node.path)),
    );
    const branch = await readBranch(parent === r ? root : parent, reusable);
    next = parent === r ? branch : replaceBranch(next, parent, branch);
  }
  const visible = new Map(
    watchTreeFiles(next).map((path) => [watchPath(path), path]),
  );
  return {
    tree: next,
    structural: parents.size > 0,
    modified: [...touched].flatMap((path) => {
      const actual = visible.get(watchPath(path));
      return actual ? [actual] : [];
    }),
  };
}
