import type { FileNode, FileSortMode } from "../../types";
import type { FileEntryMetadata } from "../../types/filesystem";

export function normalizeFileSortMode(value: unknown): FileSortMode {
  return value === "created" || value === "modified" || value === "type"
    ? value
    : "name";
}

export function sortFileNodes(
  nodes: FileNode[],
  mode: FileSortMode,
  metadata: ReadonlyMap<string, FileEntryMetadata>,
): FileNode[] {
  const extension = (node: FileNode) =>
    node.name.match(/\.([^.]+)$/)?.[1].toLocaleLowerCase() ?? "";
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const name = () =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }) || a.path.localeCompare(b.path);
    if (mode === "type")
      return extension(a).localeCompare(extension(b)) || name();
    if (mode === "created" || mode === "modified") {
      const key = mode === "created" ? "createdAt" : "modifiedAt";
      const left = metadata.get(a.path)?.[key] ?? null;
      const right = metadata.get(b.path)?.[key] ?? null;
      if (left === null || right === null)
        return left === right ? name() : left === null ? 1 : -1;
      return right - left || name();
    }
    return name();
  });
}
