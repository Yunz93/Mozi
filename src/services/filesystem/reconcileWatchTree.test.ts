import { it, expect, vi } from "vitest";
import type { FileNode } from "../../types";
import { reconcileWatchTree } from "./reconcileWatchTree";
const file = (path: string): FileNode => ({
  id: path,
  path,
  name: path.split("/").at(-1)!,
  type: "file",
});
const tree: FileNode[] = [
  {
    id: "/v/a",
    path: "/v/a",
    name: "a",
    type: "folder",
    children: [file("/v/a/one.md")],
  },
  file("/v/root.md"),
];
it("content changes never read a directory or replace the tree", async () => {
  const read = vi.fn();
  const result = await reconcileWatchTree(
    tree,
    "/v",
    [{ path: "/v/a/one.md", kind: "modified", isDirectory: false }],
    read,
  );
  expect(read).not.toHaveBeenCalled();
  expect(result.tree).toBe(tree);
  expect(result.modified).toEqual(["/v/a/one.md"]);
  expect(result.structural).toBe(false);
});
it("refreshes only the changed parent and retains unrelated branches", async () => {
  const read = vi.fn(async () => [file("/v/a/one.md"), file("/v/a/two.md")]);
  const result = await reconcileWatchTree(
    tree,
    "/v",
    [{ path: "/v/a/two.md", kind: "created", isDirectory: false }],
    read,
  );
  expect(read).toHaveBeenCalledExactlyOnceWith("/v/a", tree[0].children);
  expect(result.tree[1]).toBe(tree[1]);
  expect(result.tree[0].children).toHaveLength(2);
});
it("reconciles both rename parents against disk, including atomic replacements", async () => {
  const read = vi.fn(async (path: string) =>
    path === "/v" ? tree : [file("/v/a/root.md")],
  );
  const result = await reconcileWatchTree(
    tree,
    "/v",
    [
      {
        path: "/v/a/root.md",
        oldPath: "/v/root.md",
        kind: "renamed",
        isDirectory: false,
      },
    ],
    read,
  );
  expect(read.mock.calls.map(([path]) => path)).toEqual(["/v", "/v/a"]);
  expect(result.tree[0].children?.[0].path).toBe("/v/a/root.md");
});
it("rejects a sibling prefix instead of traversing outside the vault", async () => {
  await expect(
    reconcileWatchTree(
      tree,
      "/v",
      [{ path: "/v-other/a.md", kind: "created", isDirectory: false }],
      vi.fn(),
    ),
  ).rejects.toThrow();
});
