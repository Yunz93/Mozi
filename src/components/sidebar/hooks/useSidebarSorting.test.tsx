// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore, defaultSettings } from "../../../store/appStore";
import { useSidebarSorting } from "./useSidebarSorting";
import { invalidateFileMetadata } from "../../../services/filesystem/fileMetadataEvents";
const bridge = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("../../../types/filesystem", () => ({
  getFileSystem: async () => ({ fileMetadata: bridge.metadata }),
}));
const files = ["a", "b"].map((name) => ({
  id: `/v/${name}.md`,
  path: `/v/${name}.md`,
  name: `${name}.md`,
  type: "file" as const,
}));
const times = (a: number, b: number) => ({
  "/v/a.md": { createdAt: 1, modifiedAt: a },
  "/v/b.md": { createdAt: 2, modifiedAt: b },
});
function selectPaths(
  values: Record<string, { createdAt: number; modifiedAt: number }>,
  paths: string[],
) {
  return Object.fromEntries(paths.map((path) => [path, values[path]]));
}
beforeEach(() => {
  bridge.metadata
    .mockReset()
    .mockImplementation(async (paths: string[]) =>
      selectPaths(times(1, 2), paths),
    );
  useAppStore.setState({
    settings: { ...defaultSettings, sidebarSortMode: "modified" },
    lastSavedContent: {},
  });
});
afterEach(cleanup);
it("keeps both metadata updates when a second save interrupts the first request", async () => {
  const { result } = renderHook(() => useSidebarSorting(files));
  await waitFor(() => expect(result.current.metadata.size).toBe(2));
  let release!: (value: ReturnType<typeof times>) => void;
  bridge.metadata.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  act(() =>
    useAppStore.setState({ lastSavedContent: { "/v/a.md": "saved A" } }),
  );
  await waitFor(() => expect(bridge.metadata).toHaveBeenCalledTimes(2));
  bridge.metadata.mockImplementation(async (paths: string[]) =>
    selectPaths(times(10, 20), paths),
  );
  act(() =>
    useAppStore.setState({
      lastSavedContent: { "/v/a.md": "saved A", "/v/b.md": "saved B" },
    }),
  );
  await waitFor(() =>
    expect(result.current.metadata.get("/v/b.md")?.modifiedAt).toBe(20),
  );
  await act(async () => release(times(10, 2)));
  expect(result.current.metadata.get("/v/a.md")?.modifiedAt).toBe(10);
  expect(result.current.loading).toBe(false);
});
it("ends loading when the active knowledge base becomes empty during a request", async () => {
  let release!: (value: ReturnType<typeof times>) => void;
  bridge.metadata.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { result, rerender } = renderHook(
    ({ nodes }) => useSidebarSorting(nodes),
    { initialProps: { nodes: files } },
  );
  await waitFor(() => expect(bridge.metadata).toHaveBeenCalledOnce());
  rerender({ nodes: [] });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => release(times(1, 2)));
  expect(result.current.metadata.size).toBe(0);
});
it("refreshes metadata for external changes", async () => {
  const { result } = renderHook(() => useSidebarSorting(files));
  await waitFor(() => expect(result.current.metadata.size).toBe(2));
  bridge.metadata.mockResolvedValue(times(30, 2));
  act(() => invalidateFileMetadata(["/v/a.md"]));
  await waitFor(() =>
    expect(result.current.metadata.get("/v/a.md")?.modifiedAt).toBe(30),
  );
});

it("clears stale metadata to match the name-sort fallback after a failed read", async () => {
  const { result } = renderHook(() => useSidebarSorting(files));
  await waitFor(() => expect(result.current.metadata.size).toBe(2));
  bridge.metadata.mockRejectedValueOnce(new Error("unmounted volume"));
  act(() => useAppStore.setState({ lastSavedContent: { "/v/a.md": "new A" } }));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.metadata.size).toBe(0);
  expect(result.current.loading).toBe(false);
});
